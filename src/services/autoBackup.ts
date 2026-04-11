/**
 * Automatic periodic backup of the instruction index.
 *
 * Creates zip archives of all .json files from the instructions directory
 * into the configured backups directory. Old auto-backups are pruned when
 * their count exceeds the configured maximum.
 *
 * Env vars (via runtimeConfig.mutation):
 *   INDEX_SERVER_AUTO_BACKUP_INTERVAL_MS — timer interval (default 3600000 = 1h)
 *   INDEX_SERVER_AUTO_BACKUP_MAX_COUNT   — max retained auto-backups (default 10)
 */
import fs from 'fs';
import path from 'path';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { createZipBackup } from './backupZip';

const AUTO_BACKUP_PREFIX = 'auto-backup-';
let _timer: ReturnType<typeof setInterval> | null = null;

function getInstructionsDir(): string {
  return getRuntimeConfig().index.baseDir;
}

function getBackupsDir(): string {
  return getRuntimeConfig().dashboard.admin.backupsDir;
}

/**
 * Run a single auto-backup cycle. Returns the backup zip file path,
 * or null if the instructions directory is empty / doesn't exist.
 */
export function runAutoBackupOnce(): string | null {
  const instrDir = getInstructionsDir();
  if (!fs.existsSync(instrDir)) return null;

  const backupsRoot = getBackupsDir();
  fs.mkdirSync(backupsRoot, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 15);
  let zipPath = path.join(backupsRoot, `${AUTO_BACKUP_PREFIX}${stamp}.zip`);
  let i = 1;
  while (fs.existsSync(zipPath)) {
    zipPath = path.join(backupsRoot, `${AUTO_BACKUP_PREFIX}${stamp}-${i++}.zip`);
  }

  // Backup SQLite DB if present — still uses a directory for binary DB files
  const storageBackend = getRuntimeConfig().storage?.backend ?? 'json';
  if (storageBackend === 'sqlite') {
    const sqlitePath = getRuntimeConfig().storage?.sqlitePath;
    if (sqlitePath && fs.existsSync(sqlitePath)) {
      const backupDir = zipPath.replace(/\.zip$/, '');
      fs.mkdirSync(backupDir, { recursive: true });
      fs.copyFileSync(sqlitePath, path.join(backupDir, 'index.db'));
      if (fs.existsSync(sqlitePath + '-wal')) fs.copyFileSync(sqlitePath + '-wal', path.join(backupDir, 'index.db-wal'));
      if (fs.existsSync(sqlitePath + '-shm')) fs.copyFileSync(sqlitePath + '-shm', path.join(backupDir, 'index.db-shm'));
      pruneOldBackups(backupsRoot);
      try { process.stderr.write(`[auto-backup] created ${backupDir} (sqlite)\n`); } catch { /* ignore */ }
      return backupDir;
    }
  }

  // Default: backup JSON files into a zip
  const files = fs.readdirSync(instrDir).filter(f => f.endsWith('.json'));
  if (files.length === 0) return null;

  const { zipPath: resultPath, fileCount } = createZipBackup(instrDir, zipPath);

  // Prune old auto-backups beyond maxCount
  pruneOldBackups(backupsRoot);

  try { process.stderr.write(`[auto-backup] created ${resultPath} (${fileCount} files)\n`); } catch { /* ignore */ }
  return resultPath;
}

function pruneOldBackups(backupsRoot: string): void {
  const maxCount = getRuntimeConfig().mutation.autoBackupMaxCount;
  try {
    const entries = fs.readdirSync(backupsRoot)
      .filter(d => {
        if (!d.startsWith(AUTO_BACKUP_PREFIX)) return false;
        const full = path.join(backupsRoot, d);
        // Accept both zip files and legacy directories
        return d.endsWith('.zip') ? fs.statSync(full).isFile() : fs.statSync(full).isDirectory();
      })
      .sort(); // lexicographic = chronological for ISO timestamps
    while (entries.length > maxCount) {
      const oldest = entries.shift()!;
      const full = path.join(backupsRoot, oldest);
      if (oldest.endsWith('.zip')) {
        fs.unlinkSync(full);
      } else {
        fs.rmSync(full, { recursive: true, force: true });
      }
      try { process.stderr.write(`[auto-backup] pruned old backup: ${oldest}\n`); } catch { /* ignore */ }
    }
  } catch (e) { try { process.stderr.write(`[auto-backup] pruning failed: ${e}\n`); } catch { /* ignore */ } }
}

/**
 * Start the periodic auto-backup timer. Returns the interval handle.
 * No-op if already running.
 */
export function startAutoBackup(): ReturnType<typeof setInterval> | null {
  if (_timer) return _timer;
  const cfg = getRuntimeConfig().mutation;
  if (!cfg.autoBackupEnabled) {
    try { process.stderr.write('[auto-backup] disabled (INDEX_SERVER_AUTO_BACKUP=0)\n'); } catch { /* ignore */ }
    return null;
  }
  const intervalMs = cfg.autoBackupIntervalMs;
  if (intervalMs <= 0) return null;
  _timer = setInterval(() => {
    try { runAutoBackupOnce(); } catch (e) { try { process.stderr.write(`[auto-backup] interval run failed: ${e}\n`); } catch { /* ignore */ } }
  }, intervalMs);
  // Unref so the timer doesn't keep the process alive
  if (_timer && typeof _timer.unref === 'function') _timer.unref();
  // Run first backup after a short delay (don't block caller)
  setTimeout(() => { try { runAutoBackupOnce(); } catch (e) { try { process.stderr.write(`[auto-backup] initial run failed: ${e}\n`); } catch { /* ignore */ } } }, 5000).unref();
  try { process.stderr.write(`[auto-backup] started (interval=${intervalMs}ms, maxCount=${getRuntimeConfig().mutation.autoBackupMaxCount})\n`); } catch { /* ignore */ }
  return _timer;
}

/**
 * Stop the periodic auto-backup timer.
 */
export function stopAutoBackup(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}
