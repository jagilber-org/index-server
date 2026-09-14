/**
 * embeddingBackendRegeneration.spec.ts — issue #572.
 *
 * The bug: with INDEX_SERVER_STORAGE_BACKEND=sqlite, embeddings were never
 * regenerated into the sqlite-vec store. `getInstructionEmbeddings` accepted an
 * OPTIONAL `store` parameter and fell back to `data/embeddings.json` when it was
 * omitted -- and the only automatic regeneration path (embeddingTrigger) omitted
 * it. Meanwhile the dashboard resolved its own store by hardcoding 'sqlite'.
 * Writes went to JSON, reads came from SQLite. Measured in production: 284
 * entries in embeddings.json, 78 in embeddings.db, frozen for two weeks.
 *
 * Nothing errored, because both stores worked perfectly in isolation -- they
 * were simply different stores. Semantic search also read JSON, so search kept
 * working and no alarm could fire. The only symptom was a stale count on one
 * dashboard panel.
 *
 * Why the pre-existing suites missed it:
 *
 *   - The storage specs construct SqliteEmbeddingStore DIRECTLY and verify
 *     save/load. They prove the store works; they never prove anything uses it.
 *   - embeddingIncremental.spec.ts called getInstructionEmbeddings 11 times and
 *     never once passed a store, so the whole service suite exercised only the
 *     JSON branch.
 *   - embeddingTrigger.spec.ts asserted only the autoEmbedEnabled() boolean. It
 *     never invoked the trigger and never observed which store was written.
 *
 * Every component was tested; the WIRING between them was not. The first test
 * below is the load-bearing one: it asserts the trigger actually hands the
 * configured store to the service. Under the original code the 9th argument was
 * `undefined` and it fails immediately.
 *
 * NOTE on why the sqlite store is constructed directly rather than via
 * createEmbeddingStore('sqlite'): the factory lazily resolves it with
 * `require('./sqliteEmbeddingStore.js')`, which succeeds against compiled dist
 * but throws "Cannot find module" under vitest, where the caller is TypeScript
 * source. The factory then silently falls back to JSON. That is a second reason
 * this class of bug could not be caught through the factory -- a sqlite test
 * routed through it is quietly a JSON test.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hasSqliteVec } from './unit/storage/sqliteVecAvailable.js';
import { JsonEmbeddingStore } from '../services/storage/jsonEmbeddingStore.js';
import { SqliteEmbeddingStore } from '../services/storage/sqliteEmbeddingStore.js';
import type { IEmbeddingStore } from '../services/storage/types.js';
import { reloadRuntimeConfig } from '../config/runtimeConfig.js';

/**
 * Must match the sqlite-vec table width (`vec0(embedding float[384])`).
 * A narrower vector is rejected at save time -- and the service only logs a
 * WARN and still resolves successfully, so a dimension mismatch degrades to
 * "embeddings silently not persisted". See issue #572 follow-ups.
 */
const DIM = 384;
const mkInstructions = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `inst-${i}`,
    title: `Title ${i}`,
    semanticSummary: `Summary ${i}`,
    sourceHash: `hash-${i}`,
    body: 'body',
  }));

/** Deterministic stand-in for the real model. */
const fakeEmbed = async () => new Float32Array(DIM).fill(0.25);

