import { InstructionEntry, STATUSES } from '../../models/instruction';
import { registerHandler } from '../../server/registry';
import { computeGovernanceHash, ensureLoaded, invalidate, projectGovernance, touchIndexVersion, writeEntry } from '../indexContext';
import { logAudit } from '../auditLog';
import { attemptManifestUpdate } from '../manifestManager';
import { incrementCounter } from '../features';
import { guard, bumpVersion, createChangeLogEntry } from './instructions.shared';

registerHandler('index_governanceHash', () => {
  const reloadFailures: string[] = [];
  let reloadSucceeded = false;
  const captureReloadFailure = (stage: string, error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    reloadFailures.push(`${stage}: ${reason}`);
  };
  const reloadState = (stage: string) => {
    invalidate();
    try {
      const loaded = ensureLoaded();
      reloadSucceeded = true;
      return loaded;
    } catch (error) {
      captureReloadFailure(stage, error);
      throw error;
    }
  };
  let st = ensureLoaded();
  const now = Date.now();
  const loadedAgo = now - new Date(st.loadedAt).getTime();
  if (loadedAgo > 50) {
    try {
      // Force reload if stale — trust the store for freshness
      st = reloadState('stale-check');
    } catch { /* handled below */ }
  }
  let projections = st.list.slice().sort((a, b) => a.id.localeCompare(b.id)).map(projectGovernance);
  try {
    const storeCount = st.list.length;
    if (storeCount && (projections.length === 0 || projections.length < Math.floor(storeCount * 0.9))) {
      // Late materialization: reload from store to pick up any missing entries
      st = reloadState('late-materialization');
      projections = st.list.slice().sort((a, b) => a.id.localeCompare(b.id)).map(projectGovernance);
    }
  } catch { /* handled below */ }
  const governanceHash = computeGovernanceHash(st.list);
  if (projections.length && projections.length < Math.floor(st.list.length * 0.9) || projections.some(p => !p.owner)) {
    try {
      const st2 = reloadState('projection-repair');
      projections = st2.list.slice().sort((a, b) => a.id.localeCompare(b.id)).map(projectGovernance);
      try { incrementCounter('governance:projectionRepair'); } catch { /* counter-only — non-critical */ }
    } catch { /* handled below */ }
  }
  if (reloadFailures.length && !reloadSucceeded) {
    throw new Error(`index_governanceHash could not refresh index state: ${reloadFailures.join('; ')}`);
  }
  return { count: projections.length, governanceHash, items: projections };
});

registerHandler('index_governanceUpdate', guard('index_governanceUpdate', (p: { id: string; owner?: string; status?: string; lastReviewedAt?: string; nextReviewDue?: string; bump?: 'patch' | 'minor' | 'major' | 'none' }) => {
  const id = p.id;
  const st = ensureLoaded();
  const existing = st.byId.get(id);
  if (!existing) {
    logAudit('governanceUpdate', id, { changed: false, notFound: true });
    return { id, notFound: true };
  }
  // Read from store (in-memory), fall back to disk for JSON backend
  const record: InstructionEntry = { ...existing };
  let changed = false; const now = new Date().toISOString();
  const bump = p.bump || 'none';
  if (p.owner && p.owner !== record.owner) { record.owner = p.owner; changed = true; }
  if (p.status) {
    const allowed: readonly InstructionEntry['status'][] = STATUSES;
    const desired = p.status === 'active' ? 'approved' : p.status;
    if (!allowed.includes(desired as InstructionEntry['status'])) {
      logAudit('governanceUpdate', id, { changed: false, error: 'invalid status', provided: p.status });
      return { id, error: 'invalid status', provided: p.status };
    }
    if (desired !== record.status) {
      record.status = desired as InstructionEntry['status'];
      changed = true;
    }
  }
  if (p.lastReviewedAt) { record.lastReviewedAt = p.lastReviewedAt; changed = true; }
  if (p.nextReviewDue) { record.nextReviewDue = p.nextReviewDue; changed = true; }
  if (bump && bump !== 'none') {
    const newVersion = bumpVersion(record.version, bump); if (newVersion !== record.version) { record.version = newVersion; record.changeLog = [...(record.changeLog || []), createChangeLogEntry(newVersion, `manual ${bump} bump via governanceUpdate`)]; changed = true; }
  }
  if (!changed) return { id, changed: false };
  record.updatedAt = now;
  try { writeEntry(record); } catch (err) {
    const detail = (err as Error).message || 'unknown';
    const errorType = err instanceof Error ? err.constructor.name : typeof err;
    const stack = err instanceof Error ? err.stack?.slice(0, 500) : undefined;
    // #132: full detail (including paths) only goes to the audit log; client gets a path-redacted version
    const safeDetail = detail.replace(/[A-Za-z]:\\[^\s'"`]+/g, '<redacted-path>').replace(/\/(?:[^\s/'"`]+\/)+[^\s/'"`]+/g, '<redacted-path>');
    logAudit('governanceUpdate', id, { changed: false, error: detail, errorType, stack, writeFailure: true });
    return { id, error: 'write-failed', detail: safeDetail, errorType };
  }
  touchIndexVersion(); invalidate(); ensureLoaded();
  const resp = { id, changed: true, version: record.version, owner: record.owner, status: record.status, lastReviewedAt: record.lastReviewedAt, nextReviewDue: record.nextReviewDue };
  logAudit('governanceUpdate', id, { changed: true, version: record.version, owner: record.owner, status: record.status, lastReviewedAt: record.lastReviewedAt, nextReviewDue: record.nextReviewDue });
  attemptManifestUpdate();
  return resp;
}));

export {};
