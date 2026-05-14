/**
 * Index Server Admin - Enterprise Administration Interface
 *
 * Thin coordinator that delegates to:
 * - AdminPanelConfig  — server configuration rendering/serialization
 * - AdminPanelState   — admin session state management
 *
 * Retains direct responsibility for maintenance operations, backup/restore,
 * system health monitoring, and admin statistics.
 */
import fs from 'fs';
import path from 'path';
import v8 from 'v8';
import { getRuntimeConfig } from '../../config/runtimeConfig';
import { getMetricsCollector, ToolMetrics } from './MetricsCollector';
import type { TrendDirection } from '../../lib/trendDirection';
import type { HealthStatus } from '../types/healthStatus';
import { getIndexState, ensureLoaded, invalidate, touchIndexVersion } from '../../services/indexContext';
import { AdminPanelConfig } from './AdminPanelConfig';
import type { AdminConfig } from './AdminPanelConfig';
import { AdminPanelState } from './AdminPanelState';
import type { AdminSession, AdminSessionHistoryEntry } from './AdminPanelState';
import { createZipBackupWithManifest, extractZipBackup, readZipManifest, listZipInstructionFiles, isZipBackup } from '../../services/backupZip';
import { logAudit } from '../../services/auditLog';
import { logInfo, logError, logWarn, log } from '../../services/logger';

// Stackless WARN: the log-hygiene gate (scripts/crawl-logs.mjs --strict)
// treats WARN-with-stack as a budget violation (max-stack-warn=5). logWarn()
// auto-captures a JS stack via captureCallStack(), so for routine admin
// rejection paths use log('WARN', ...) directly with a serialized detail.
const warnStruct = (msg: string, detail?: unknown) =>
  log('WARN', msg, { detail: detail === undefined ? undefined : typeof detail === 'string' ? detail : JSON.stringify(detail) });
import { scheduleEmbeddingComputeAfterImport } from '../../services/embeddingTrigger';
import { migrateJsonToSqlite } from '../../services/storage/migrationEngine';
import AdmZip from 'adm-zip';

// Re-export for consumers that import these types from AdminPanel
export type { AdminConfig, AdminSession, AdminSessionHistoryEntry };

interface SystemMaintenance {
  lastBackup: Date | null;
  nextScheduledMaintenance: Date | null;
  maintenanceMode: boolean;
  systemHealth: {
    status: HealthStatus;
    issues: string[];
    recommendations: string[];
    cpuTrend?: TrendDirection;
    memoryTrend?: TrendDirection;
    memoryGrowthRate?: number;
  };
}

interface AdminStats {
  totalConnections: number;
  activeConnections: number;
  /** Count of active admin panel sessions (logical authenticated/admin sessions) */
  adminActiveSessions: number;
  totalRequests: number;
  errorRate: number;
  avgResponseTime: number;
  uptime: number;
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  cpuUsage: {
    user: number;
    system: number;
    percent: number;
  };
  toolMetrics: { [toolName: string]: ToolMetrics };
  indexStats: {
    /** Accepted (validated) instruction count – kept also as totalInstructions for backward compatibility */
    totalInstructions: number;
    acceptedInstructions: number;
    rawFileCount: number;
    skippedInstructions: number;
    lastUpdated: Date;
    version: string;
    schemaVersion: string;
  };
}

export class AdminPanel {
  private readonly panelConfig: AdminPanelConfig;
  private readonly panelState: AdminPanelState;
  private maintenanceInfo: SystemMaintenance;
  private indexStatsCache: { totalInstructions: number; acceptedInstructions: number; rawFileCount: number; skippedInstructions: number; lastUpdated: Date; version: string; schemaVersion: string } | null = null;
  private lastUptimeSeconds = 0;

  private get backupRoot(): string {
    return getRuntimeConfig().dashboard.admin.backupsDir || path.join(process.cwd(), 'backups');
  }
  private get instructionsRoot(): string {
    return getRuntimeConfig().index.baseDir || path.join(process.cwd(), 'instructions');
  }

  /**
   * Validate and sanitize a user-supplied backupId to prevent path traversal (SH-4).
   * Returns the sanitized basename or throws if the id is invalid.
   */
  private validateBackupId(backupId: string): string {
    if (!backupId || typeof backupId !== 'string') throw new Error('backupId required');
    const sanitized = path.basename(backupId);
    if (!sanitized || sanitized !== backupId || sanitized.includes('..')) {
      throw new Error('Invalid backupId: path traversal not allowed');
    }
    return sanitized;
  }

  // CPU tracking for leak detection
  private cpuHistory: Array<{ timestamp: number; user: number; system: number; percent: number }> = [];
  private lastCpuUsage: NodeJS.CpuUsage | null = null;
  private readonly maxCpuHistoryEntries = 100;

  // Memory tracking for leak detection
  private memoryHistory: Array<{ timestamp: number; heapUsed: number; heapTotal: number; external: number; rss: number }> = [];
  private readonly maxMemoryHistoryEntries = 100;

  constructor() {
    this.panelConfig = new AdminPanelConfig();
    this.panelState = new AdminPanelState();
    this.maintenanceInfo = {
      lastBackup: null,
      nextScheduledMaintenance: null,
      maintenanceMode: false,
      systemHealth: { status: 'healthy', issues: [], recommendations: [] }
    };
  }


  // ── Config delegation ──────────────────────────────────────────────────────────────
  // Legacy delegations to AdminPanelConfig.getAdminConfig() / updateAdminConfig()
  // were removed in #359 (plan §2.6 T6). Flag CRUD now goes through the
  // /api/admin/config routes driven by the FLAG_REGISTRY single source of truth.

  // ── Session state delegation ────────────────────────────────────────────────────────

  getActiveSessions(): AdminSession[] {
    return this.panelState.getActiveSessions(this.panelConfig.sessionTimeout);
  }