describe('#572 embedding regeneration honours the configured backend', () => {
  let tmpDir: string;
  const savedSem = process.env.INDEX_SERVER_SEMANTIC_ENABLED;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-backend-'));
  });

  afterEach(() => {
    // Unmock UNCONDITIONALLY. A previous revision unmocked at the end of the
    // test body; when an assertion above it failed, the embeddingService mock
    // leaked into every subsequent test and they all saw an empty store.
    vi.doUnmock('../services/embeddingService');
    vi.doUnmock('../services/indexContext');
    vi.resetModules();
    if (savedSem !== undefined) process.env.INDEX_SERVER_SEMANTIC_ENABLED = savedSem;
    else delete process.env.INDEX_SERVER_SEMANTIC_ENABLED;
    reloadRuntimeConfig();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* windows lock */ }
  });

  /**
   * THE REGRESSION TEST. Asserts the automatic trigger hands the configured
   * store to the service. This is the assertion no existing test made.
   */
  it('the automatic trigger passes a store to the service (9th argument)', async () => {
    vi.resetModules();
    process.env.INDEX_SERVER_SEMANTIC_ENABLED = '1';
    reloadRuntimeConfig();

    const spy = vi.fn().mockResolvedValue({});
    vi.doMock('../services/embeddingService', () => ({ getInstructionEmbeddings: spy }));
    vi.doMock('../services/indexContext', () => ({
      ensureLoaded: () => undefined,
      getIndexState: () => ({ list: mkInstructions(3), hash: 'idx-hash' }),
    }));

    const { triggerEmbeddingComputeAfterImport } = await import('../services/embeddingTrigger.js');
    const res = await triggerEmbeddingComputeAfterImport('regression-572');

    expect(res.triggered, `trigger did not run: ${res.reason ?? ''}`).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);

    const store = spy.mock.calls[0][8] as IEmbeddingStore | undefined;
    expect(store, 'trigger must pass a store as the 9th arg — undefined here WAS the bug').toBeDefined();
    expect(store).toHaveProperty('load');
    expect(store).toHaveProperty('save');

  });

  /**
   * Parameterised over both backends: whatever store the service is handed must
   * end up holding one vector per instruction. Proves neither backend is a
   * second-class citizen in the regeneration path.
   */
  const backends: Array<{ name: string; enabled: boolean; make: (dir: string) => IEmbeddingStore }> = [
    {
      name: 'json',
      enabled: true,
      make: (dir) => new JsonEmbeddingStore(path.join(dir, 'embeddings.json')),
    },
    {
      name: 'sqlite',
      enabled: hasSqliteVec,
      // Static ESM import, as the other sqlite specs do. A lazy
      // require('...js') does NOT resolve TS source under vitest -- which is
      // precisely why the factory's sqlite branch silently degrades to JSON in
      // tests (see the file header).
      make: (dir) => new SqliteEmbeddingStore(path.join(dir, 'embeddings.db')),
    },
  ];

  for (const backend of backends) {
    it.skipIf(!backend.enabled)(`${backend.name} backend: regeneration persists every instruction`, async () => { // SKIP_OK: environment-gated: requires sqlite-vec native module
      vi.resetModules();
      const { getInstructionEmbeddings } = await import('../services/embeddingService.js');

      const store = backend.make(tmpDir);
      const jsonSideCar = path.join(tmpDir, 'sidecar-should-not-exist.json');

      await getInstructionEmbeddings(
        mkInstructions(6) as never[], 'idx-hash',
        jsonSideCar, 'test-model', tmpDir, 'cpu', true,
        fakeEmbed, store,
      );

      expect(Object.keys(store.load()?.embeddings ?? {})).toHaveLength(6);

      // Silent-fallback detector: the service must persist ONLY through the
      // store it was given. Writing the embeddingPath JSON behind the store's
      // back is exactly how sqlite went stale.
      expect(
        fs.existsSync(jsonSideCar),
        'service wrote the JSON path instead of/in addition to the supplied store',
      ).toBe(false);
    });
  }

  /**
   * Incremental reuse must also route through the store, not the JSON file --
   * otherwise a second run silently repopulates the wrong backend.
   */
  it('a second run reuses cached vectors from the store without recomputing', async () => {
    vi.resetModules();
    const { getInstructionEmbeddings } = await import('../services/embeddingService.js');

    const store = new JsonEmbeddingStore(path.join(tmpDir, 'embeddings.json'));
    const instructions = mkInstructions(4) as never[];
    const embedSpy = vi.fn(fakeEmbed);

    await getInstructionEmbeddings(instructions, 'h1', 'unused', 'test-model', tmpDir, 'cpu', true, embedSpy, store);
    expect(embedSpy).toHaveBeenCalledTimes(4);

    embedSpy.mockClear();
    await getInstructionEmbeddings(instructions, 'h1', 'unused', 'test-model', tmpDir, 'cpu', true, embedSpy, store);
    expect(embedSpy, 'cache hit must come from the store').not.toHaveBeenCalled();
  });

  /**
   * Existing installs recover WITHOUT a migration step.
   *
   * Production had 78 of 284 vectors in embeddings.db (a stale partial set left
   * by a manual Compute run) while the JSON store held all 284. Once the write
   * path is pointed at the configured store, the incremental logic reuses the
   * entries whose sourceHash still matches and computes only the remainder, so
   * the store converges on the next regeneration. This test pins that
   * behaviour, so "just let it self-heal" is a verified claim rather than an
   * assumption.
   */
  it('a partially populated store back-fills only the missing entries', async () => {
    vi.resetModules();
    const { getInstructionEmbeddings } = await import('../services/embeddingService.js');

    const store = new JsonEmbeddingStore(path.join(tmpDir, 'embeddings.json'));
    const all = mkInstructions(6) as never[];
    const partial = all.slice(0, 2);
    const embedSpy = vi.fn(fakeEmbed);

    // Seed the store with a stale partial set, as the manual Compute run did.
    await getInstructionEmbeddings(partial, 'h-old', 'unused', 'test-model', tmpDir, 'cpu', true, embedSpy, store);
    expect(Object.keys(store.load()?.embeddings ?? {})).toHaveLength(2);

    embedSpy.mockClear();
    await getInstructionEmbeddings(all, 'h-new', 'unused', 'test-model', tmpDir, 'cpu', true, embedSpy, store);

    expect(embedSpy, 'must compute only the 4 missing, not all 6').toHaveBeenCalledTimes(4);
    expect(Object.keys(store.load()?.embeddings ?? {})).toHaveLength(6);
  });

  /**
   * Single resolution point. The dashboard used to derive the backend itself
   * with a hardcoded createEmbeddingStore('sqlite'), independently of the write
   * path -- two answers to one question is how reads and writes diverged.
   */
  it('getEmbeddingStore is a single cached resolution point', async () => {
    vi.resetModules();
    const { getEmbeddingStore, resetEmbeddingStore } = await import('../services/storage/factory.js');

    const first = getEmbeddingStore();
    expect(getEmbeddingStore(), 'must not re-resolve per call').toBe(first);

    resetEmbeddingStore();
    expect(getEmbeddingStore()).toBeDefined();
  });
});
