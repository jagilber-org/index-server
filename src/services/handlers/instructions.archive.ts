// Archive lifecycle handlers — spec 006-archive-lifecycle Phase D (D1/D3).
//
// Registers five tool handlers surfaced via index_dispatch:
//   - index_archive        (mutation)
//   - index_restore        (mutation)
//   - index_purgeArchive   (mutation, gated; mirrors index_remove safeguards)
//   - index_listArchived   (read)
//   - index_getArchived    (read)
//
// All five route to IndexContext archive accessors added in Phase C.
import { registerHandler } from '../../server/registry';
import {
  archiveEntry,
  restoreEntry,
  purgeEntry,
  getArchivedEntry,
  listArchivedEntries,
} from '../indexContext';
import { logAudit } from '../auditLog';
import { AUDIT_ACTIONS } from '../auditActions';
import { getRuntimeConfig } from '../../config/runtimeConfig';
import { mutationGatedReason } from '../bootstrapGating';
import { guard } from './instructions.shared';
import { backupInstructionsDir } from '../instructionsBackup';
import type { ArchiveReason, ArchiveSource, InstructionEntry } from '../../models/instruction';
import type { RestoreMode } from '../storage/types';

const ARCHIVE_SOURCE_DEFAULT: ArchiveSource = 'archive';

// ── index_archive ───────────────────────────────────────────────────────────

interface ArchiveParams {
  ids: string[];
  reason?: ArchiveReason;
  archivedBy?: string;
  dryRun?: boolean;
}

interface ArchiveErrorRow { id: string; error: string }

registerHandler(
  'index_archive',
  guard('index_archive', (p: ArchiveParams) => {
    const ids = Array.isArray(p?.ids)
      ? Array.from(new Set(p.ids.filter(x => typeof x === 'string' && x.trim())))
      : [];
    if (!ids.length) {
      return { archived: 0, archivedIds: [], archiveErrors: [{ id: '', error: 'no ids supplied' }], dryRun: !!p?.dryRun };
    }
    const reason: ArchiveReason | undefined = p?.reason;
    if (p?.dryRun) {
      return { dryRun: true, archived: 0, archivedIds: [], wouldArchive: ids.length, wouldArchiveIds: ids };
    }
    const archivedIds: string[] = [];
    const archiveErrors: ArchiveErrorRow[] = [];
    const archivedAt = new Date().toISOString();
    for (const id of ids) {
      try {
        archiveEntry(id, {
          archiveReason: reason,
          archiveSource: ARCHIVE_SOURCE_DEFAULT,
          archivedBy: p?.archivedBy,
          archivedAt,
          restoreEligible: true,
        });
        archivedIds.push(id);
        logAudit(AUDIT_ACTIONS.ARCHIVE, [id], {
          reason,
          source: ARCHIVE_SOURCE_DEFAULT,
          archivedBy: p?.archivedBy,
          via: 'index_archive',
        });
      } catch (err) {
        archiveErrors.push({ id, error: err instanceof Error ? err.message : 'archive-failed' });
      }
    }
    return { archived: archivedIds.length, archivedIds, archiveErrors, dryRun: false };
  })
);

// ── index_restore ───────────────────────────────────────────────────────────

interface RestoreParams {
  ids: string[];
  restoreMode?: RestoreMode;
  dryRun?: boolean;
}

registerHandler(
  'index_restore',
  guard('index_restore', (p: RestoreParams) => {
    const ids = Array.isArray(p?.ids)
      ? Array.from(new Set(p.ids.filter(x => typeof x === 'string' && x.trim())))
      : [];
    if (!ids.length) {
      return { restored: 0, restoredIds: [], restoreErrors: [{ id: '', error: 'no ids supplied' }], dryRun: !!p?.dryRun };
    }
    const restoreMode: RestoreMode = p?.restoreMode === 'overwrite' ? 'overwrite' : 'reject';
    if (p?.dryRun) {
      return { dryRun: true, restored: 0, restoredIds: [], wouldRestore: ids.length, wouldRestoreIds: ids, restoreMode };
    }
    const restoredIds: string[] = [];
    const restoreErrors: ArchiveErrorRow[] = [];
    for (const id of ids) {
      try {
        restoreEntry(id, { mode: restoreMode });
        restoredIds.push(id);
        logAudit(AUDIT_ACTIONS.RESTORE, [id], { restoreMode, via: 'index_restore' });
      } catch (err) {
        restoreErrors.push({ id, error: err instanceof Error ? err.message : 'restore-failed' });
      }
    }
    return { restored: restoredIds.length, restoredIds, restoreErrors, restoreMode, dryRun: false };
  })
);

// ── index_purgeArchive ──────────────────────────────────────────────────────

interface PurgeArchiveParams {
  ids: string[];
  dryRun?: boolean;
  force?: boolean;
}

