import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { registerHandler } from '../server/registry';
import { ensureLoaded } from './indexContext';
import { featureStatus } from './features';

registerHandler('integrity_verify', () => {
  const st = ensureLoaded();
  const issues: { id: string; expected: string; actual: string }[] = [];
  for (const e of st.list) {
    const actual = crypto.createHash('sha256').update(e.body, 'utf8').digest('hex');
    if (actual !== e.sourceHash) {
      issues.push({ id: e.id, expected: e.sourceHash, actual });
    }
  }
  return { hash: st.hash, count: st.list.length, issues, issueCount: issues.length };
});

registerHandler('integrity_manifest', () => {
  const manifestPath = path.join(process.cwd(), 'snapshots', 'index-manifest.json');
  if (!fs.existsSync(manifestPath)) return { manifest: 'missing' };

  let manifest: { entries?: { id: string; sourceHash?: string; bodyHash?: string }[] };
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    return { manifest: 'invalid', error: e instanceof Error ? e.message : String(e) };
  }

  const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
  const map = new Map(entries.map(e => [e.id, e] as const));
  const st = ensureLoaded();
  const drift: { id: string; change: string }[] = [];

  for (const e of st.list) {
    const entry = map.get(e.id);
    const bodyHash = crypto.createHash('sha256').update(e.body, 'utf8').digest('hex');
    if (!entry) {
      drift.push({ id: e.id, change: 'added' });
    } else if (entry.sourceHash !== e.sourceHash || entry.bodyHash !== bodyHash) {
      drift.push({ id: e.id, change: 'hash-mismatch' });
    }
  }

  for (const id of map.keys()) {
    if (!st.byId.has(id)) drift.push({ id, change: 'removed' });
  }

  return { manifest: 'present', drift: drift.length, details: drift };
});
// Phase 0: feature flags status
registerHandler('feature_status', ()=> featureStatus());

export {};
