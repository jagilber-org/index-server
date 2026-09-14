import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { registerHandler } from '../server/registry';
import { ensureLoaded } from './indexContext';
import { featureStatus } from './features';
import { hashBody } from './canonical';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { getManifestPath } from './manifestManager';

registerHandler('integrity_verify', () => {
  const st = ensureLoaded();
  const canonicalDisable = getRuntimeConfig().instructions.canonicalDisable;
  const issues: { id: string; expected: string; actual: string }[] = [];
  for (const e of st.list) {
    const actual = canonicalDisable
      ? crypto.createHash('sha256').update(e.body, 'utf8').digest('hex')
      : hashBody(e.body);
    if (actual !== e.sourceHash) {
      issues.push({ id: e.id, expected: e.sourceHash, actual });
    }
  }
  return { hash: st.hash, count: st.list.length, issues, issueCount: issues.length };
});

registerHandler('integrity_manifest', () => {
  // Single source of truth, shared with the writers in manifestManager. Do not
  // rebuild this path locally: reader/writer divergence here is silent (the
  // reader simply reports `missing`) and is exactly what #577 introduced.
  const manifestPath = getManifestPath();
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
  const canonicalDisable = getRuntimeConfig().instructions.canonicalDisable;
  const drift: { id: string; change: string }[] = [];

  for (const e of st.list) {
    const entry = map.get(e.id);
    const bodyHash = canonicalDisable
      ? crypto.createHash('sha256').update(e.body, 'utf8').digest('hex')
      : hashBody(e.body);
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