registerHandler(
  'index_purgeArchive',
  guard('index_purgeArchive', (p: PurgeArchiveParams) => {
    const ids = Array.isArray(p?.ids)
      ? Array.from(new Set(p.ids.filter(x => typeof x === 'string' && x.trim())))
      : [];
    if (!ids.length) {
      return { purged: 0, purgedIds: [], purgeErrors: [{ id: '', error: 'no ids supplied' }], dryRun: !!p?.dryRun };
    }
    // Bootstrap mutation gate (dispatcher also gates, but this is defense in depth
    // for direct callers).
    const gated = mutationGatedReason();
    if (gated) {
      return { error: 'mutation_blocked', reason: gated, target: 'index_purgeArchive', bootstrap: true };
    }
    const cfg = getRuntimeConfig();
    const maxBulk = cfg.mutation.maxBulkDelete;

    if (p?.dryRun) {
      const present: string[] = [];
      const missing: string[] = [];
      for (const id of ids) {
        if (getArchivedEntry(id)) present.push(id);
        else missing.push(id);
      }
      return { dryRun: true, purged: 0, purgedIds: [], wouldPurge: present.length, wouldPurgeIds: present, missing };
    }

    if (ids.length > maxBulk && !p?.force) {
      logAudit(AUDIT_ACTIONS.PURGE_BLOCKED, ids, { count: ids.length, maxBulkDelete: maxBulk, reason: 'bulk_limit_exceeded', via: 'index_purgeArchive' });
      return {
        purged: 0,
        purgedIds: [],
        purgeErrors: [{ id: '', error: `Bulk archive purge blocked: ${ids.length} IDs exceeds INDEX_SERVER_MAX_BULK_DELETE=${maxBulk}. Pass force=true (a backup will be created first).` }],
        bulkBlocked: true,
        maxBulkDelete: maxBulk,
        requestedCount: ids.length,
      };
    }

    let backupDir: string | undefined;
    if (ids.length > maxBulk && cfg.mutation.backupBeforeBulkDelete) {
      try {
        backupDir = backupInstructionsDir();
        logAudit(AUDIT_ACTIONS.PURGE_BACKUP, ids, { backupDir, count: ids.length, via: 'index_purgeArchive' });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'backup-failed';
        logAudit(AUDIT_ACTIONS.PURGE_BACKUP_FAILED, ids, { error: msg, count: ids.length, via: 'index_purgeArchive' });
        return {
          purged: 0,
          purgedIds: [],
          purgeErrors: [{ id: '', error: `Bulk archive purge aborted: pre-mutation backup failed: ${msg}` }],
          backupFailed: true,
        };
      }
    }

    const purgedIds: string[] = [];
    const missing: string[] = [];
    const purgeErrors: ArchiveErrorRow[] = [];
    for (const id of ids) {
      try {
        const present = getArchivedEntry(id);
        if (!present) {
          missing.push(id);
          continue;
        }
        purgeEntry(id);
        purgedIds.push(id);
        logAudit(AUDIT_ACTIONS.PURGE, [id], { via: 'index_purgeArchive', backupDir });
      } catch (err) {
        purgeErrors.push({ id, error: err instanceof Error ? err.message : 'purge-failed' });
      }
    }
    return { purged: purgedIds.length, purgedIds, missing, purgeErrors, backupDir };
  })
);

// ── index_listArchived (read) ───────────────────────────────────────────────

interface ListArchivedParams {
  category?: string;
  contentType?: string;
  reason?: ArchiveReason;
  source?: ArchiveSource;
  archivedBy?: string;
  restoreEligible?: boolean;
  includeContent?: boolean;
  limit?: number;
  offset?: number;
}

registerHandler('index_listArchived', (p: ListArchivedParams) => {
  const opts = {
    reason: p?.reason,
    source: p?.source,
    archivedBy: p?.archivedBy,
    restoreEligible: p?.restoreEligible,
    limit: typeof p?.limit === 'number' ? p.limit : undefined,
    offset: typeof p?.offset === 'number' ? p.offset : undefined,
  };
  let items = listArchivedEntries(opts);
  if (p?.category) {
    const c = p.category.toLowerCase();
    items = items.filter(i => Array.isArray(i.categories) && i.categories.includes(c));
  }
  if (p?.contentType) {
    const ct = p.contentType;
    items = items.filter(i => (i.contentType || 'instruction') === ct);
  }
  const includeContent = !!p?.includeContent;
  const projected: InstructionEntry[] = items.map(i => {
    const marker = { ...i, archived: true } as InstructionEntry & { archived: true };
    if (!includeContent) {
      return { ...marker, body: '' } as InstructionEntry & { archived: true };
    }
    return marker;
  });
  return { count: projected.length, items: projected };
});

// ── index_getArchived (read) ────────────────────────────────────────────────

registerHandler('index_getArchived', (p: { id: string }) => {
  const id = typeof p?.id === 'string' ? p.id.trim() : '';
  if (!id) return { notFound: true, id: '' };
  const entry = getArchivedEntry(id);
  if (!entry) return { notFound: true, id };
  return { item: { ...entry, archived: true } as InstructionEntry & { archived: true } };
});

export {};
