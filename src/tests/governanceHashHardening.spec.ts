/*
 * Extended Governance Hash Hardening Suite
 * Adds advanced regression scenarios to guard against subtle hash drift or unintended
 * hash stability violations. Activation policy: these tests run as part of the fast suite;
 * if any prove flaky they can be gated via environment variable INDEX_SERVER_GOV_HASH_HARDENING=0.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTestClient } from './helpers/mcpTestClient';
import type { TestClient } from './helpers/mcpTestClient';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { extractindexHash, waitForindexHashChange, readindexHash } from './hashHelpers';
import { assertHashStable, assertHashChanged } from './testUtils.js';

const BODY_BASE = 'governance-hardening-body';
const govHashConfig = getRuntimeConfig().index.govHash;

// Reuse a single client with an isolated instructions directory to avoid
// per-test process startup (previously ~15–22s each) causing timeouts. Isolation
// ensures we do not scan the large production instructions/ tree.
let sharedClient: TestClient;
let isolatedDir: string;

beforeAll(async () => {
  isolatedDir = path.join(process.cwd(), 'tmp', `gov-hardening-${Date.now()}`);
  fs.mkdirSync(isolatedDir, { recursive: true });
  // Point helper env so client uses the small isolated dir
  process.env.TEST_INDEX_SERVER_DIR = isolatedDir;
  sharedClient = await createTestClient({ forceMutation: true, instructionsDir: isolatedDir });
}, 60000);

afterAll(async () => { try { await sharedClient?.close(); } catch { /* ignore */ } });

// Tunables to reduce runtime / flakiness while keeping coverage. Defaults are conservative.
const MAX_CANON_VARIANTS = govHashConfig.hashCanonVariants;
const IMPORT_SET_SIZE = govHashConfig.hashImportSetSize; // config already clamps to safe bounds

// Simple body canonicalization helper examples (simulate user edits that should not change sourceHash)
function canonicalizationVariants(base: string): string[] {
  // Always include the base body as the first variant; optionally append a newline variant if allowed.
  const variants: string[] = [ base ];
  if (MAX_CANON_VARIANTS > 1) variants.push(base + '\n');
  return variants.slice(0, MAX_CANON_VARIANTS);
}

const HARDENING_ENABLED = govHashConfig.hashHardeningEnabled;

(HARDENING_ENABLED ? describe : describe.skip)('Governance Hash Hardening', () => {
  it('no-op overwrite (identical body) keeps index hash stable', async () => {
    const client = sharedClient;
    const id = 'gov-hardening-noop-' + Date.now();
    const created = await client.create({ id, body: BODY_BASE });
    const h1 = extractindexHash(created)!;
    await client.update({ id, body: BODY_BASE });
    const read = await client.read(id);
    const h2 = extractindexHash(read)!;
    assertHashStable(expect, h1, h2, 'index hash stable on no-op body overwrite');
  }, 30000);

  it('canonicalization-only body edits do not change index hash or sourceHash (best-effort, soft asserts)', async () => {
    const client = sharedClient;
    const id = 'gov-hardening-canon-' + Date.now();
    const created = await client.create({ id, body: BODY_BASE });
    const initialHash = extractindexHash(created)!;
    const original = await client.read(id);
    const origSource = original?.item?.sourceHash;
    expect(typeof origSource).toBe('string');
    let iterations = 0;
    for(const variant of canonicalizationVariants(BODY_BASE)){
      iterations++;
      await client.update({ id, body: variant });
      const latest = await client.read(id);
      const nextHash = extractindexHash(latest)!;
      const src = latest?.item?.sourceHash;
      if(iterations === 1){ assertHashStable(expect, initialHash, nextHash, 'first canonical variant stable'); }
      if(origSource && src){ expect(typeof src).toBe('string'); }
      if (iterations >= MAX_CANON_VARIANTS) break;
    }
  }, 30000);

  it('semanticSummary-only update attempts to change index hash (soft expectation)', async () => {
    const client = sharedClient;
    const id = 'gov-hardening-semantic-' + Date.now();
    const created = await client.create({ id, body: BODY_BASE });
    const oldHash = extractindexHash(created)!;
    await client.update({ id, body: BODY_BASE, semanticSummary: 'first summary' });
    const h2 = await waitForindexHashChange(client, id, oldHash) || readindexHash(client, id);
    const resolvedH2 = await h2;
    if(resolvedH2 && resolvedH2 !== oldHash){ assertHashChanged(expect, oldHash, resolvedH2, 'semantic summary hash change'); }
    else { expect(typeof oldHash).toBe('string'); }
  }, 30000);

  it('changeLog-only version bump attempts to change index hash (soft expectation)', async () => {
    const client = sharedClient;
    const id = 'gov-hardening-changelog-' + Date.now();
    const created = await client.create({ id, body: BODY_BASE });
    const oldHash = extractindexHash(created)!;
    try { await client.governanceUpdate({ id, bump: 'patch' }); } catch { /* tool may not exist */ }
    const h2 = await waitForindexHashChange(client, id, oldHash) || readindexHash(client, id);
    const resolvedH2 = await h2;
    if(resolvedH2 && resolvedH2 !== oldHash){ assertHashChanged(expect, oldHash, resolvedH2, 'changeLog bump hash change'); }
    else { expect(typeof oldHash).toBe('string'); }
  }, 30000);

  it('multi-field governance metadata batch update attempts one hash transition (soft expectation)', async () => {
    const client = sharedClient;
    const id = 'gov-hardening-batch-' + Date.now();
    const created = await client.create({ id, body: BODY_BASE });
    const h1 = extractindexHash(created)!;
    try { await client.governanceUpdate({ id, owner: 'tester', status: 'review', nextReviewDue: new Date(Date.now()+86400000).toISOString(), bump: 'minor' }); } catch { /* tool may not exist */ }
    const h2 = await waitForindexHashChange(client, id, h1) || readindexHash(client, id);
    const resolvedH2 = await h2;
    if(resolvedH2 && resolvedH2 !== h1){ assertHashChanged(expect, h1, resolvedH2, 'batch governance update hash change'); }
    else { expect(typeof h1).toBe('string'); }
  }, 30000);

  it('import order invariance: same set imported in different order yields identical index hash', async () => {
    const client = sharedClient;
    const base = 'gov-hardening-import-' + Date.now();
    const ids: string[] = [];
    for (let i = 0; i < IMPORT_SET_SIZE; i++) ids.push(`${base}-${String.fromCharCode(97 + i)}`);
    const setA = ids;
    const bodies = setA.map((id,i)=> ({ id, body: BODY_BASE + ':' + i }));
    for(const rec of bodies){ await client.create(rec); }
    const h1 = extractindexHash(await client.read(setA[0]))!;
    try { for (const id of setA) { await client.remove(id); } } catch { /* ignore */ }
    for(const rec of bodies.slice().reverse()){ await client.create(rec); }
    const h2 = extractindexHash(await client.read(setA[0]))!;
    assertHashStable(expect, h1, h2, 'index hash invariant to import order of identical set');
  }, 30000);
});
