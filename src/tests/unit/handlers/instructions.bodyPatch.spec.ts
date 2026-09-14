/**
 * #486 — index_patch: partial instruction body patching.
 *
 * Exercises the REAL registered handler against a REAL on-disk instructions
 * directory (TS-10: no toy reimplementations; TS-7: full pipeline round-trip).
 *
 * Coverage per TS-12 (normal / edge / error / boundary / concurrent):
 *  - positive: append, prepend, splice (replace + pure insert), replace, replaceAll,
 *              version bump + changeLog, dryRun, no-op, dispatcher routing
 *  - negative: notFound, precondition_failed (lost update), body limit (A-6),
 *              empty body, find_not_found, invalid op, missing operands
 *  - boundary: offset clamping, surrogate-pair snapping (DI-4 read/write symmetry)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getHandler } from '../../../server/registry.js';
import { reloadRuntimeConfig } from '../../../config/runtimeConfig.js';
import { forceBootstrapConfirmForTests } from '../../../services/bootstrapGating.js';

const TMP_DIR = path.join(process.cwd(), 'tmp', 'index-patch-body-test');

type Rec = Record<string, unknown>;

function seed(id: string, body: string, extra: Rec = {}): void {
  const e = {
    id,
    title: `T:${id}`,
    body,
    priority: 50,
    audience: 'all',
    requirement: 'optional',
    categories: ['general'],
    schemaVersion: '7',
    version: '1.0.0',
    contentType: 'instruction',
    sourceHash: 'a'.repeat(64),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...extra,
  };
  fs.writeFileSync(path.join(TMP_DIR, `${id}.json`), JSON.stringify(e, null, 2));
}

function readFromDisk(id: string): Rec {
  return JSON.parse(fs.readFileSync(path.join(TMP_DIR, `${id}.json`), 'utf8')) as Rec;
}

async function refreshIndex(): Promise<void> {
  const { invalidate, ensureLoaded } = await import('../../../services/indexContext.js');
  invalidate();
  ensureLoaded();
}

async function patch(params: Rec): Promise<Rec> {
  const h = getHandler('index_patch');
  if (!h) throw new Error('index_patch handler is not registered');
  return await h(params) as Rec;
}

describe('#486 index_patch — instruction body patching', () => {
  beforeAll(async () => {
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_DIR = TMP_DIR;
    reloadRuntimeConfig();
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    await import('../../../services/handlers.instructions.js');
    await import('../../../services/instructions.dispatcher.js');
    forceBootstrapConfirmForTests('index-patch-body-test');
  });

  afterAll(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    await refreshIndex();
  });

  // ── positive: operations ────────────────────────────────────────────
  describe('operations', () => {
    it('append adds text to the end and persists to disk', async () => {
      seed('alpha', 'Hello');
      await refreshIndex();

      const r = await patch({ id: 'alpha', op: 'append', text: ' World' });

      expect(r.changed).toBe(true);
      expect(readFromDisk('alpha').body).toBe('Hello World');
    });

    it('prepend adds text to the beginning', async () => {
      seed('alpha', 'World');
      await refreshIndex();

      const r = await patch({ id: 'alpha', op: 'prepend', text: 'Hello ' });

      expect(r.changed).toBe(true);
      expect(readFromDisk('alpha').body).toBe('Hello World');
    });

    it('splice replaces the requested window', async () => {
      seed('alpha', 'ABCDEFGHIJ');
      await refreshIndex();

      // remove 3 chars ('CDE') starting at offset 2, insert 'XY'
      const r = await patch({ id: 'alpha', op: 'splice', bodyOffset: 2, bodyLength: 3, text: 'XY' });

      expect(r.changed).toBe(true);
      expect(readFromDisk('alpha').body).toBe('ABXYFGHIJ');
    });

    it('splice with bodyLength 0 is a pure insertion', async () => {
      seed('alpha', 'ABCDEFGHIJ');
      await refreshIndex();

      await patch({ id: 'alpha', op: 'splice', bodyOffset: 5, bodyLength: 0, text: '---' });

      expect(readFromDisk('alpha').body).toBe('ABCDE---FGHIJ');
    });

    it('replace substitutes the first literal occurrence by default', async () => {
      seed('alpha', 'cat dog cat');
      await refreshIndex();

      await patch({ id: 'alpha', op: 'replace', find: 'cat', replaceWith: 'bird' });

      expect(readFromDisk('alpha').body).toBe('bird dog cat');
    });

    it('replace with replaceAll substitutes every occurrence', async () => {
      seed('alpha', 'cat dog cat');
      await refreshIndex();

      await patch({ id: 'alpha', op: 'replace', find: 'cat', replaceWith: 'bird', replaceAll: true });

      expect(readFromDisk('alpha').body).toBe('bird dog bird');
    });

    it('treats find as a literal string, not a regex', async () => {
      seed('alpha', 'a.c and abc');
      await refreshIndex();

      await patch({ id: 'alpha', op: 'replace', find: 'a.c', replaceWith: 'Z' });

      // a regex interpretation would have matched 'abc' as well / instead
      expect(readFromDisk('alpha').body).toBe('Z and abc');
    });
  });

  // ── positive: bookkeeping ───────────────────────────────────────────
  describe('record bookkeeping', () => {
    it('recomputes sourceHash and updatedAt', async () => {
      seed('alpha', 'Hello');
      await refreshIndex();
      const before = readFromDisk('alpha');

      const r = await patch({ id: 'alpha', op: 'append', text: '!' });
      const after = readFromDisk('alpha');

      expect(after.sourceHash).not.toBe(before.sourceHash);
      expect(after.sourceHash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.sourceHash).toBe(after.sourceHash);
      expect(after.updatedAt).not.toBe(before.updatedAt);
    });

    it('bumps version and appends a changeLog entry when requested', async () => {
      seed('alpha', 'Hello', { version: '1.2.3' });
      await refreshIndex();

      const r = await patch({ id: 'alpha', op: 'append', text: '!', bump: 'minor', summary: 'add bang' });
      const after = readFromDisk('alpha');

      expect(r.version).toBe('1.3.0');
      expect(after.version).toBe('1.3.0');
      const log = after.changeLog as Array<Rec>;
      expect(Array.isArray(log)).toBe(true);
      expect(log[log.length - 1].version).toBe('1.3.0');
      expect(String(log[log.length - 1].summary)).toContain('add bang');
    });

    it('leaves version untouched when no bump is requested', async () => {
      seed('alpha', 'Hello', { version: '1.2.3' });
      await refreshIndex();

      await patch({ id: 'alpha', op: 'append', text: '!' });

      expect(readFromDisk('alpha').version).toBe('1.2.3');
    });

    it('dryRun reports the result without writing', async () => {
      seed('alpha', 'Hello');
      await refreshIndex();

      const r = await patch({ id: 'alpha', op: 'append', text: ' World', dryRun: true });

      expect(r.dryRun).toBe(true);
      expect(r.bodyLength).toBe('Hello World'.length);
      expect(readFromDisk('alpha').body).toBe('Hello');
    });

    it('reports changed:false and does not write when the body is unaffected', async () => {
      seed('alpha', 'Hello');
      await refreshIndex();
      const before = readFromDisk('alpha');

      const r = await patch({ id: 'alpha', op: 'append', text: '' });

      expect(r.changed).toBe(false);
      expect(readFromDisk('alpha').updatedAt).toBe(before.updatedAt);
    });
  });

  // ── negative: preconditions / concurrency ───────────────────────────
  describe('lost-update protection', () => {
    it('applies the patch when expectedSourceHash matches', async () => {
      seed('alpha', 'Hello');
      await refreshIndex();
      const current = String(readFromDisk('alpha').sourceHash);

      const r = await patch({ id: 'alpha', op: 'append', text: '!', expectedSourceHash: current });

      expect(r.changed).toBe(true);
      expect(readFromDisk('alpha').body).toBe('Hello!');
    });

    it('refuses and does not write when expectedSourceHash does not match', async () => {
      seed('alpha', 'Hello');
      await refreshIndex();

      const r = await patch({ id: 'alpha', op: 'append', text: '!', expectedSourceHash: 'b'.repeat(64) });

      expect(r.error).toBe('precondition_failed');
      expect(r.actualSourceHash).toBe(readFromDisk('alpha').sourceHash);
      expect(readFromDisk('alpha').body).toBe('Hello');
    });

    it('rejects a second concurrent writer holding a stale hash', async () => {
      seed('alpha', 'base');
      await refreshIndex();
      // Both writers read the same starting hash.
      const staleHash = String(readFromDisk('alpha').sourceHash);

      const first = await patch({ id: 'alpha', op: 'append', text: '-first', expectedSourceHash: staleHash });
      expect(first.changed).toBe(true);

      // Second writer still holds the pre-write hash and must be refused.
      const second = await patch({ id: 'alpha', op: 'append', text: '-second', expectedSourceHash: staleHash });

      expect(second.error).toBe('precondition_failed');
      expect(readFromDisk('alpha').body).toBe('base-first');
    });
  });

  // ── negative: guardrails ────────────────────────────────────────────
  describe('guardrails', () => {
    it('returns notFound for an unknown id and writes nothing', async () => {
      await refreshIndex();

      const r = await patch({ id: 'ghost', op: 'append', text: 'x' });

      expect(r.notFound).toBe(true);
      expect(fs.existsSync(path.join(TMP_DIR, 'ghost.json'))).toBe(false);
    });

    it('rejects a patch that would exceed the body length limit (A-6)', async () => {
      seed('alpha', 'Hello');
      await refreshIndex();

      // default bodyWarnLength is 50000
      const r = await patch({ id: 'alpha', op: 'append', text: 'x'.repeat(50_001) });

      expect(r.error).toBe('body_limit_exceeded');
      expect(r.maxLength).toBe(50_000);
      expect(String(r.guidance)).toMatch(/split|cross-link/i);
      expect(readFromDisk('alpha').body).toBe('Hello');
    });

    it('rejects a patch that would empty the body', async () => {
      seed('alpha', 'Hello');
      await refreshIndex();

      const r = await patch({ id: 'alpha', op: 'splice', bodyOffset: 0, bodyLength: 5, text: '' });

      expect(r.error).toBe('empty_body');
      expect(readFromDisk('alpha').body).toBe('Hello');
    });

    it('reports find_not_found instead of silently succeeding', async () => {
      seed('alpha', 'Hello');
      await refreshIndex();

      const r = await patch({ id: 'alpha', op: 'replace', find: 'zzz', replaceWith: 'x' });

      expect(r.error).toBe('find_not_found');
      expect(readFromDisk('alpha').body).toBe('Hello');
    });
  });

  // ── negative: parameter validation ──────────────────────────────────
  describe('parameter validation', () => {
    it('rejects an unknown op and lists the valid ones', async () => {
      seed('alpha', 'Hello');
      await refreshIndex();

      const r = await patch({ id: 'alpha', op: 'transmogrify', text: 'x' });

      expect(r.error).toBe('invalid_params');
      expect(r.validOps).toEqual(expect.arrayContaining(['splice', 'append', 'prepend', 'replace']));
    });

    it('rejects append without text', async () => {
      seed('alpha', 'Hello');
      await refreshIndex();

      const r = await patch({ id: 'alpha', op: 'append' });

      expect(r.error).toBe('invalid_params');
    });

    it('rejects replace without find', async () => {
      seed('alpha', 'Hello');
      await refreshIndex();

      const r = await patch({ id: 'alpha', op: 'replace', replaceWith: 'x' });

      expect(r.error).toBe('invalid_params');
    });

    it('rejects splice without bodyOffset', async () => {
      seed('alpha', 'Hello');
      await refreshIndex();

      const r = await patch({ id: 'alpha', op: 'splice', text: 'x' });

      expect(r.error).toBe('invalid_params');
    });

    it('rejects a missing id', async () => {
      await refreshIndex();

      const r = await patch({ op: 'append', text: 'x' });

      expect(r.error).toBe('invalid_params');
    });
  });

  // ── boundary: offsets and unicode ───────────────────────────────────
  describe('boundaries', () => {
    it('clamps a bodyOffset beyond the end to an append', async () => {
      seed('alpha', 'abc');
      await refreshIndex();

      await patch({ id: 'alpha', op: 'splice', bodyOffset: 999, bodyLength: 0, text: 'Z' });

      expect(readFromDisk('alpha').body).toBe('abcZ');
    });

    it('clamps a negative bodyOffset to the start', async () => {
      seed('alpha', 'abc');
      await refreshIndex();

      await patch({ id: 'alpha', op: 'splice', bodyOffset: -5, bodyLength: 0, text: 'Z' });

      expect(readFromDisk('alpha').body).toBe('Zabc');
    });

    it('clamps bodyLength past the end instead of erroring', async () => {
      seed('alpha', 'abcdef');
      await refreshIndex();

      await patch({ id: 'alpha', op: 'splice', bodyOffset: 3, bodyLength: 999, text: 'Z' });

      expect(readFromDisk('alpha').body).toBe('abcZ');
    });

    it('never splits a surrogate pair at the window start (DI-4 parity with get)', async () => {
      // 'AB' + emoji (2 UTF-16 units at index 2,3) + 'CD'
      seed('alpha', 'AB\u{1F600}CD');
      await refreshIndex();

      // offset 3 lands on the low half of the pair; it must snap back to 2
      await patch({ id: 'alpha', op: 'splice', bodyOffset: 3, bodyLength: 0, text: 'X' });

      const body = String(readFromDisk('alpha').body);
      expect(body).toBe('ABX\u{1F600}CD');
      expect(body).toContain('\u{1F600}');
    });

    it('never splits a surrogate pair at the window end', async () => {
      seed('alpha', 'AB\u{1F600}CD');
      await refreshIndex();

      // removing 3 from offset 0 would cut the pair in half; end must snap to 2
      await patch({ id: 'alpha', op: 'splice', bodyOffset: 0, bodyLength: 3, text: 'Z' });

      const body = String(readFromDisk('alpha').body);
      expect(body).toBe('Z\u{1F600}CD');
      expect(body).toContain('\u{1F600}');
    });
  });

  // ── dispatcher integration ──────────────────────────────────────────
  describe('dispatcher integration', () => {
    it('routes index_dispatch action=patch to the handler', async () => {
      seed('alpha', 'Hello');
      await refreshIndex();

      const dispatch = getHandler('index_dispatch');
      if (!dispatch) throw new Error('index_dispatch not registered');
      const r = await dispatch({ action: 'patch', id: 'alpha', op: 'append', text: '!' }) as Rec;

      expect(r.changed).toBe(true);
      expect(readFromDisk('alpha').body).toBe('Hello!');
    });

    it('advertises patch in the dispatcher capabilities list', async () => {
      const dispatch = getHandler('index_dispatch');
      if (!dispatch) throw new Error('index_dispatch not registered');
      const r = await dispatch({ action: 'capabilities' }) as Rec;

      expect(r.supportedActions as string[]).toContain('patch');
    });
  });

  // ── schema registration ─────────────────────────────────────────────
  // validationService prefers Zod over Ajv when a Zod schema is present, so a
  // tool missing from zodMap silently validates on a different code path than
  // every one of its peers. Asserted the same way messaging_manage does.
  describe('schema registration', () => {
    it('registers a Zod schema so validation uses the same path as its peers', async () => {
      const { hasZodSchema } = await import('../../../services/toolRegistry.zod.js');
      expect(hasZodSchema('index_patch')).toBe(true);
    });

    it('attaches the Zod schema to the enhanced registry entry', async () => {
      const { getZodEnhancedRegistry } = await import('../../../services/toolRegistry.zod.js');
      const entry = getZodEnhancedRegistry().find(t => t.name === 'index_patch');
      expect(entry).toBeDefined();
      expect(entry?.zodSchema).toBeDefined();
    });

    it('accepts a valid patch payload', async () => {
      const { getZodSchema } = await import('../../../services/toolRegistry.zod.js');
      const schema = getZodSchema('index_patch');
      if (!schema) throw new Error('index_patch Zod schema not registered');

      expect(() => schema.parse({
        id: 'alpha', op: 'splice', bodyOffset: 0, bodyLength: 2, text: 'hi',
        expectedSourceHash: 'b'.repeat(64), bump: 'patch', summary: 's', dryRun: true,
      })).not.toThrow();
    });

    it('rejects an unknown op', async () => {
      const { getZodSchema } = await import('../../../services/toolRegistry.zod.js');
      const schema = getZodSchema('index_patch');
      if (!schema) throw new Error('index_patch Zod schema not registered');

      expect(() => schema.parse({ id: 'alpha', op: 'obliterate' })).toThrow();
    });

    it('rejects a payload missing the required id', async () => {
      const { getZodSchema } = await import('../../../services/toolRegistry.zod.js');
      const schema = getZodSchema('index_patch');
      if (!schema) throw new Error('index_patch Zod schema not registered');

      expect(() => schema.parse({ op: 'append', text: 'x' })).toThrow();
    });

    it('rejects unknown properties so typos surface instead of being ignored', async () => {
      const { getZodSchema } = await import('../../../services/toolRegistry.zod.js');
      const schema = getZodSchema('index_patch');
      if (!schema) throw new Error('index_patch Zod schema not registered');

      expect(() => schema.parse({ id: 'alpha', op: 'append', text: 'x', bodyOffest: 3 })).toThrow();
    });
  });

  // ── #538: metadata op ─────────────────────────────────────────────────
  describe('metadata op (#538)', () => {
    it('updates title without touching body or sourceHash', async () => {
      seed('meta1', 'Unchanged body', { title: 'Old Title', semanticSummary: 'old summary' });
      await refreshIndex();
      const before = readFromDisk('meta1');

      const r = await patch({ id: 'meta1', op: 'metadata', title: 'New Title' });

      expect(r.changed).toBe(true);
      expect(r.sourceHash).toBe(before.sourceHash);
      const after = readFromDisk('meta1');
      expect(after.title).toBe('New Title');
      expect(after.body).toBe('Unchanged body');
      expect(after.sourceHash).toBe(before.sourceHash);
    });

    it('updates semanticSummary', async () => {
      seed('meta2', 'body text', { semanticSummary: 'old' });
      await refreshIndex();

      const r = await patch({ id: 'meta2', op: 'metadata', semanticSummary: 'New summary' });

      expect(r.changed).toBe(true);
      expect(r.semanticSummary).toBe('New summary');
      expect(readFromDisk('meta2').semanticSummary).toBe('New summary');
    });

    it('updates categories and sets primaryCategory', async () => {
      seed('meta3', 'body text', { categories: ['old-cat'], primaryCategory: 'old-cat' });
      await refreshIndex();

      const r = await patch({ id: 'meta3', op: 'metadata', categories: ['New-Cat', 'Another'] });

      expect(r.changed).toBe(true);
      const after = readFromDisk('meta3');
      expect(after.categories).toEqual(expect.arrayContaining(['new-cat', 'another']));
      expect(after.primaryCategory).toBe('another');  // cats[0] after in-place sort
    });

    it('rejects semanticSummary exceeding 600 characters', async () => {
      seed('meta4', 'body text');
      await refreshIndex();

      const r = await patch({ id: 'meta4', op: 'metadata', semanticSummary: 'x'.repeat(601) });

      expect(r.error).toBe('invalid_params');
      expect(r.reason).toMatch(/600/);
    });

    it('supports dryRun without writing', async () => {
      seed('meta5', 'body text', { title: 'Old' });
      await refreshIndex();

      const r = await patch({ id: 'meta5', op: 'metadata', title: 'New', dryRun: true });

      expect(r.changed).toBe(true);
      expect(r.dryRun).toBe(true);
      expect(readFromDisk('meta5').title).toBe('Old');
    });

    it('respects expectedSourceHash precondition', async () => {
      seed('meta6', 'body text');
      await refreshIndex();

      const r = await patch({ id: 'meta6', op: 'metadata', title: 'New', expectedSourceHash: 'b'.repeat(64) });

      expect(r.error).toBe('precondition_failed');
      expect(readFromDisk('meta6').title).toBe('T:meta6');
    });

    it('returns changed:false when nothing actually changes', async () => {
      seed('meta7', 'body text', { contentType: 'instruction' });
      await refreshIndex();

      const r = await patch({ id: 'meta7', op: 'metadata', contentType: 'instruction' });

      expect(r.changed).toBe(false);
    });

    it('updates contentType', async () => {
      seed('meta8', 'body text', { contentType: 'instruction' });
      await refreshIndex();

      const r = await patch({ id: 'meta8', op: 'metadata', contentType: 'knowledge' });

      expect(r.changed).toBe(true);
      expect(readFromDisk('meta8').contentType).toBe('knowledge');
    });

    it('bumps version and appends changeLog when requested', async () => {
      seed('meta9', 'body text', { version: '2.0.0' });
      await refreshIndex();

      const r = await patch({ id: 'meta9', op: 'metadata', title: 'Updated', bump: 'patch', summary: 'title update' });

      expect(r.version).toBe('2.0.1');
      const after = readFromDisk('meta9');
      expect(after.version).toBe('2.0.1');
      const log = after.changeLog as Array<Rec>;
      expect(log[log.length - 1].summary).toContain('title update');
    });
  });

    it('marks embedding stale when title changes (#538-B2)', async () => {
      const { setEmbeddingEvictionHook } = await import('../../../services/indexContext.js');
      const staleIds: string[] = [];
      setEmbeddingEvictionHook({ markStale: (id) => staleIds.push(id) });

      seed('meta-embed1', 'body text', { title: 'Old Title', semanticSummary: 'old summary' });
      await refreshIndex();

      await patch({ id: 'meta-embed1', op: 'metadata', title: 'New Title' });
      expect(staleIds).toContain('meta-embed1');

      setEmbeddingEvictionHook(null);
    });

    it('marks embedding stale when semanticSummary changes (#538-B2)', async () => {
      const { setEmbeddingEvictionHook } = await import('../../../services/indexContext.js');
      const staleIds: string[] = [];
      setEmbeddingEvictionHook({ markStale: (id) => staleIds.push(id) });

      seed('meta-embed2', 'body text', { semanticSummary: 'old' });
      await refreshIndex();

      await patch({ id: 'meta-embed2', op: 'metadata', semanticSummary: 'new summary' });
      expect(staleIds).toContain('meta-embed2');

      setEmbeddingEvictionHook(null);
    });

    it('rejects primaryCategory not in categories (#538-advisory)', async () => {
      seed('meta-pc-guard', 'body text', { categories: ['alpha', 'beta'], primaryCategory: 'alpha' });
      await refreshIndex();

      const r = await patch({ id: 'meta-pc-guard', op: 'metadata', primaryCategory: 'nonexistent' });

      expect(r.error).toBe('invalid_params');
      expect(r.reason).toMatch(/member of categories/);
      expect(readFromDisk('meta-pc-guard').primaryCategory).toBe('alpha');
    });

        it('does not mark embedding stale for category-only changes (#538-B2)', async () => {
      const { setEmbeddingEvictionHook } = await import('../../../services/indexContext.js');
      const staleIds: string[] = [];
      setEmbeddingEvictionHook({ markStale: (id) => staleIds.push(id) });

      seed('meta-embed3', 'body text', { categories: ['old-cat'], primaryCategory: 'old-cat' });
      await refreshIndex();

      await patch({ id: 'meta-embed3', op: 'metadata', categories: ['new-cat'] });
      expect(staleIds).not.toContain('meta-embed3');

      setEmbeddingEvictionHook(null);
    });

    // ── #538: metadata schema registration ────────────────────────────────
  describe('metadata schema registration (#538)', () => {
    it('Zod schema accepts a valid metadata payload', async () => {
      const { getZodSchema } = await import('../../../services/toolRegistry.zod.js');
      const schema = getZodSchema('index_patch');
      if (!schema) throw new Error('index_patch Zod schema not registered');

      expect(() => schema.parse({
        id: 'test', op: 'metadata', title: 'New Title',
        semanticSummary: 'summary', categories: ['cat1'],
        primaryCategory: 'cat1', contentType: 'knowledge',
      })).not.toThrow();
    });

    it('JSON Schema op enum includes metadata', async () => {
      const { getToolRegistry } = await import('../../../services/toolRegistry.js');
      const entry = getToolRegistry({ tier: 'admin' }).find(t => t.name === 'index_patch');
      expect(entry).toBeDefined();
      const opProp = (entry!.inputSchema as any).properties?.op;
      expect(opProp?.enum).toContain('metadata');
    });
  });
});
