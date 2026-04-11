import fs from 'fs';
import path from 'path';
import { registerHandler } from '../../server/registry';
import { getInstructionsDir, invalidate, touchIndexVersion, ensureLoaded } from '../indexContext';
import { logAudit } from '../auditLog';
import { getRuntimeConfig } from '../../config/runtimeConfig';
import { attemptManifestUpdate } from '../manifestManager';
import { emitTrace } from '../tracing';
import { guard, traceVisibility } from './instructions.shared';
import { createZipBackup } from '../backupZip';

function backupInstructionsDir(): string {
  const cfg = getRuntimeConfig();
  const base = getInstructionsDir();
  const backupsRoot = cfg.dashboard.admin.backupsDir;
  fs.mkdirSync(backupsRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 15);
  let zipPath = path.join(backupsRoot, `instructions-${stamp}.zip`);
  let i = 1;
  while (fs.existsSync(zipPath)) { zipPath = path.join(backupsRoot, `instructions-${stamp}-${i++}.zip`); }
  createZipBackup(base, zipPath);
  return zipPath;
}

registerHandler('index_remove', guard('index_remove', (p: { ids: string[]; missingOk?: boolean; force?: boolean; dryRun?: boolean }) => {
  const ids = Array.isArray(p.ids) ? Array.from(new Set(p.ids.filter(x => typeof x === 'string' && x.trim()))) : [];
  if (!ids.length) return { removed: 0, removedIds: [], missing: [], errorCount: 0, errors: ['no ids supplied'] };
  const base = getInstructionsDir();
  const cfg = getRuntimeConfig();
  const instructionsCfg = cfg.instructions;
  const mutationCfg = cfg.mutation;
  const maxBulk = mutationCfg.maxBulkDelete;

  if (p.dryRun) {
    const wouldRemove: string[] = []; const wouldMiss: string[] = [];
    for (const id of ids) {
      const file = path.join(base, `${id}.json`);
      if (fs.existsSync(file)) wouldRemove.push(id); else wouldMiss.push(id);
    }
    return { dryRun: true, wouldRemove: wouldRemove.length, wouldRemoveIds: wouldRemove, wouldMiss, removed: 0 };
  }

  if (ids.length > maxBulk && !p.force) {
    logAudit('remove_blocked', ids, { count: ids.length, maxBulkDelete: maxBulk, reason: 'bulk_limit_exceeded' });
    return { removed: 0, removedIds: [], missing: [], errorCount: 1, errors: [`Bulk delete blocked: ${ids.length} IDs exceeds INDEX_SERVER_MAX_BULK_DELETE=${maxBulk}. Pass force=true to proceed (a backup will be created first).`], bulkBlocked: true, maxBulkDelete: maxBulk, requestedCount: ids.length };
  }

  let backupDir: string | undefined;
  if (ids.length > maxBulk && mutationCfg.backupBeforeBulkDelete) {
    try {
      backupDir = backupInstructionsDir();
      logAudit('remove_backup', ids, { backupDir, count: ids.length });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'backup-failed';
      logAudit('remove_backup_failed', ids, { error: msg, count: ids.length });
      return { removed: 0, removedIds: [], missing: [], errorCount: 1, errors: [`Bulk delete aborted: pre-mutation backup failed: ${msg}`], backupFailed: true };
    }
  }

  const missing: string[] = []; const removed: string[] = []; const errors: { id: string; error: string }[] = [];
  for (const id of ids) {
    const file = path.join(base, `${id}.json`);
    try {
      if (!fs.existsSync(file)) { missing.push(id); continue; }
      fs.unlinkSync(file);
      removed.push(id);
    } catch (e) { errors.push({ id, error: e instanceof Error ? e.message : 'delete-failed' }); }
  }
  if (removed.length) { touchIndexVersion(); invalidate(); }
  let st = ensureLoaded();
  const strictRemove = instructionsCfg.strictRemove;
  let strictFailed: string[] = [];
  if (strictRemove) {
    const stillVisible = removed.filter(id => st.byId.has(id));
    if (stillVisible.length) {
      try { invalidate(); st = ensureLoaded(); } catch { /* ignore */ }
    }
    strictFailed = removed.filter(id => st.byId.has(id));
    if (strictFailed.length && traceVisibility()) emitTrace('[trace:remove:strict-failed]', { ids: strictFailed });
  }
  const resp = { removed: removed.length, removedIds: removed, missing, errorCount: errors.length + (strictFailed.length ? 1 : 0), errors, strictVerified: strictRemove ? (strictFailed.length === 0) : undefined, strictFailed, backupDir };
  if (strictRemove && strictFailed.length) {
    logAudit('remove', ids, { removed: removed.length, missing: missing.length, errors: errors.length, strict_failed: strictFailed.length, backupDir });
    return resp;
  }
  logAudit('remove', ids, { removed: removed.length, missing: missing.length, errors: errors.length, backupDir });
  try { setImmediate(() => { try { attemptManifestUpdate(); } catch { /* ignore */ } }); } catch { /* ignore */ }
  return resp;
}));

export {};
