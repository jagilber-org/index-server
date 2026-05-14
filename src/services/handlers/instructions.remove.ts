import fs from 'fs';
import path from 'path';
import { registerHandler } from '../../server/registry';
import { getInstructionsDir, invalidate, touchIndexVersion, ensureLoaded, removeEntry, archiveEntry } from '../indexContext';
import { logAudit } from '../auditLog';
import { AUDIT_ACTIONS } from '../auditActions';
import { getRuntimeConfig } from '../../config/runtimeConfig';
import { attemptManifestUpdate } from '../manifestManager';
import { emitTrace } from '../tracing';
import { guard, traceVisibility } from './instructions.shared';
import { backupInstructionsDir } from '../instructionsBackup';

type RemoveMode = 'archive' | 'purge';

interface RemoveParams {
  ids: string[];
  missingOk?: boolean;
  force?: boolean;
  dryRun?: boolean;
  mode?: RemoveMode;
  /** Alias for mode:'purge'. Documented in spec 006-archive-lifecycle D2. */
  purge?: boolean;
  /** Optional operator identity threaded into archive metadata (mode='archive'). */
  archivedBy?: string;
}

const DEFAULT_BEHAVIOR_CHANGE_WARNING =
  'index_remove default behavior will change in an upcoming release: omitting `mode` will switch from destructive purge to archive. Pass mode:"archive" to opt into the new default now, or mode:"purge" (or purge:true) to keep destructive behavior.';

function resolveMode(p: RemoveParams): { mode: RemoveMode; defaulted: boolean } {
  if (p.mode === 'archive') return { mode: 'archive', defaulted: false };
  if (p.mode === 'purge') return { mode: 'purge', defaulted: false };
  if (p.purge === true) return { mode: 'purge', defaulted: false };
  return { mode: 'purge', defaulted: true };
}

