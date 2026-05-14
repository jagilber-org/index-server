/**
 * Shared helper for creating a pre-mutation zip backup of the instructions
 * directory before bulk-destructive operations (remove, purgeArchive, groom
 * mode.purgeArchive).
 *
 * Phase E1 of spec 006-archive-lifecycle consolidates three near-identical
 * copies previously inlined in `instructions.remove.ts`,
 * `instructions.archive.ts`, and `instructions.groom.ts`.
 *
 * The output filename uses a compact ISO-derived stamp (`instructions-YYYYMMDD-HHMMSS.zip`)
 * with a numeric suffix on collision so concurrent bulk operations cannot
 * clobber each other's backups.
 */
import fs from 'fs';
import path from 'path';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { getInstructionsDir } from './indexContext';
import { createZipBackup } from './backupZip';

/**
 * Create a pre-mutation zip backup of the active instructions directory.
 *
 * Returns the absolute path of the written zip. Throws if the backups root
 * cannot be created or the zip write fails — callers should catch and emit
 * a `purge_backup_failed` (or analogous) audit entry.
 *
 * If the instructions directory does not exist, the resulting zip will be
 * empty rather than throwing — this mirrors the pre-consolidation behavior
 * of bulk-remove / groom backup paths.
 */
export function backupInstructionsDir(): string {
  const cfg = getRuntimeConfig();
  const base = getInstructionsDir();
  const backupsRoot = cfg.dashboard.admin.backupsDir;
  fs.mkdirSync(backupsRoot, { recursive: true });
  if (!fs.existsSync(base)) {
    // Empty source dir: write an empty zip rather than throwing. createZipBackup
    // requires the directory to exist for readdirSync, so synthesize it.
    fs.mkdirSync(base, { recursive: true });
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 15);
  let zipPath = path.join(backupsRoot, `instructions-${stamp}.zip`);
  let i = 1;
  while (fs.existsSync(zipPath)) {
    zipPath = path.join(backupsRoot, `instructions-${stamp}-${i++}.zip`);
  }
  createZipBackup(base, zipPath);
  return zipPath;
}
