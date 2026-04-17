import fs from 'fs';
import path from 'path';
import { InstructionEntry } from '../../models/instruction';
import { registerHandler } from '../../server/registry';
import { computeGovernanceHash, ensureLoaded, getInstructionsDir, invalidate, projectGovernance, touchIndexVersion, writeEntry } from '../indexContext';
import { logAudit } from '../auditLog';
import { attemptManifestUpdate } from '../manifestManager';
import { incrementCounter } from '../features';
import { guard } from './instructions.shared';

registerHandler('index_governanceHash', () => {
  let st = ensureLoaded();
  const now = Date.now();
  const loadedAgo = now - new Date(st.loadedAt).getTime();
  if (loadedAgo > 50) {
    try {
      const first = st.list[0];
      if (first) {
        const file = path.join(getInstructionsDir(), `${first.id}.json`);
        if (fs.existsSync(file)) {
          const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { owner?: string; updatedAt?: string };
          if (raw && typeof raw.owner === 'string' && raw.owner !== first.owner) {
            invalidate();
            st = ensureLoaded();
          }
        } else {
          // SQLite-only: trust in-memory state, force reload if stale
          invalidate();
          st = ensureLoaded();
        }
      }
    } catch { /* ignore verification errors */ }
  }
  let projections = st.list.slice().sort((a, b) => a.id.localeCompare(b.id)).map(projectGovernance);
  try {
    const dir = getInstructionsDir();
    let diskFileCount = 0;
    try { diskFileCount = fs.readdirSync(dir).filter(f => f.endsWith('.json')).length; } catch { /* ignore */ }
    const storeCount = st.list.length;
    const expectedCount = Math.max(diskFileCount, storeCount);
    if (expectedCount && (projections.length === 0 || projections.length < Math.floor(expectedCount * 0.9))) {
      // Late materialization: reload from store to pick up any missing entries
      invalidate();
      st = ensureLoaded();
      projections = st.list.slice().sort((a, b) => a.id.localeCompare(b.id)).map(projectGovernance);
      // Also hydrate from disk files not yet in-memory (JSON backend)
      if (diskFileCount > 0) {
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
        const missingIds = new Set(files.map(f => f.replace(/\.json$/, '')));
        for (const p of projections) { missingIds.delete(p.id); }
        let hydrated = false;
        let loadCount = 0;
        for (const mid of missingIds) {
          if (loadCount >= 5) break; loadCount++;
          const file = path.join(dir, mid + '.json');
          try {
            const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as InstructionEntry;
            if (raw && raw.id === mid) {
              st.list.push(raw); st.byId.set(raw.id, raw); hydrated = true;
            }
          } catch { /* ignore individual load errors */ }
        }
        if (hydrated) {
          projections = st.list.slice().sort((a, b) => a.id.localeCompare(b.id)).map(projectGovernance);
          try { incrementCounter('governance:lateMaterialize'); } catch { /* ignore */ }
        }
      }
    }
  } catch { /* ignore defensive reload errors */ }
  const governanceHash = computeGovernanceHash(st.list);
  if (projections.length && projections.length < Math.floor(st.list.length * 0.9) || projections.some(p => !p.owner)) {
    try {
      invalidate();
      const st2 = ensureLoaded();
      projections = st2.list.slice().sort((a, b) => a.id.localeCompare(b.id)).map(projectGovernance);
      try { incrementCounter('governance:projectionRepair'); } catch { /* ignore */ }
    } catch { /* ignore reload failure */ }
  }
  return { count: projections.length, governanceHash, items: projections };
});

registerHandler('index_governanceUpdate', guard('index_governanceUpdate', (p: { id: string; owner?: string; status?: string; lastReviewedAt?: string; nextReviewDue?: string; bump?: 'patch' | 'minor' | 'major' | 'none' }) => {
  const id = p.id;
  const st = ensureLoaded();
  const existing = st.byId.get(id);
  if (!existing) return { id, notFound: true };
  const file = path.join(getInstructionsDir(), `${id}.json`);
  let record: InstructionEntry;
  if (fs.existsSync(file)) {
    try { record = JSON.parse(fs.readFileSync(file, 'utf8')) as InstructionEntry; } catch { record = { ...existing }; }
  } else {
    record = { ...existing };
  }
  let changed = false; const now = new Date().toISOString();
  const bump = p.bump || 'none';
  if (p.owner && p.owner !== record.owner) { record.owner = p.owner; changed = true; }
  if (p.status) {
    const allowed: InstructionEntry['status'][] = ['draft', 'review', 'approved', 'deprecated'];
    const desired = p.status === 'active' ? 'approved' : p.status;
    if (!allowed.includes(desired as InstructionEntry['status'])) {
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
    const parts = (record.version || '1.0.0').split('.').map(n => parseInt(n || '0', 10)); while (parts.length < 3) parts.push(0);
    if (bump === 'major') parts[0]++; else if (bump === 'minor') parts[1]++; else if (bump === 'patch') parts[2]++; if (bump === 'major') { parts[1] = 0; parts[2] = 0; } if (bump === 'minor') { parts[2] = 0; }
    const newVersion = parts.join('.'); if (newVersion !== record.version) { record.version = newVersion; record.changeLog = [...(record.changeLog || []), { version: newVersion, changedAt: now, summary: `manual ${bump} bump via governanceUpdate` }]; changed = true; }
  }
  if (!changed) return { id, changed: false };
  record.updatedAt = now;
  try { writeEntry(record); } catch { return { id, error: 'write-failed' }; }
  touchIndexVersion(); invalidate(); ensureLoaded();
  const resp = { id, changed: true, version: record.version, owner: record.owner, status: record.status, lastReviewedAt: record.lastReviewedAt, nextReviewDue: record.nextReviewDue };
  logAudit('governanceUpdate', id, { changed: true, version: record.version });
  attemptManifestUpdate();
  return resp;
}));

export {};
