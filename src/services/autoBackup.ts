/**
 * Automatic periodic backup of the instruction index.
 *
 * Creates zip archives of all .json files from the instructions directory
 * into the configured backups directory. When INDEX_SERVER_BACKUPS_DIR is not
 * set, the backups directory is derived from the instructions directory (a
 * `backups` sibling), so auto-backup targets the right store without any
 * backup-specific configuration. Old auto-backups are pruned when their count
 * exceeds the configured maximum.
 *
 * Env vars (via runtimeConfig.mutation):
 *   INDEX_SERVER_AUTO_BACKUP_INTERVAL_MS — timer interval (default 3600000 = 1h)
 *   INDEX_SERVER_AUTO_BACKUP_MAX_COUNT   — max retained auto-backups (default 10)
 *   INDEX_SERVER_AUTO_BACKUP_ALLOW_IMPLICIT_DIR — opt out of the source/target
 *     mismatch guard (see getAutoBackupSourceMismatch)
 */
import fs from 'fs';
import path from 'path';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { isTruthy } from '../utils/envUtils';
import { createZipBackup } from './backupZip';

const AUTO_BACKUP_PREFIX = 'auto-backup-';
const ALLOW_IMPLICIT_DIR_ENV = 'INDEX_SERVER_AUTO_BACKUP_ALLOW_IMPLICIT_DIR';
let _timer: ReturnType<typeof setInterval> | null = null;

function getInstructionsDir(): string {
  return getRuntimeConfig().index.baseDir;
}

function getBackupsDir(): string {
  return getRuntimeConfig().dashboard.admin.backupsDir;
}

function isEnvSet(name: string): boolean {
  return (process.env[name] ?? '').trim() !== '';
}

/**
 * Detects the dangerous configuration where the backup *target* is explicitly
 * configured but the backup *source* is not.
 *
 * By default the target follows the source: when INDEX_SERVER_BACKUPS_DIR is unset,
 * `dashboard.admin.backupsDir` resolves to a `backups` sibling of `index.baseDir`, so
 * neither env var is needed for auto-backup to archive the right directory.
 *
 * The one case that cannot be inferred is an explicit INDEX_SERVER_BACKUPS_DIR with no
 * INDEX_SERVER_DIR: `index.baseDir` then silently falls back to `<cwd>/instructions`,
 * so the real backup store would receive archives of whatever instruction files happen
 * to ship next to the server binary — indistinguishable from real backups by name, and
 * destructive if restored.
 *
 * Returns a human-readable reason string when the mismatch is present, else null.
 */
export function getAutoBackupSourceMismatch(): string | null {
  if (isTruthy(process.env[ALLOW_IMPLICIT_DIR_ENV])) return null;
  if (isEnvSet('INDEX_SERVER_DIR')) return null;
  if (!isEnvSet('INDEX_SERVER_BACKUPS_DIR')) return null;
  return `INDEX_SERVER_DIR is not set, so the auto-backup source falls back to "${getInstructionsDir()}" `
    + `(derived from cwd), while INDEX_SERVER_BACKUPS_DIR explicitly targets "${getBackupsDir()}". `
    + `Refusing to write auto-backups of an unintended source directory. `
    + `Set INDEX_SERVER_DIR to the index being backed up, or set ${ALLOW_IMPLICIT_DIR_ENV}=1 to override.`;
}

/**
 * Run a single auto-backup cycle. Returns the backup zip file path,
 * or null if the instructions directory is empty / doesn't exist / the
 * source and target directories are mismatched.
 */
export function runAutoBackupOnce(): string | null {
  const mismatch = getAutoBackupSourceMismatch();
  if (mismatch) {
    try { process.stderr.write(`[auto-backup] skipped: ${mismatch}\n`); } catch { /* ignore */ }
    return null;
  }

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

  try { process.stderr.write(`[auto-backup] created ${resultPath} (${fileCount} files from ${instrDir})\n`); } catch { /* ignore */ }
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
  const mismatch = getAutoBackupSourceMismatch();
  if (mismatch) {
    try { process.stderr.write(`[auto-backup] not started: ${mismatch}\n`); } catch { /* ignore */ }
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
  try { process.stderr.write(`[auto-backup] started (interval=${intervalMs}ms, maxCount=${getRuntimeConfig().mutation.autoBackupMaxCount}, source=${getInstructionsDir()}, target=${getBackupsDir()})\n`); } catch { /* ignore */ }
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
