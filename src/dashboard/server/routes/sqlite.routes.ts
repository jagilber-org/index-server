/**
 * SQLite dashboard routes — DB info, ad-hoc query, maintenance,
 * backup/restore, WAL management, grooming, migration & export.
 *
 * Only active when INDEX_SERVER_STORAGE_BACKEND=sqlite.
 * All routes prefixed with /sqlite/.
 */

import { Router } from 'express';
import { getRuntimeConfig } from '../../../config/runtimeConfig.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateJsonToSqlite, migrateSqliteToJson } from '../../../services/storage/migrationEngine.js';
import { PRAGMAS, INSTRUCTIONS_DDL, FTS5_DDL } from '../../../services/storage/sqliteSchema.js';
import fs from 'fs';
import path from 'path';

function getSqlitePath(): string {
  return getRuntimeConfig().storage?.sqlitePath ?? '';
}

function assertSqliteActive(): void {
  if ((getRuntimeConfig().storage?.backend ?? 'json') !== 'sqlite') {
    throw Object.assign(new Error('SQLite backend not active'), { statusCode: 400 });
  }
}

function getBackupsDir(): string {
  return getRuntimeConfig().dashboard.admin.backupsDir;
}

export function createSqliteRoutes(): Router {
  const router = Router();

  /** GET /sqlite/info — Database stats and config */
  router.get('/sqlite/info', (_req, res) => {
    try {
      const config = getRuntimeConfig();
      const backend = config.storage?.backend ?? 'json';
      const sqlitePath = config.storage?.sqlitePath ?? '';
      const walEnabled = config.storage?.sqliteWal ?? true;

      if (backend !== 'sqlite') {
        return res.json({
          success: true,
          active: false,
          backend: 'json',
          message: 'SQLite backend is not active. Set INDEX_SERVER_STORAGE_BACKEND=sqlite to enable.',
        });
      }

      // Get file size if DB exists
      let fileSize = 0;
      let walSize = 0;
      let shmSize = 0;
      let exists = false;
      try {
        if (fs.existsSync(sqlitePath)) {
          exists = true;
          fileSize = fs.statSync(sqlitePath).size;
          const walPath = sqlitePath + '-wal';
          const shmPath = sqlitePath + '-shm';
          if (fs.existsSync(walPath)) walSize = fs.statSync(walPath).size;
          if (fs.existsSync(shmPath)) shmSize = fs.statSync(shmPath).size;
        }
      } catch { /* ignore */ }

      // Query DB stats using node:sqlite
      const tableStats: Record<string, number> = {};
      const pragmas: Record<string, unknown> = {};
      try {
        const db = new DatabaseSync(sqlitePath, { readOnly: true });
        try {
          // Count rows in key tables
          for (const table of ['instructions', 'messages', 'usage', 'metadata']) {
            try {
              const row = db.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get() as Record<string, unknown>;
              tableStats[table] = (row?.cnt as number) ?? 0;
            } catch { /* table may not exist */ }
          }
          // Read pragmas
          try {
            const jm = db.prepare('PRAGMA journal_mode').get() as Record<string, unknown>;
            pragmas.journalMode = jm?.journal_mode ?? 'unknown';
          } catch { /* ignore */ }
          try {
            const ps = db.prepare('PRAGMA page_size').get() as Record<string, unknown>;
            pragmas.pageSize = ps?.page_size ?? 0;
          } catch { /* ignore */ }
          try {
            const pc = db.prepare('PRAGMA page_count').get() as Record<string, unknown>;
            pragmas.pageCount = pc?.page_count ?? 0;
          } catch { /* ignore */ }
          try {
            const fl = db.prepare('PRAGMA freelist_count').get() as Record<string, unknown>;
            pragmas.freelistCount = fl?.freelist_count ?? 0;
          } catch { /* ignore */ }
        } finally {
          db.close();
        }
      } catch { /* node:sqlite not available */ }

      return res.json({
        success: true,
        active: true,
        backend: 'sqlite',
        dbPath: sqlitePath,
        exists,
        fileSize,
        walSize,
        shmSize,
        walEnabled,
        tableStats,
        pragmas,
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  /** POST /sqlite/query — Execute read-only SQL query */
  router.post('/sqlite/query', (req, res) => {
    try {
      assertSqliteActive();

      const { sql } = req.body as { sql?: string };
      if (!sql || typeof sql !== 'string') {
        return res.status(400).json({ success: false, error: 'Missing "sql" field in request body' });
      }

      // Safety: only allow SELECT and PRAGMA
      const trimmed = sql.trim().toUpperCase();
      if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('PRAGMA') && !trimmed.startsWith('EXPLAIN')) {
        return res.status(403).json({
          success: false,
          error: 'Only SELECT, PRAGMA, and EXPLAIN queries are allowed',
        });
      }

      // Reject multi-statement queries and enforce length limit
      if (sql.length > 10000) {
        return res.status(400).json({ success: false, error: 'Query exceeds maximum length (10000 chars)' });
      }
      if (/;\s*\S/.test(sql)) {
        return res.status(403).json({ success: false, error: 'Multi-statement queries are not allowed' });
      }

      const sqlitePath = getSqlitePath();
      const db = new DatabaseSync(sqlitePath, { readOnly: true });
      try {
        const rows = db.prepare(sql).all();
        const columns = rows.length > 0 ? Object.keys(rows[0] as object) : [];
        return res.json({
          success: true,
          columns,
          rows,
          rowCount: rows.length,
        });
      } finally {
        db.close();
      }
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode ?? 400;
      return res.status(code).json({ success: false, error: (err as Error).message });
    }
  });

  /** POST /sqlite/vacuum — Run VACUUM to reclaim space */
  router.post('/sqlite/vacuum', (_req, res) => {
    try {
      assertSqliteActive();
      const sqlitePath = getSqlitePath();
      const db = new DatabaseSync(sqlitePath);
      try {
        db.exec('VACUUM');
        const sizeAfter = fs.existsSync(sqlitePath) ? fs.statSync(sqlitePath).size : 0;
        return res.json({ success: true, message: 'VACUUM completed', sizeAfter });
      } finally {
        db.close();
      }
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode ?? 500;
      return res.status(code).json({ success: false, error: (err as Error).message });
    }
  });

  /** POST /sqlite/optimize — Run FTS5 optimize */
  router.post('/sqlite/optimize', (_req, res) => {
    try {
      assertSqliteActive();
      const sqlitePath = getSqlitePath();
      const db = new DatabaseSync(sqlitePath);
      try {
        db.exec("INSERT INTO instructions_fts(instructions_fts) VALUES('optimize')");
        return res.json({ success: true, message: 'FTS5 index optimized' });
      } finally {
        db.close();
      }
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode ?? 500;
      return res.status(code).json({ success: false, error: (err as Error).message });
    }
  });

  /** POST /sqlite/integrity-check — Run SQLite integrity check */
  router.post('/sqlite/integrity-check', (_req, res) => {
    try {
      assertSqliteActive();
      const sqlitePath = getSqlitePath();
      const db = new DatabaseSync(sqlitePath, { readOnly: true });
      try {
        const rows = db.prepare('PRAGMA integrity_check').all();
        const ok = rows.length === 1 && (rows[0] as Record<string, unknown>).integrity_check === 'ok';
        return res.json({ success: true, ok, results: rows });
      } finally {
        db.close();
      }
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode ?? 500;
      return res.status(code).json({ success: false, error: (err as Error).message });
    }
  });

  // ── Backup / Restore ──────────────────────────────────────────────────

  /** POST /sqlite/backup — Create manual backup of the SQLite DB */
  router.post('/sqlite/backup', (_req, res) => {
    try {
      assertSqliteActive();
      const sqlitePath = getSqlitePath();
      if (!fs.existsSync(sqlitePath)) {
        return res.status(404).json({ success: false, error: 'Database file not found' });
      }

      const backupsRoot = getBackupsDir();
      fs.mkdirSync(backupsRoot, { recursive: true });

      const stamp = new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 15);
      const backupDir = path.join(backupsRoot, `manual-backup-${stamp}`);
      fs.mkdirSync(backupDir, { recursive: true });

      // Checkpoint WAL before backup for consistency
      try {
        const db = new DatabaseSync(sqlitePath);
        try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } finally { db.close(); }
      } catch { /* best-effort checkpoint */ }

      fs.copyFileSync(sqlitePath, path.join(backupDir, 'index.db'));
      if (fs.existsSync(sqlitePath + '-wal')) fs.copyFileSync(sqlitePath + '-wal', path.join(backupDir, 'index.db-wal'));
      if (fs.existsSync(sqlitePath + '-shm')) fs.copyFileSync(sqlitePath + '-shm', path.join(backupDir, 'index.db-shm'));

      const backupSize = fs.statSync(path.join(backupDir, 'index.db')).size;
      return res.json({ success: true, message: 'Backup created', backupDir, backupSize });
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode ?? 500;
      return res.status(code).json({ success: false, error: (err as Error).message });
    }
  });

  /** GET /sqlite/backups — List available backups */
  router.get('/sqlite/backups', (_req, res) => {
    try {
      const backupsRoot = getBackupsDir();
      if (!fs.existsSync(backupsRoot)) {
        return res.json({ success: true, backups: [] });
      }

      const dirs = fs.readdirSync(backupsRoot)
        .filter(d => {
          const full = path.join(backupsRoot, d);
          return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'index.db'));
        })
        .map(d => {
          const full = path.join(backupsRoot, d);
          const dbSize = fs.statSync(path.join(full, 'index.db')).size;
          const created = fs.statSync(full).mtime.toISOString();
          return { name: d, path: full, dbSize, created };
        })
        .sort((a, b) => b.created.localeCompare(a.created));

      return res.json({ success: true, backups: dirs });
    } catch (err) {
      return res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  /** POST /sqlite/restore — Restore from a named backup */
  router.post('/sqlite/restore', (req, res) => {
    try {
      assertSqliteActive();
      const { backupName } = req.body as { backupName?: string };
      if (!backupName || typeof backupName !== 'string') {
        return res.status(400).json({ success: false, error: 'Missing "backupName" field' });
      }

      // Sanitize: no path traversal
      if (backupName.includes('..') || backupName.includes('/') || backupName.includes('\\')) {
        return res.status(400).json({ success: false, error: 'Invalid backup name' });
      }

      const backupsRoot = getBackupsDir();
      const backupDir = path.join(backupsRoot, backupName);
      const backupDb = path.join(backupDir, 'index.db');

      if (!fs.existsSync(backupDb)) {
        return res.status(404).json({ success: false, error: 'Backup not found: ' + backupName });
      }

      const sqlitePath = getSqlitePath();

      // Auto-backup current DB before overwriting
      if (fs.existsSync(sqlitePath)) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 15);
        const preRestoreDir = path.join(backupsRoot, `pre-restore-${stamp}`);
        fs.mkdirSync(preRestoreDir, { recursive: true });
        fs.copyFileSync(sqlitePath, path.join(preRestoreDir, 'index.db'));
        if (fs.existsSync(sqlitePath + '-wal')) fs.copyFileSync(sqlitePath + '-wal', path.join(preRestoreDir, 'index.db-wal'));
        if (fs.existsSync(sqlitePath + '-shm')) fs.copyFileSync(sqlitePath + '-shm', path.join(preRestoreDir, 'index.db-shm'));
      }

      // Restore: copy backup files over current DB
      fs.copyFileSync(backupDb, sqlitePath);
      const walFile = path.join(backupDir, 'index.db-wal');
      const shmFile = path.join(backupDir, 'index.db-shm');
      if (fs.existsSync(walFile)) {
        fs.copyFileSync(walFile, sqlitePath + '-wal');
      } else {
        // Remove stale WAL/SHM from previous DB
        try { fs.unlinkSync(sqlitePath + '-wal'); } catch { /* ok */ }
      }
      if (fs.existsSync(shmFile)) {
        fs.copyFileSync(shmFile, sqlitePath + '-shm');
      } else {
        try { fs.unlinkSync(sqlitePath + '-shm'); } catch { /* ok */ }
      }

      return res.json({ success: true, message: 'Restored from ' + backupName });
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode ?? 500;
      return res.status(code).json({ success: false, error: (err as Error).message });
    }
  });

  // ── Reset / Migrate ───────────────────────────────────────────────────

  /** POST /sqlite/reset — Drop all tables and reinitialize schema */
  router.post('/sqlite/reset', (_req, res) => {
    try {
      assertSqliteActive();
      const sqlitePath = getSqlitePath();

      // Auto-backup before reset
      if (fs.existsSync(sqlitePath)) {
        const backupsRoot = getBackupsDir();
        fs.mkdirSync(backupsRoot, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 15);
        const preResetDir = path.join(backupsRoot, `pre-reset-${stamp}`);
        fs.mkdirSync(preResetDir, { recursive: true });
        fs.copyFileSync(sqlitePath, path.join(preResetDir, 'index.db'));
      }

      // Delete the DB file and WAL/SHM — fresh start
      try { fs.unlinkSync(sqlitePath); } catch { /* ok */ }
      try { fs.unlinkSync(sqlitePath + '-wal'); } catch { /* ok */ }
      try { fs.unlinkSync(sqlitePath + '-shm'); } catch { /* ok */ }

      // Reinitialize schema
      const db = new DatabaseSync(sqlitePath);
      try {
        db.exec(PRAGMAS);
        db.exec(INSTRUCTIONS_DDL);
        try { db.exec(FTS5_DDL); } catch { /* FTS5 may already exist */ }
        return res.json({ success: true, message: 'Database reset — schema reinitialized' });
      } finally {
        db.close();
      }
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode ?? 500;
      return res.status(code).json({ success: false, error: (err as Error).message });
    }
  });

  /** POST /sqlite/migrate — Migrate instructions from JSON files to SQLite */
  router.post('/sqlite/migrate', async (_req, res) => {
    try {
      assertSqliteActive();
      const instrDir = getRuntimeConfig().index.baseDir;
      const sqlitePath = getSqlitePath();
      const result = await migrateJsonToSqlite(instrDir, sqlitePath);
      return res.json({
        success: true,
        message: `Migrated ${result.migrated} instructions`,
        migrated: result.migrated,
        errors: result.errors,
      });
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode ?? 500;
      return res.status(code).json({ success: false, error: (err as Error).message });
    }
  });

  /** POST /sqlite/export — Export SQLite instructions back to JSON files */
  router.post('/sqlite/export', async (_req, res) => {
    try {
      assertSqliteActive();
      const instrDir = getRuntimeConfig().index.baseDir;
      const sqlitePath = getSqlitePath();
      const result = await migrateSqliteToJson(sqlitePath, instrDir);
      return res.json({
        success: true,
        message: `Exported ${result.exported} instructions to JSON`,
        exported: result.exported,
        errors: result.errors,
      });
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode ?? 500;
      return res.status(code).json({ success: false, error: (err as Error).message });
    }
  });

  // ── WAL Management ────────────────────────────────────────────────────

  /** POST /sqlite/wal-checkpoint — Flush WAL to main database file */
  router.post('/sqlite/wal-checkpoint', (_req, res) => {
    try {
      assertSqliteActive();
      const sqlitePath = getSqlitePath();
      const db = new DatabaseSync(sqlitePath);
      try {
        const row = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as Record<string, unknown>;
        const walSizeAfter = fs.existsSync(sqlitePath + '-wal') ? fs.statSync(sqlitePath + '-wal').size : 0;
        return res.json({
          success: true,
          message: 'WAL checkpoint completed (TRUNCATE)',
          checkpoint: row,
          walSizeAfter,
        });
      } finally {
        db.close();
      }
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode ?? 500;
      return res.status(code).json({ success: false, error: (err as Error).message });
    }
  });

  /** POST /sqlite/analyze — Update query planner statistics */
  router.post('/sqlite/analyze', (_req, res) => {
    try {
      assertSqliteActive();
      const sqlitePath = getSqlitePath();
      const db = new DatabaseSync(sqlitePath);
      try {
        db.exec('ANALYZE');
        return res.json({ success: true, message: 'ANALYZE completed — query planner stats updated' });
      } finally {
        db.close();
      }
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode ?? 500;
      return res.status(code).json({ success: false, error: (err as Error).message });
    }
  });

  /** POST /sqlite/reindex — Rebuild all indexes */
  router.post('/sqlite/reindex', (_req, res) => {
    try {
      assertSqliteActive();
      const sqlitePath = getSqlitePath();
      const db = new DatabaseSync(sqlitePath);
      try {
        db.exec('REINDEX');
        return res.json({ success: true, message: 'REINDEX completed — all indexes rebuilt' });
      } finally {
        db.close();
      }
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode ?? 500;
      return res.status(code).json({ success: false, error: (err as Error).message });
    }
  });

  // ── Grooming ──────────────────────────────────────────────────────────

  /** POST /sqlite/groom — Clean up orphans, stale data, run optimizations */
  router.post('/sqlite/groom', (_req, res) => {
    try {
      assertSqliteActive();
      const sqlitePath = getSqlitePath();
      const db = new DatabaseSync(sqlitePath);
      const results: string[] = [];
      try {
        // 1. Remove orphaned messages (messages referencing non-existent instructions)
        try {
          const orphanMsgs = db.prepare(`
            DELETE FROM messages WHERE id IN (
              SELECT m.id FROM messages m
              LEFT JOIN instructions i ON m.recipient = i.id
              WHERE m.recipient IS NOT NULL AND i.id IS NULL
            )
          `).run();
          results.push(`Orphaned messages removed: ${orphanMsgs.changes}`);
        } catch { results.push('Messages table: skipped (may not exist)'); }

        // 2. Remove orphaned usage records
        try {
          const orphanUsage = db.prepare(`
            DELETE FROM usage WHERE instruction_id NOT IN (SELECT id FROM instructions)
          `).run();
          results.push(`Orphaned usage records removed: ${orphanUsage.changes}`);
        } catch { results.push('Usage table: skipped (may not exist)'); }

        // 3. Remove deprecated instructions (status = 'deprecated' and older than 90 days)
        try {
          const deprecated = db.prepare(`
            DELETE FROM instructions WHERE json_extract(data, '$.governanceStatus') = 'deprecated'
            AND updated_at < datetime('now', '-90 days')
          `).run();
          results.push(`Deprecated instructions removed (>90 days): ${deprecated.changes}`);
        } catch { results.push('Deprecated cleanup: skipped'); }

        // 4. Optimize FTS5
        try {
          db.exec("INSERT INTO instructions_fts(instructions_fts) VALUES('optimize')");
          results.push('FTS5 index optimized');
        } catch { results.push('FTS5 optimize: skipped'); }

        // 5. ANALYZE for query planner
        db.exec('ANALYZE');
        results.push('ANALYZE completed');

        return res.json({ success: true, message: 'Grooming completed', results });
      } finally {
        db.close();
      }
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode ?? 500;
      return res.status(code).json({ success: false, error: (err as Error).message });
    }
  });

  return router;
}