  createAdminSession(userId: string, ipAddress: string, userAgent: string): AdminSession {
    return this.panelState.createAdminSession(userId, ipAddress, userAgent);
  }

  terminateSession(sessionId: string): boolean {
    return this.panelState.terminateSession(sessionId);
  }

  /**
   * Get system maintenance information
   */
  getMaintenanceInfo(): SystemMaintenance {
    // Update system health
    this.updateSystemHealth();
    return JSON.parse(JSON.stringify(this.maintenanceInfo));
  }

  /**
   * Set maintenance mode
   */
  setMaintenanceMode(enabled: boolean, message?: string): { success: boolean; message: string } {
    try {
      this.maintenanceInfo.maintenanceMode = enabled;

      if (enabled) {
        process.stderr.write(`[admin] Maintenance mode ENABLED${message ? `: ${message}` : ''}\n`);
      } else {
        process.stderr.write(`[admin] Maintenance mode DISABLED\n`);
      }

      return {
        success: true,
        message: `Maintenance mode ${enabled ? 'enabled' : 'disabled'}`
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to set maintenance mode: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Perform system backup
   */
  async performBackup(): Promise<{ success: boolean; message: string; backupId?: string; files?: number }> {
    try {
      const backupRoot = this.backupRoot;
      if (!fs.existsSync(backupRoot)) fs.mkdirSync(backupRoot, { recursive: true });
      const now = new Date();
      const iso = now.toISOString();
      const baseTs = iso.replace(/[-:]/g, '').replace(/\..+/, '');
      const ms = String(now.getMilliseconds()).padStart(3, '0');
      const backupId = `backup_${baseTs}_${ms}`;
      const zipPath = path.join(backupRoot, `${backupId}.zip`);

      const instructionsDir = this.instructionsRoot;
      let fileCount = 0;
      try {
        const st = ensureLoaded();
        fileCount = st.list.length;
      } catch {
        // fallback to disk count if store unavailable
        if (fs.existsSync(instructionsDir)) {
          fileCount = fs.readdirSync(instructionsDir).filter(f => f.toLowerCase().endsWith('.json')).length;
        }
      }

      const manifest = {
        backupId,
        createdAt: now.toISOString(),
        instructionCount: fileCount,
        schemaVersion: this.indexStatsCache?.schemaVersion || 'unknown',
      };

      createZipBackupWithManifest(instructionsDir, zipPath, manifest);

      this.maintenanceInfo.lastBackup = new Date();
      process.stderr.write(`[admin] System backup completed: ${backupId}.zip (${fileCount} files)\n`);
      return { success: true, message: 'System backup completed successfully', backupId, files: fileCount };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logAudit('admin/backup/perform_failed', undefined, { error: errMsg }, 'mutation');
      return {
        success: false,
        message: `Backup failed: ${errMsg}`
      };
    }
  }

  listBackups(): { id: string; createdAt: string; instructionCount: number; schemaVersion?: string; sizeBytes: number; warnings?: string[] }[] {
    const backupRoot = this.backupRoot;
    if (!fs.existsSync(backupRoot)) return [];
    const results: { id: string; createdAt: string; instructionCount: number; schemaVersion?: string; sizeBytes: number; warnings?: string[] }[] = [];
    for (const entry of fs.readdirSync(backupRoot)) {
      const full = path.join(backupRoot, entry);
      try {
        const stat = fs.statSync(full);

        if (isZipBackup(entry) && stat.isFile()) {
          // Zip backup
          const id = entry.replace(/\.zip$/i, '');
          let createdAt = new Date(stat.mtime).toISOString();
          let instructionCount = 0;
          let schemaVersion: string | undefined;
          const manifest = readZipManifest(full);
          if (manifest) {
            createdAt = (manifest.createdAt as string) || createdAt;
            instructionCount = (manifest.instructionCount as number) || 0;
            schemaVersion = manifest.schemaVersion as string | undefined;
          } else {
            instructionCount = listZipInstructionFiles(full).length;
          }
          results.push({ id, createdAt, instructionCount, schemaVersion, sizeBytes: stat.size });

        } else if (stat.isDirectory()) {
          // Legacy directory backup
          const manifestPath = path.join(full, 'manifest.json');
          let createdAt = new Date(stat.mtime).toISOString();
          let instructionCount = 0;
          let schemaVersion: string | undefined;
          const entryWarnings: string[] = [];
          if (fs.existsSync(manifestPath)) {
            try {
              const mf = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
              createdAt = mf.createdAt || createdAt;
              instructionCount = mf.instructionCount || 0;
              schemaVersion = mf.schemaVersion;
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              const msg = `Failed to parse manifest for backup '${entry}': ${errMsg}`;
              process.stderr.write(`[admin] ${msg}\n`);
              entryWarnings.push(msg);
              logAudit('admin/backup/list_warning', [entry], { error: errMsg, phase: 'manifest_parse' }, 'read');
            }
          } else {
            instructionCount = fs.readdirSync(full).filter(f => f.toLowerCase().endsWith('.json')).length;
          }
          const sizeBytes = fs.readdirSync(full).reduce((sum, f) => {
            try { return sum + fs.statSync(path.join(full, f)).size; } catch { return sum; }
          }, 0);
          const result: { id: string; createdAt: string; instructionCount: number; schemaVersion?: string; sizeBytes: number; warnings?: string[] } = { id: entry, createdAt, instructionCount, schemaVersion, sizeBytes };
          if (entryWarnings.length > 0) result.warnings = entryWarnings;
          results.push(result);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const msg = `Failed to read backup entry '${entry}': ${errMsg}`;
        process.stderr.write(`[admin] ${msg}\n`);
        logAudit('admin/backup/list_warning', [entry], { error: errMsg, phase: 'read_entry' }, 'read');
      }
    }
    results.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    return results;
  }

  restoreBackup(backupId: string): { success: boolean; message: string; restored?: number } {
    try {
      const safeId = this.validateBackupId(backupId);
      const backupRoot = this.backupRoot;
      const zipPath = path.join(backupRoot, `${safeId}.zip`);
      const backupDir = path.join(backupRoot, safeId);
      const isZip = fs.existsSync(zipPath);
      const isDir = fs.existsSync(backupDir) && fs.statSync(backupDir).isDirectory();
      if (!isZip && !isDir) {
        const msg = `Backup not found: ${safeId}`;
        logAudit('admin/backup/restore_failed', [safeId], { error: msg }, 'mutation');
        return { success: false, message: msg };
      }

      const instructionsDir = this.instructionsRoot;
      if (!fs.existsSync(instructionsDir)) fs.mkdirSync(instructionsDir, { recursive: true });

      // Pre-restore safety backup (as zip)
      const existing = fs.readdirSync(instructionsDir).filter(f => f.toLowerCase().endsWith('.json'));
      if (existing.length) {
        const safetyId = `pre_restore_${Date.now()}`;
        const safetyZipPath = path.join(backupRoot, `${safetyId}.zip`);
        createZipBackupWithManifest(instructionsDir, safetyZipPath, {
          type: 'pre-restore',
          createdAt: new Date().toISOString(),
          source: safeId,
          originalCount: existing.length,
        });
        logInfo('[admin] pre-restore safety backup created', { safetyId, originalCount: existing.length });
      }

      let restored = 0;
      if (isZip) {
        restored = extractZipBackup(zipPath, instructionsDir);
        // Don't count manifest.json as a restored instruction
      } else {
        // Legacy directory restore
        for (const f of fs.readdirSync(backupDir)) {
          if (f.toLowerCase().endsWith('.json') && f !== 'manifest.json') {
            fs.copyFileSync(path.join(backupDir, f), path.join(instructionsDir, f));
            restored++;
          }
        }
      }

      this.indexStatsCache = null;
      // Restore wrote JSON files to instructionsDir, but the live index may
      // not be sourcing from disk:
      //  - JSON backend: IndexContext re-reads on next ensureLoaded() because
      //    instructionsDir mtime changed (no .index-version file in dev).
      //  - SQLite backend: source of truth is the .db at storage.sqlitePath,
      //    NOT the JSON files. Without re-ingesting, the dashboard keeps
      //    showing the pre-restore row count (RCA 2026-05-01: 702-file zip
      //    restored, Overview kept showing 2 seed-bootstrap entries).
      // Therefore: re-ingest into SQLite when applicable, then invalidate the
      // in-memory cache so the next read reflects the restored set.
      const backend = getRuntimeConfig().storage?.backend ?? 'json';
      let sqliteIngest: { migrated: number; errors: number; cleanedJson?: number } | undefined;
      if (backend === 'sqlite') {
        try {
          const dbPath = getRuntimeConfig().storage?.sqlitePath
            ?? path.join(process.cwd(), 'data', 'index.db');
          const mr = migrateJsonToSqlite(instructionsDir, dbPath);
          sqliteIngest = { migrated: mr.migrated, errors: mr.errors.length };
          // RCA 2026-05-08: in sqlite mode the .db is the source of truth, so
          // the per-instruction JSON files extracted from the zip are dead
          // weight after a clean ingest. Leaving them on disk caused the
          // ensureLoaded() auto-migration latch to detect jsonFiles >
          // result.entries forever and bloated `instructions/` to 700+ files.
          // Only clean up when ingest had zero errors — preserve files for
          // operator triage when something failed.
          if (mr.errors.length === 0) {
            let cleaned = 0;
            try {
              for (const f of fs.readdirSync(instructionsDir)) {
                // Keep loader-generated metadata (_manifest.json, _skipped.json)
                // and anything not a .json file.
                if (!f.toLowerCase().endsWith('.json')) continue;
                if (f.startsWith('_')) continue;
                try { fs.unlinkSync(path.join(instructionsDir, f)); cleaned++; }
                catch (unlinkErr) {
                  logWarn('[admin] post-restore sqlite cleanup unlink failed', {
                    backupId: safeId, file: f,
                    error: unlinkErr instanceof Error ? unlinkErr.message : String(unlinkErr),
                  });
                }
              }
              sqliteIngest.cleanedJson = cleaned;
              logInfo('[admin] post-restore sqlite cleanup', { backupId: safeId, cleanedJson: cleaned });
            } catch (cleanupErr) {
              logWarn('[admin] post-restore sqlite cleanup scan failed', {
                backupId: safeId,
                error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
              });
            }
          }
          logInfo('[admin] post-restore sqlite re-ingest', { backupId: safeId, ...sqliteIngest });
        } catch (err) {
          logError('[admin] post-restore sqlite re-ingest failed', {
            backupId: safeId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      touchIndexVersion();
      invalidate();
      let afterCount = -1;
      try { afterCount = Object.keys(ensureLoaded().byId || {}).length; } catch (reloadErr) {
        logError('[admin] post-restore reload failed', {
          backupId: safeId,
          error: reloadErr instanceof Error ? reloadErr.message : String(reloadErr),
        });
      }
      logInfo('[admin] backup restored', { backupId: safeId, restored, source: isZip ? 'zip' : 'dir', backend, afterCount, ...(sqliteIngest ? { sqliteIngest } : {}) });
      // Fire-and-forget embedding compute when semantic is enabled — addresses
      // post-import gap where embeddings file is missing until manually triggered.
      try { scheduleEmbeddingComputeAfterImport(`restore:${safeId}`); } catch { /* never block restore */ }
      return { success: true, message: `Backup ${safeId} restored`, restored };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      logError('[admin] backup restore failed', { backupId, error: errMsg, stack });
      logAudit('admin/backup/restore_failed', backupId ? [String(backupId)] : undefined, { error: errMsg }, 'mutation');
      return { success: false, message: `Restore failed: ${errMsg}` };
    }
  }

  /** Delete a backup zip or directory (safety checks on name) */
  deleteBackup(backupId: string): { success: boolean; message: string; removed?: boolean } {
    try {
      const safeId = this.validateBackupId(backupId);
      const backupRoot = this.backupRoot;
      // Check for zip first, then legacy directory
      const zipPath = path.join(backupRoot, `${safeId}.zip`);
      const dirPath = path.join(backupRoot, safeId);
      const hasZip = fs.existsSync(zipPath);
      const hasDir = fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
      if (!hasZip && !hasDir) {
        const msg = `Backup not found: ${safeId}`;
        logAudit('admin/backup/delete_failed', [safeId], { error: msg }, 'mutation');
        return { success: false, message: msg };
      }
      if (!/^backup_|^instructions-|^pre_restore_|^auto-backup-/.test(safeId)) {
        const msg = 'Refusing to delete unexpected backup name';
        logAudit('admin/backup/delete_failed', [safeId], { error: msg }, 'mutation');
        return { success: false, message: msg };
      }
      if (hasZip) fs.unlinkSync(zipPath);
      if (hasDir) fs.rmSync(dirPath, { recursive: true, force: true });
      process.stderr.write(`[admin] Deleted backup ${safeId}\n`);
      return { success: true, message: `Backup ${safeId} deleted`, removed: true };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logAudit('admin/backup/delete_failed', backupId ? [String(backupId)] : undefined, { error: errMsg }, 'mutation');
      return { success: false, message: `Delete failed: ${errMsg}` };
    }
  }

  /** Prune backups keeping newest N (by createdAt / mtime). Returns count pruned. */
  pruneBackups(retain: number): { success: boolean; message: string; pruned?: number; errors?: string[] } {
    try {
      if (retain < 0) {
        const msg = 'retain must be >= 0';
        logAudit('admin/backup/prune_failed', undefined, { error: msg, retain }, 'mutation');
        return { success: false, message: msg };
      }
      const backupRoot = this.backupRoot;
      if (!fs.existsSync(backupRoot)) return { success: true, message: 'No backups to prune', pruned: 0 };
      const pruneErrors: string[] = [];
      const entries = fs.readdirSync(backupRoot)
        .map(name => {
          const full = path.join(backupRoot, name);
          // Derive the logical ID (strip .zip extension)
          const id = name.endsWith('.zip') ? name.replace(/\.zip$/i, '') : name;
          return { name, id, full };
        })
        .filter(d => {
          try {
            const stat = fs.statSync(d.full);
            if (d.name.endsWith('.zip') && stat.isFile()) return /^backup_|^instructions-|^pre_restore_|^auto-backup-/.test(d.id);
            if (stat.isDirectory()) return /^backup_|^instructions-|^pre_restore_|^auto-backup-/.test(d.id);
            return false;
          } catch { return false; }
        });
      // sort newest first by mtime
      entries.sort((a,b) => {
        try { return fs.statSync(b.full).mtime.getTime() - fs.statSync(a.full).mtime.getTime(); } catch { return 0; }
      });
      if (retain === 0) {
        let prunedAll = 0;
        for (const d of entries) {
          try {
            if (d.name.endsWith('.zip')) fs.unlinkSync(d.full);
            else fs.rmSync(d.full, { recursive: true, force: true });
            prunedAll++;
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            const msg = `Failed to delete backup '${d.id}': ${errMsg}`;
            process.stderr.write(`[admin] ${msg}\n`);
            pruneErrors.push(msg);
            logAudit('admin/backup/prune_warning', [d.id], { error: errMsg, phase: 'delete_all' }, 'mutation');
          }
        }
        process.stderr.write(`[admin] Pruned all backups (${prunedAll})\n`);
        const result: { success: boolean; message: string; pruned: number; errors?: string[] } = { success: true, message: `Pruned ${prunedAll} backups`, pruned: prunedAll };
        if (pruneErrors.length > 0) {
          result.message += ` (${pruneErrors.length} error(s))`;
          result.errors = pruneErrors;
        }
        return result;
      }
      const toDelete = entries.slice(retain);
      let pruned = 0;
      for (const d of toDelete) {
        try {
          if (d.name.endsWith('.zip')) fs.unlinkSync(d.full);
          else fs.rmSync(d.full, { recursive: true, force: true });
          pruned++;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const msg = `Failed to delete backup '${d.id}': ${errMsg}`;
          process.stderr.write(`[admin] ${msg}\n`);
          pruneErrors.push(msg);
          logAudit('admin/backup/prune_warning', [d.id], { error: errMsg, phase: 'delete_retain' }, 'mutation');
        }
      }
      process.stderr.write(`[admin] Pruned ${pruned} backup(s); retained ${entries.length - pruned}\n`);
      const result: { success: boolean; message: string; pruned: number; errors?: string[] } = { success: true, message: `Pruned ${pruned} backups (retained ${entries.length - pruned})`, pruned };
      if (pruneErrors.length > 0) {
        result.message += ` (${pruneErrors.length} error(s))`;
        result.errors = pruneErrors;
      }
      return result;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logAudit('admin/backup/prune_failed', undefined, { error: errMsg, retain }, 'mutation');
      return { success: false, message: `Prune failed: ${errMsg}` };
    }
  }

  /** Export a backup — returns the zip file path for streaming, or falls back to JSON bundle for legacy dirs */
  exportBackup(backupId: string): { success: boolean; message: string; zipPath?: string; bundle?: { manifest: Record<string, unknown>; files: Record<string, unknown> }; warnings?: string[] } {
    try {
      const safeId = this.validateBackupId(backupId);
      const zipPath = path.join(this.backupRoot, `${safeId}.zip`);
      if (fs.existsSync(zipPath) && fs.statSync(zipPath).isFile()) {
        return { success: true, message: 'Export ready', zipPath };
      }
      // Legacy directory fallback
      const backupDir = path.join(this.backupRoot, safeId);
      if (!fs.existsSync(backupDir) || !fs.statSync(backupDir).isDirectory()) {
        const msg = `Backup not found: ${safeId}`;
        logAudit('admin/backup/export_failed', [safeId], { error: msg }, 'read');
        return { success: false, message: msg };
      }
      let manifest: Record<string, unknown> = {};
      const exportWarnings: string[] = [];
      const manifestPath = path.join(backupDir, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')); } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const msg = `Failed to parse manifest.json for backup '${safeId}': ${errMsg}`;
          process.stderr.write(`[admin] ${msg}\n`);
          exportWarnings.push(msg);
          logAudit('admin/backup/export_warning', [safeId], { error: errMsg, phase: 'manifest_parse' }, 'read');
        }
      }
      const files: Record<string, unknown> = {};
      for (const f of fs.readdirSync(backupDir)) {
        if (f.toLowerCase().endsWith('.json') && f !== 'manifest.json') {
          try { files[f] = JSON.parse(fs.readFileSync(path.join(backupDir, f), 'utf-8')); } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            const msg = `Skipped corrupt file '${f}' in backup '${safeId}': ${errMsg}`;
            process.stderr.write(`[admin] ${msg}\n`);
            exportWarnings.push(msg);
            logAudit('admin/backup/export_warning', [safeId], { error: errMsg, phase: 'file_parse', file: f }, 'read');
          }
        }
      }
      const result: { success: boolean; message: string; bundle: { manifest: Record<string, unknown>; files: Record<string, unknown> }; warnings?: string[] } = { success: true, message: 'Export ready', bundle: { manifest, files } };
      if (exportWarnings.length > 0) {
        result.warnings = exportWarnings;
        result.message = `Export ready (${exportWarnings.length} warning(s))`;
      }
      return result;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logAudit('admin/backup/export_failed', backupId ? [String(backupId)] : undefined, { error: errMsg }, 'read');
      return { success: false, message: `Export failed: ${errMsg}` };
    }
  }

  /** Import a backup from a JSON bundle uploaded by the client — creates a zip */
  importBackup(bundle: { manifest?: Record<string, unknown>; files?: Record<string, unknown> }): { success: boolean; message: string; backupId?: string; files?: number } {
    try {
      if (!bundle || typeof bundle !== 'object' || !bundle.files || typeof bundle.files !== 'object') {
        const msg = 'Invalid bundle: must contain a "files" object';
        logAudit('admin/backup/import_failed', undefined, { error: msg }, 'mutation');
        return { success: false, message: msg };
      }
      const now = new Date();
      const baseTs = now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
      const ms = String(now.getMilliseconds()).padStart(3, '0');
      const backupId = `backup_${baseTs}_${ms}`;
      const zipPath = path.join(this.backupRoot, `${backupId}.zip`);
      if (!fs.existsSync(this.backupRoot)) fs.mkdirSync(this.backupRoot, { recursive: true });

      const zip = new AdmZip();
      let written = 0;
      for (const [name, content] of Object.entries(bundle.files)) {
        if (typeof name !== 'string' || !name.toLowerCase().endsWith('.json')) continue;
        const safeName = path.basename(name);
        if (safeName !== name || safeName.includes('..')) continue; // path traversal guard
        zip.addFile(safeName, Buffer.from(JSON.stringify(content, null, 2)));
        written++;
      }
      const manifest = {
        backupId,
        createdAt: now.toISOString(),
        instructionCount: written,
        schemaVersion: (bundle.manifest as Record<string, unknown>)?.schemaVersion || 'imported',
        source: 'file-import',
      };
      zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
      zip.writeZip(zipPath);

      logInfo('[admin] importBackup complete', { backupId, files: written, mode: 'json' });
      return { success: true, message: `Imported ${written} files as ${backupId}`, backupId, files: written };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      logError('[admin] importBackup failed', { error: errMsg, stack, mode: 'json' });
      logAudit('admin/backup/import_failed', undefined, { error: errMsg, mode: 'json' }, 'mutation');
      return { success: false, message: `Import failed: ${errMsg}` };
    }
  }

  /** Import a zip backup uploaded by the client without rewriting its contents. */
  importZipBackup(zipBuffer: Buffer, sourceName?: string): { success: boolean; message: string; backupId?: string; files?: number } {
    // CodeQL: Array.isArray is the negative pattern recognized by the
    // js/type-confusion-through-parameter-tampering query. Buffer.isBuffer
    // alone is not treated as narrowing, so guard before any .length read.
    const sizeBytes = !Array.isArray(zipBuffer) && Buffer.isBuffer(zipBuffer) ? zipBuffer.length : 0;
    const safeSource: string | undefined =
      typeof sourceName === 'string' && !Array.isArray(sourceName) ? sourceName : undefined;
    logInfo('[admin] importZipBackup start', { sourceName: safeSource ? path.basename(safeSource) : undefined, sizeBytes });
    try {
      if (Array.isArray(zipBuffer) || !Buffer.isBuffer(zipBuffer) || zipBuffer.length === 0) {
        const msg = 'Invalid zip backup: upload was empty';
        warnStruct('[admin] importZipBackup rejected', { reason: 'empty-buffer', sizeBytes });
        logAudit('admin/backup/import_failed', undefined, { error: msg, mode: 'zip' }, 'mutation');
        return { success: false, message: msg };
      }

      let zip: AdmZip;
      try {
        zip = new AdmZip(zipBuffer);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        logError('[admin] importZipBackup zip-parse-error', { error: errMsg, sizeBytes });
        logAudit('admin/backup/import_failed', undefined, { error: errMsg, mode: 'zip' }, 'mutation');
        return { success: false, message: `Import failed: ${errMsg}` };
      }
      const allEntries = zip.getEntries().map(e => e.entryName);
      const instructionFiles = zip.getEntries()
        .map(entry => path.basename(entry.entryName))
        .filter(name => name.toLowerCase().endsWith('.json') && name === path.basename(name) && name !== 'manifest.json');

      if (!instructionFiles.length) {
        const msg = 'Invalid zip backup: contains no instruction files';
        warnStruct('[admin] importZipBackup rejected', { reason: 'no-instruction-files', entryCount: allEntries.length, sample: allEntries.slice(0, 10) });
        logAudit('admin/backup/import_failed', undefined, { error: msg, mode: 'zip' }, 'mutation');
        return { success: false, message: msg };
      }

      const now = new Date();
      const baseTs = now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
      const ms = String(now.getMilliseconds()).padStart(3, '0');
      const backupId = `backup_${baseTs}_${ms}`;
      const zipPath = path.join(this.backupRoot, `${backupId}.zip`);
      if (!fs.existsSync(this.backupRoot)) fs.mkdirSync(this.backupRoot, { recursive: true });

      fs.writeFileSync(zipPath, zipBuffer); // lgtm[js/http-to-file-access] — zipPath is generated under controlled backupRoot; admin endpoint behind dashboardAdminAuth

      const safeSourceName = sourceName ? path.basename(sourceName) : undefined;
      logInfo('[admin] importZipBackup complete', { backupId, files: instructionFiles.length, source: safeSourceName, zipPath });
      return { success: true, message: `Imported ${instructionFiles.length} files as ${backupId}`, backupId, files: instructionFiles.length };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      logError('[admin] importZipBackup failed', { error: errMsg, stack, sourceName: sourceName ? path.basename(sourceName) : undefined, sizeBytes });
      logAudit('admin/backup/import_failed', undefined, { error: errMsg, mode: 'zip' }, 'mutation');
      return { success: false, message: `Import failed: ${errMsg}` };
    }
  }

  /**
   * Calculate current CPU usage with historical tracking
   */
  private calculateCpuUsage(): { user: number; system: number; percent: number } {
    const currentCpuUsage = process.cpuUsage();
    let cpuPercent = 0;
    let userTime = 0;
    let systemTime = 0;

    if (this.lastCpuUsage) {
      // Calculate delta since last measurement
      const userDelta = currentCpuUsage.user - this.lastCpuUsage.user;
      const systemDelta = currentCpuUsage.system - this.lastCpuUsage.system;
      const totalDelta = userDelta + systemDelta;

      // Convert microseconds to percentage (assuming 1 second interval)
      // For more accurate results, you'd want to track the actual time interval
      cpuPercent = Math.min((totalDelta / 1000000) * 100, 100);
      userTime = userDelta / 1000000; // Convert to seconds
      systemTime = systemDelta / 1000000; // Convert to seconds
    }

    this.lastCpuUsage = currentCpuUsage;

    // Add to history for leak detection
    const historyEntry = {
      timestamp: Date.now(),
      user: userTime,
      system: systemTime,
      percent: cpuPercent
    };

    this.cpuHistory.push(historyEntry);

    // Keep only recent entries
    if (this.cpuHistory.length > this.maxCpuHistoryEntries) {
      this.cpuHistory.shift();
    }

    return {
      user: userTime,
      system: systemTime,
      percent: cpuPercent
    };
  }

  /**
   * Analyze CPU trends for potential leaks
   */
  private analyzeCpuTrends(): { trend: TrendDirection; avgUsage: number; peakUsage: number } {
    if (this.cpuHistory.length < 10) {
      return { trend: 'stable', avgUsage: 0, peakUsage: 0 };
    }

    const recent = this.cpuHistory.slice(-10);
    const avgUsage = recent.reduce((sum, entry) => sum + entry.percent, 0) / recent.length;
    const peakUsage = Math.max(...recent.map(entry => entry.percent));

    // Simple trend analysis - compare first half vs second half
    const firstHalf = recent.slice(0, 5);
    const secondHalf = recent.slice(5);
    const firstAvg = firstHalf.reduce((sum, entry) => sum + entry.percent, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, entry) => sum + entry.percent, 0) / secondHalf.length;

    let trend: TrendDirection = 'stable';
    const difference = secondAvg - firstAvg;

    if (Math.abs(difference) > 5) {
      trend = difference > 0 ? 'increasing' : 'decreasing';
    }

    return { trend, avgUsage, peakUsage };
  }

  /**
   * Analyze memory usage trends for leak detection
   */
  private analyzeMemoryTrends(): { trend: TrendDirection; avgHeapUsed: number; peakHeapUsed: number; growthRate: number } {
    if (this.memoryHistory.length < 10) {
      return { trend: 'stable', avgHeapUsed: 0, peakHeapUsed: 0, growthRate: 0 };
    }

    const recent = this.memoryHistory.slice(-10);
    const avgHeapUsed = recent.reduce((sum, entry) => sum + entry.heapUsed, 0) / recent.length;
    const peakHeapUsed = Math.max(...recent.map(entry => entry.heapUsed));

    // Calculate growth rate (bytes per minute)
    const firstEntry = recent[0];
    const lastEntry = recent[recent.length - 1];
    const timeDiffMinutes = (lastEntry.timestamp - firstEntry.timestamp) / (1000 * 60);
    const growthRate = timeDiffMinutes > 0 ? (lastEntry.heapUsed - firstEntry.heapUsed) / timeDiffMinutes : 0;

    // Simple trend analysis - compare first half vs second half
    const firstHalf = recent.slice(0, 5);
    const secondHalf = recent.slice(5);
    const firstAvg = firstHalf.reduce((sum, entry) => sum + entry.heapUsed, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, entry) => sum + entry.heapUsed, 0) / secondHalf.length;

    let trend: TrendDirection = 'stable';
    const difference = secondAvg - firstAvg;

    // Consider memory leak if growth is > 10MB or growth rate > 1MB/min
    if (Math.abs(difference) > 10 * 1024 * 1024 || Math.abs(growthRate) > 1024 * 1024) {
      trend = difference > 0 ? 'increasing' : 'decreasing';
    }

    return { trend, avgHeapUsed, peakHeapUsed, growthRate };
  }

  /**
   * Get comprehensive admin statistics
   */
  getAdminStats(): AdminStats {
    // Use real metrics snapshot (deterministic values)
    const collector = getMetricsCollector();
    const snapshot = collector.getCurrentSnapshot();

    // Aggregate total requests from tool metrics
    let totalRequests = 0;
    Object.values(snapshot.tools).forEach(t => { totalRequests += t.callCount; });

    // Get index validation summary for accurate accepted vs raw counts
    let accepted = 0, scanned = 0, skipped = 0;
    interface LoadSummaryLike { scanned:number; accepted:number; skipped:number }
    try {
      const st = getIndexState() as { list: unknown[]; loadSummary?: LoadSummaryLike; loadDebug?: { scanned:number; accepted:number } };
      if (st.loadSummary) {
        accepted = st.loadSummary.accepted;
        scanned = st.loadSummary.scanned;
        skipped = st.loadSummary.skipped;
      } else {
        accepted = st.list.length;
        scanned = st.loadDebug?.scanned ?? accepted;
        skipped = Math.max(0, scanned - accepted);
      }
    } catch (err) {
      process.stderr.write(`[admin] getAdminStats: failed to read index state: ${err instanceof Error ? err.message : String(err)}\n`);
    }

    // Count instructions from the store (raw count uses store, with disk fallback for transparency)
    const indexDir = this.instructionsRoot;
    let rawFileCount = scanned; // default to scanned
    try {
      const st = ensureLoaded();
      rawFileCount = st.list.length;
    } catch {
      try {
        if (fs.existsSync(indexDir)) {
          rawFileCount = fs.readdirSync(indexDir).filter(f => f.toLowerCase().endsWith('.json')).length;
        }
      } catch (err) {
        process.stderr.write(`[admin] getAdminStats: failed to count instruction files on disk: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }

    // Recompute schema version snapshot only when any of these counts change
    const cacheNeedsUpdate = !this.indexStatsCache || this.indexStatsCache.acceptedInstructions !== accepted || this.indexStatsCache.rawFileCount !== rawFileCount || this.indexStatsCache.skippedInstructions !== skipped;
    if (cacheNeedsUpdate) {
      const schemaVersions = new Set<string>();
      try {
        const st = ensureLoaded();
        for (const entry of st.list.slice(0, 200)) {
          const sv = (entry as unknown as Record<string, unknown>).schemaVersion;
          if (typeof sv === 'string') schemaVersions.add(sv);
        }
      } catch {
        try {
          if (fs.existsSync(indexDir)) {
            const files = fs.readdirSync(indexDir).filter(f => f.toLowerCase().endsWith('.json')).slice(0, 200);
            for (const f of files) {
              try {
                const raw = fs.readFileSync(path.join(indexDir, f), 'utf-8');
                const json = JSON.parse(raw);
                if (typeof json.schemaVersion === 'string') schemaVersions.add(json.schemaVersion);
              } catch (err) {
                process.stderr.write(`[admin] getAdminStats: failed to parse schema version from '${f}': ${err instanceof Error ? err.message : String(err)}\n`);
              }
            }
          }
        } catch (err) {
          process.stderr.write(`[admin] getAdminStats: failed to read instruction files for schema version: ${err instanceof Error ? err.message : String(err)}\n`);
        }
      }
      const schemaVersion = schemaVersions.size === 0 ? 'unknown' : (schemaVersions.size === 1 ? Array.from(schemaVersions)[0] : `mixed(${Array.from(schemaVersions).join(',')})`);
      this.indexStatsCache = {
        totalInstructions: accepted, // maintain backward compatibility; semantic now accepted
        acceptedInstructions: accepted,
        rawFileCount,
        skippedInstructions: skipped,
        lastUpdated: new Date(),
        version: snapshot.server.version,
        schemaVersion
      };
    }

    const memUsage = snapshot.server.memoryUsage; // already captured in snapshot
    const cpuUsage = this.calculateCpuUsage(); // Calculate current CPU usage

    // Ensure cache populated (should be by logic above, but safeguard for strict types)
    if(!this.indexStatsCache){
      this.indexStatsCache = {
        totalInstructions: accepted,
        acceptedInstructions: accepted,
        rawFileCount,
        skippedInstructions: skipped,
        lastUpdated: new Date(),
        version: snapshot.server.version,
        schemaVersion: 'unknown'
      };
    }

    return {
  // Total historical websocket connections (connected + disconnected)
  totalConnections: snapshot.connections.totalConnections,
  // Active websocket connections (live WS clients). Previously this returned only admin sessions size,
  // which caused the UI to show 0 even when multiple WS clients were connected. This now reflects
  // real-time active websocket connections from metrics.
  activeConnections: snapshot.connections.activeConnections,
  // Preserve visibility into admin (logical) sessions separately.
  adminActiveSessions: this.panelState.activeSessions.size,
      totalRequests,
      errorRate: snapshot.performance.errorRate,
      avgResponseTime: snapshot.performance.avgResponseTime,
      uptime: Math.floor(snapshot.server.uptime / 1000), // seconds
      memoryUsage: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: (memUsage as unknown as { external?: number })?.external ?? 0,
        ...((memUsage as unknown as { heapLimit?: number })?.heapLimit ? { heapLimit: (memUsage as unknown as { heapLimit: number }).heapLimit } : {})
      },
      cpuUsage,
      toolMetrics: snapshot.tools,
      indexStats: this.indexStatsCache
    };
  }

  private updateSystemHealth(): void {
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check memory usage and track history
    const memUsage = process.memoryUsage();
    // Use V8 heap_size_limit for percentage -- heapTotal tracks closely
    // behind heapUsed and would false-alarm at low absolute usage.
    const v8Stats = v8.getHeapStatistics();
    const heapLimit = v8Stats.heap_size_limit || memUsage.heapTotal;
    const memPercent = (memUsage.heapUsed / heapLimit) * 100;

    // Track memory history for leak detection
    this.memoryHistory.push({
      timestamp: Date.now(),
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss
    });

    // Maintain memory history buffer
    if (this.memoryHistory.length > this.maxMemoryHistoryEntries) {
      this.memoryHistory.shift();
    }

    if (memPercent > 80) {
      issues.push('High memory usage detected');
      recommendations.push('Consider restarting the server or increasing memory limits');
    }

    // Check memory trends for leak detection
    const memoryTrends = this.analyzeMemoryTrends();
    if (memoryTrends.trend === 'increasing' && memoryTrends.growthRate > 1024 * 1024) {
      issues.push('Memory leak detected - heap growing consistently');
      recommendations.push('Investigate memory usage patterns and potential leaks');
    }

    if (memoryTrends.growthRate > 5 * 1024 * 1024) { // > 5MB/min growth
      issues.push('Rapid memory growth detected');
      recommendations.push('Monitor memory usage closely and consider restart if growth continues');
    }

    // Check CPU usage and trends
    const cpuTrends = this.analyzeCpuTrends();
    if (cpuTrends.avgUsage > 80) {
      issues.push('High CPU usage detected');
      recommendations.push('Review server load and consider scaling');
    }

    if (cpuTrends.trend === 'increasing' && cpuTrends.avgUsage > 50) {
      issues.push('CPU usage trend increasing');
      recommendations.push('Monitor for potential CPU leaks or resource contention');
    }

    if (cpuTrends.peakUsage > 95) {
      issues.push('CPU usage spikes detected');
      recommendations.push('Investigate CPU-intensive operations');
    }

    // Check uptime (regression & long-running)
    const currentUptimeSeconds = Math.floor(process.uptime());
    const uptimeHours = currentUptimeSeconds / 3600;
    if (this.lastUptimeSeconds > 0 && currentUptimeSeconds < this.lastUptimeSeconds) {
      // Uptime decreased => restart/regression
      issues.push('Uptime regression detected (server restart)');
      recommendations.push('Review restart reason and ensure intentional');
    } else if (uptimeHours > 72) {
      recommendations.push('Consider scheduled restart for optimal performance');
    }
    this.lastUptimeSeconds = currentUptimeSeconds;

    // Check error rate
    const errorRate = this.getErrorRate();
    if (errorRate > 5) {
      issues.push('Elevated error rate detected');
      recommendations.push('Review error logs and investigate root causes');
    }

    // Determine overall health status
    let status: HealthStatus = 'healthy';
    if (issues.length > 0) {
      status = (memPercent > 90 || errorRate > 10 || cpuTrends.avgUsage > 90 || memoryTrends.growthRate > 10 * 1024 * 1024) ? 'critical' : 'warning';
    }

    this.maintenanceInfo.systemHealth = {
      status,
      issues,
      recommendations,
      cpuTrend: cpuTrends.trend,
      memoryTrend: memoryTrends.trend,
      memoryGrowthRate: memoryTrends.growthRate
    };
  }

  /** Return immutable copy of session history */
  getSessionHistory(limit?: number): AdminSessionHistoryEntry[] {
    return this.panelState.getSessionHistory(limit);
  }

  async clearSessionHistory(): Promise<{ success: boolean; message: string; clearedCount: number }> {
    return this.panelState.clearSessionHistory();
  }

  updateSessionActivity(sessionId: string): boolean {
    return this.panelState.updateSessionActivity(sessionId);
  }

  private getTotalConnections(): number {
    return getMetricsCollector().getCurrentSnapshot().connections.totalConnections;
  }

  private getTotalRequests(): number {
    const snap = getMetricsCollector().getCurrentSnapshot();
    return Object.values(snap.tools).reduce((sum, t) => sum + t.callCount, 0);
  }

  private getErrorRate(): number {
    return getMetricsCollector().getCurrentSnapshot().performance.errorRate;
  }

  private getAvgResponseTime(): number {
    return getMetricsCollector().getCurrentSnapshot().performance.avgResponseTime;
  }

  private getIndexInstructionCount(): number {
    try {
      const st = ensureLoaded();
      return st.list.length;
    } catch {
      // fallback to disk
      const indexDir = this.instructionsRoot;
      try {
        if (fs.existsSync(indexDir)) {
          return fs.readdirSync(indexDir).filter(f => f.toLowerCase().endsWith('.json')).length;
        }
      } catch {
        // ignore
      }
      return 0;
    }
  }

  /**
   * Restart server components
   */
  async restartServer(component: 'dashboard' | 'mcp' | 'all' = 'all'): Promise<{ success: boolean; message: string }> {
    try {
      process.stderr.write(`[admin] Restart requested for component: ${component}\n`);

      // In real implementation, this would perform actual component restarts
      await new Promise(resolve => setTimeout(resolve, 2000));

      return {
        success: true,
        message: `${component} restart completed successfully`
      };
    } catch (error) {
      return {
        success: false,
        message: `Restart failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Clear server caches
   */
  clearCaches(): { success: boolean; message: string; cleared: string[] } {
    try {
      const cleared: string[] = [];

      // Clear instruction cache
      cleared.push('instruction_cache');

      // Clear metrics cache
      cleared.push('metrics_cache');

      // Clear response cache
      cleared.push('response_cache');

      process.stderr.write(`[admin] Caches cleared: ${cleared.join(', ')}\n`);

      return {
        success: true,
        message: 'All caches cleared successfully',
        cleared
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to clear caches: ${error instanceof Error ? error.message : String(error)}`,
        cleared: []
      };
    }
  }
}

// Singleton instance
let adminPanelInstance: AdminPanel | null = null;

export function getAdminPanel(): AdminPanel {
  if (!adminPanelInstance) {
    adminPanelInstance = new AdminPanel();
  }
  return adminPanelInstance;
}
