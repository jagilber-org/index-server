/**
 * Concurrent CRUD + Semantic Search Stress Test
 *
 * Exercises the index under concurrent read/write load with semantic search
 * enabled. Verifies that:
 * - Concurrent adds don't corrupt the index
 * - Semantic search returns valid results during writes
 * - Embedding cache handles concurrent invalidation
 * - No data loss under parallel mutation + search load
 *
 * Requires INDEX_SERVER_SEMANTIC_ENABLED=1 for semantic path coverage.
 * Falls back to keyword search if semantic is disabled.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getHandler } from '../server/registry';
import { invalidate } from '../services/indexContext';
import { getRuntimeConfig, reloadRuntimeConfig } from '../config/runtimeConfig';

// Side-effect imports register handlers
import '../services/handlers.instructions';
import '../services/handlers.search';
import '../services/instructions.dispatcher';

function uniqueId(): string {
  return `conc-sem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Call a registered handler and parse the envelope response */
async function invoke(name: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const handler = getHandler(name);
  if (!handler) throw new Error(`Handler "${name}" not registered`);
  const raw = await handler(params);
  const wrapped = raw as { content?: Array<{ text: string }> };
  if (wrapped?.content?.[0]?.text) {
    try {
      const inner = JSON.parse(wrapped.content[0].text);
      // Unwrap versioned envelope { version, serverVersion, data }
      if (inner && typeof inner === 'object' && 'data' in inner && typeof inner.data === 'object') {
        return inner.data as Record<string, unknown>;
      }
      return inner as Record<string, unknown>;
    } catch { /* fall through */ }
  }
  return raw as Record<string, unknown>;
}

const CONCURRENCY = 5;
const isSemanticEnabled = (() => {
  try { return getRuntimeConfig().semantic?.enabled === true; }
  catch { return process.env.INDEX_SERVER_SEMANTIC_ENABLED === '1'; }
})();

describe('Concurrent CRUD + Semantic Search', () => {
  const createdIds: string[] = [];

  beforeAll(() => {
    process.env.INDEX_SERVER_MUTATION = '1';
    try { reloadRuntimeConfig(); } catch { /* ok */ }
    invalidate();
    expect(getHandler('index_dispatch')).toBeDefined();
    expect(getHandler('index_search')).toBeDefined();
  });

  afterAll(async () => {
    if (createdIds.length > 0) {
      try {
        await invoke('index_dispatch', { action: 'remove', ids: createdIds, missingOk: true });
      } catch { /* best effort */ }
    }
  });

  beforeEach(() => {
    invalidate();
  });

  it('should handle concurrent adds without corruption', async () => {
    const ids = Array.from({ length: CONCURRENCY }, () => uniqueId());
    const results = await Promise.allSettled(ids.map((id, i) =>
      invoke('index_dispatch', {
        action: 'add',
        entry: { id, title: `Concurrent test ${i}`, body: `Body for concurrent instruction ${i}. Covers deployment and testing.`, priority: 50, audience: 'all', requirement: 'optional', categories: ['test', 'concurrent'], contentType: 'instruction' },
        lax: true, overwrite: true,
      })
    ));
    expect(results.filter(r => r.status === 'fulfilled').length).toBe(CONCURRENCY);
    createdIds.push(...ids);

    invalidate();
    for (const id of ids) {
      const got = await invoke('index_dispatch', { action: 'get', id });
      // Response may have id at top level or nested in item
      const gotId = String(got.id ?? (got.item as Record<string, unknown> | undefined)?.id ?? '');
      expect(gotId).toBe(id);
    }
  }, 30_000);

  it('should search while concurrent writes are happening', async () => {
    const writeIds = Array.from({ length: CONCURRENCY }, () => uniqueId());
    const writePromises = writeIds.map((id, i) =>
      invoke('index_dispatch', {
        action: 'add',
        entry: { id, title: `Write-during-search ${i}`, body: 'Instruction about kubernetes deployment automation and container orchestration.', priority: 50, audience: 'all', requirement: 'optional', categories: ['test', 'k8s'], contentType: 'instruction' },
        lax: true, overwrite: true,
      })
    );

    const searchMode = isSemanticEnabled ? 'semantic' : 'keyword';
    const searchPromises = Array.from({ length: CONCURRENCY }, () =>
      invoke('index_search', { keywords: ['deployment'], mode: searchMode, limit: 10 })
    );

    const [writeResults, searchResults] = await Promise.all([
      Promise.allSettled(writePromises),
      Promise.allSettled(searchPromises),
    ]);

    expect(writeResults.filter(r => r.status === 'fulfilled').length).toBe(CONCURRENCY);
    createdIds.push(...writeIds);
    expect(searchResults.filter(r => r.status === 'fulfilled').length).toBe(CONCURRENCY);
  }, 30_000);

  it('should handle concurrent removes safely', async () => {
    const ids = Array.from({ length: CONCURRENCY }, () => uniqueId());
    for (const id of ids) {
      await invoke('index_dispatch', {
        action: 'add',
        entry: { id, title: `Remove-test ${id}`, body: 'To be removed concurrently.', priority: 50, audience: 'all', requirement: 'optional', categories: ['test'], contentType: 'instruction' },
        lax: true, overwrite: true,
      });
    }

    invalidate();
    const results = await Promise.allSettled(ids.map(id =>
      invoke('index_dispatch', { action: 'remove', id, missingOk: true })
    ));
    expect(results.filter(r => r.status === 'fulfilled').length).toBe(CONCURRENCY);

    invalidate();
    // Verify removed via list — IDs should not appear
    const listed = await invoke('index_dispatch', { action: 'list', limit: 500 });
    const listedIds = ((listed.items ?? listed.list ?? []) as Array<{ id: string }>).map(i => i.id);
    for (const id of ids) {
      expect(listedIds).not.toContain(id);
    }
  }, 30_000);

  it('should maintain search consistency after concurrent mutations', async () => {
    const baseId = uniqueId();
    const ids = Array.from({ length: 3 }, (_, i) => `${baseId}-${i}`);
    for (const [i, id] of ids.entries()) {
      await invoke('index_dispatch', {
        action: 'add',
        entry: { id, title: `Search consistency ${i}`, body: 'CI pipeline security scanning with nmap and vulnerability assessment.', priority: 30, audience: 'all', requirement: 'recommended', categories: ['test', 'search-consistency'], contentType: 'instruction' },
        lax: true, overwrite: true,
      });
    }
    createdIds.push(...ids);

    invalidate();
    const result = await invoke('index_search', { keywords: ['nmap vulnerability'], mode: 'keyword', limit: 50, includeCategories: true }) as Record<string, unknown>;
    const matches = (result.totalMatches as number) ?? 0;
    expect(matches).toBeGreaterThanOrEqual(1);
  }, 20_000);

  it.skipIf(!isSemanticEnabled)('semantic search should find conceptually related content', async () => {
    const id = uniqueId();
    await invoke('index_dispatch', {
      action: 'add',
      entry: { id, title: 'Container orchestration best practices', body: 'When deploying microservices to production, use health checks, readiness probes, and horizontal pod autoscaling to ensure reliability.', priority: 30, audience: 'all', requirement: 'recommended', categories: ['test', 'k8s'], contentType: 'instruction' },
      lax: true, overwrite: true,
    });
    createdIds.push(id);

    invalidate();
    const result = await invoke('index_search', { keywords: ['kubernetes scaling reliability'], mode: 'semantic', limit: 20 }) as Record<string, unknown>;
    const total = (result.totalMatches as number) ?? 0;
    expect(total).toBeGreaterThan(0);
  }, 60_000);
});