registerHandler('index_remove', guard('index_remove', (p: RemoveParams) => {
  const ids = Array.isArray(p.ids) ? Array.from(new Set(p.ids.filter(x => typeof x === 'string' && x.trim()))) : [];
  if (!ids.length) return { removed: 0, removedIds: [], missing: [], errorCount: 0, errors: ['no ids supplied'] };
  const { mode, defaulted } = resolveMode(p);

  // ── Archive path (spec 006 Phase D2) ──────────────────────────────────────
  if (mode === 'archive') {
    if (p.dryRun) {
      const wouldArchive: string[] = []; const wouldMiss: string[] = [];
      const stDry = ensureLoaded();
      const base = getInstructionsDir();
      for (const id of ids) {
        const file = path.join(base, `${id}.json`);
        if (fs.existsSync(file) || stDry.byId.has(id)) wouldArchive.push(id);
        else wouldMiss.push(id);
      }
      return { dryRun: true, mode: 'archive', wouldArchive: wouldArchive.length, wouldArchiveIds: wouldArchive, wouldMiss, archived: 0 };
    }
    const archivedAt = new Date().toISOString();
    const archivedIds: string[] = [];
    const archiveErrors: { id: string; error: string }[] = [];
    const missing: string[] = [];
    const stPre = ensureLoaded();
    const base = getInstructionsDir();
    for (const id of ids) {
      const file = path.join(base, `${id}.json`);
      if (!fs.existsSync(file) && !stPre.byId.has(id)) { missing.push(id); continue; }
      try {
        archiveEntry(id, {
          archiveReason: 'manual',
          archiveSource: 'remove',
          archivedBy: p.archivedBy,
          archivedAt,
          restoreEligible: true,
        });
        archivedIds.push(id);
        logAudit(AUDIT_ACTIONS.ARCHIVE, [id], {
          reason: 'manual',
          source: 'remove',
          archivedBy: p.archivedBy,
          via: 'index_remove',
        });
      } catch (e) {
        archiveErrors.push({ id, error: e instanceof Error ? e.message : 'archive-failed' });
      }
    }
    return { mode: 'archive', archived: archivedIds.length, archivedIds, missing, archiveErrors };
  }

  // ── Destructive purge path (existing behavior) ────────────────────────────
  const base = getInstructionsDir();
  const cfg = getRuntimeConfig();
  const instructionsCfg = cfg.instructions;
  const mutationCfg = cfg.mutation;
  const maxBulk = mutationCfg.maxBulkDelete;

  if (p.dryRun) {
    const wouldRemove: string[] = []; const wouldMiss: string[] = [];
    const stDry = ensureLoaded();
    for (const id of ids) {
      const file = path.join(base, `${id}.json`);
      if (fs.existsSync(file) || stDry.byId.has(id)) { wouldRemove.push(id); } else { wouldMiss.push(id); }
    }
    const resp: Record<string, unknown> = { dryRun: true, mode, wouldRemove: wouldRemove.length, wouldRemoveIds: wouldRemove, wouldMiss, removed: 0 };
    if (defaulted) {
      resp.defaultBehaviorChangeWarning = DEFAULT_BEHAVIOR_CHANGE_WARNING;
      logAudit(AUDIT_ACTIONS.REMOVE_DEFAULT_CHANGE_WARNING, ids, { count: ids.length, dryRun: true });
    }
    return resp;
  }

  if (defaulted) {
    logAudit(AUDIT_ACTIONS.REMOVE_DEFAULT_CHANGE_WARNING, ids, { count: ids.length, dryRun: false });
  }

  if (ids.length > maxBulk && !p.force) {
    logAudit('remove_blocked', ids, { count: ids.length, maxBulkDelete: maxBulk, reason: 'bulk_limit_exceeded' });
    const resp: Record<string, unknown> = { removed: 0, removedIds: [], missing: [], errorCount: 1, errors: [`Bulk delete blocked: ${ids.length} IDs exceeds INDEX_SERVER_MAX_BULK_DELETE=${maxBulk}. Pass force=true to proceed (a backup will be created first).`], bulkBlocked: true, maxBulkDelete: maxBulk, requestedCount: ids.length, mode };
    if (defaulted) resp.defaultBehaviorChangeWarning = DEFAULT_BEHAVIOR_CHANGE_WARNING;
    return resp;
  }

  let backupDir: string | undefined;
  if (ids.length > maxBulk && mutationCfg.backupBeforeBulkDelete) {
    try {
      backupDir = backupInstructionsDir();
      logAudit('remove_backup', ids, { backupDir, count: ids.length });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'backup-failed';
      logAudit('remove_backup_failed', ids, { error: msg, count: ids.length });
      const resp: Record<string, unknown> = { removed: 0, removedIds: [], missing: [], errorCount: 1, errors: [`Bulk delete aborted: pre-mutation backup failed: ${msg}`], backupFailed: true, mode };
      if (defaulted) resp.defaultBehaviorChangeWarning = DEFAULT_BEHAVIOR_CHANGE_WARNING;
      return resp;
    }
  }

  const missing: string[] = []; const removed: string[] = []; const errors: { id: string; error: string }[] = [];
  const stPre = ensureLoaded();
  for (const id of ids) {
    const file = path.join(base, `${id}.json`);
    try {
      if (!fs.existsSync(file) && !stPre.byId.has(id)) { missing.push(id); continue; }
      removeEntry(id);
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
  const resp: Record<string, unknown> = { removed: removed.length, removedIds: removed, missing, errorCount: errors.length + (strictFailed.length ? 1 : 0), errors, strictVerified: strictRemove ? (strictFailed.length === 0) : undefined, strictFailed, backupDir, mode };
  if (defaulted) resp.defaultBehaviorChangeWarning = DEFAULT_BEHAVIOR_CHANGE_WARNING;
  if (strictRemove && strictFailed.length) {
    logAudit('remove', ids, { removed: removed.length, missing: missing.length, errors: errors.length, strict_failed: strictFailed.length, backupDir, mode });
    return resp;
  }
  logAudit('remove', ids, { removed: removed.length, missing: missing.length, errors: errors.length, backupDir, mode });
  try { setImmediate(() => { try { attemptManifestUpdate(); } catch { /* ignore */ } }); } catch { /* ignore */ }
  return resp;
}));

export {};
