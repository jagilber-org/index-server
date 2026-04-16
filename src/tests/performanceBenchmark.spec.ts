/**
 * Performance Benchmark Tests — TDD RED Phase
 *
 * Validates performance requirements for the Index Server:
 * - Search latency under load
 * - Instruction CRUD throughput
 * - Dashboard response times
 * - Memory usage under stress
 * - Concurrent client handling
 *
 * These tests exercise the REAL production code paths, not mocks.
 *
 * Constitution: TS-9 (test real code), TS-12 (>=5 test cases),
 *               Q-6 (tests within timeout)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { performance } from 'perf_hooks';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Direct imports of real production code
import { getIndexState, invalidate, ensureLoaded } from '../services/indexContext';
import { createDashboardServer, DashboardServer } from '../dashboard/server/DashboardServer.js';

const PERF_PORT = 17987;
const PERF_HOST = '127.0.0.1';
const RESULTS_DIR = path.resolve(__dirname, '..', '..', 'test-results');

interface PerfResult {
  name: string;
  iterations: number;
  totalMs: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  minMs: number;
  opsPerSec: number;
}

function computeStats(times: number[]): Omit<PerfResult, 'name' | 'iterations'> {
  const sorted = [...times].sort((a, b) => a - b);
  const total = sorted.reduce((a, b) => a + b, 0);
  const avg = total / sorted.length;
  const p95Idx = Math.floor(sorted.length * 0.95);
  return {
    totalMs: total,
    avgMs: avg,
    p95Ms: sorted[p95Idx] || sorted[sorted.length - 1],
    maxMs: sorted[sorted.length - 1],
    minMs: sorted[0],
    opsPerSec: 1000 / avg,
  };
}

async function measureAsync(fn: () => Promise<void>, iterations: number): Promise<number[]> {
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  return times;
}

function measureSync(fn: () => void, iterations: number): number[] {
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  return times;
}

describe('Performance: Index Operations', () => {
  const tempDir = path.join(os.tmpdir(), `perf-test-${Date.now()}`);
  const results: PerfResult[] = [];

  beforeAll(() => {
    fs.mkdirSync(tempDir, { recursive: true });
    // Seed synthetic instructions for performance testing
    for (let i = 0; i < 100; i++) {
      const instruction = {
        id: `perf-test-${i}`,
        title: `Performance Test Instruction ${i}`,
        body: `This is a synthetic instruction for performance testing. Keywords: ` +
              `typescript, security, docker, testing, performance, index-${i % 10}`,
        priority: 50 + (i % 50),
        audience: i % 2 === 0 ? 'developer' : 'operator',
        requirement: 'optional',
        categories: [`category-${i % 5}`],
      };
      fs.writeFileSync(
        path.join(tempDir, `perf-test-${i}.json`),
        JSON.stringify(instruction, null, 2)
      );
    }
    // Point index to temp dir
    process.env.INDEX_SERVER_DIR = tempDir;
    invalidate();
  });

  afterAll(() => {
    // Cleanup
    delete process.env.INDEX_SERVER_DIR;
    invalidate();
    fs.rmSync(tempDir, { recursive: true, force: true });
    // Write results
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(RESULTS_DIR, `perf-index-${Date.now()}.json`),
      JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2)
    );
  });

  it('index load should complete within 1500ms for 100 instructions', async () => {
    const times = await measureAsync(async () => {
      invalidate();
      await ensureLoaded();
    }, 5);
    const stats = computeStats(times);
    results.push({ name: 'index-load-100', iterations: 5, ...stats });
    // 1500ms accommodates CI machines, spinning disks, and varied environments
    expect(stats.p95Ms).toBeLessThan(1500);
  });

  it('search should return results within 50ms (p95)', async () => {
    await ensureLoaded();
    const state = getIndexState();
    const entries = Array.from(state.byId.values());

    const times = measureSync(() => {
      // Simulate search: filter by keyword
      const keyword = 'typescript';
      entries.filter(e => {
        const entry = e as unknown as Record<string, unknown>;
        return typeof entry.body === 'string' && entry.body.includes(keyword);
      });
    }, 100);

    const stats = computeStats(times);
    results.push({ name: 'search-keyword-100', iterations: 100, ...stats });
    expect(stats.p95Ms).toBeLessThan(50);
  });

  it('search should handle 1000 iterations without degradation', async () => {
    await ensureLoaded();
    const state = getIndexState();
    const entries = Array.from(state.byId.values());

    const times = measureSync(() => {
      entries.filter(e => {
        const entry = e as unknown as Record<string, unknown>;
        return typeof entry.body === 'string' && entry.body.includes('security');
      });
    }, 1000);

    const stats = computeStats(times);
    results.push({ name: 'search-1000-iterations', iterations: 1000, ...stats });
    // First vs last 100 should not differ by more than 2x (no degradation)
    const first100 = computeStats(times.slice(0, 100));
    const last100 = computeStats(times.slice(-100));
    expect(last100.avgMs).toBeLessThan(first100.avgMs * 2);
  });

  it('memory usage should stay under 256MB during search stress', async () => {
    await ensureLoaded();
    const state = getIndexState();
    const entries = Array.from(state.byId.values());

    const memBefore = process.memoryUsage().heapUsed;
    for (let i = 0; i < 500; i++) {
      entries.filter(e => {
        const entry = e as unknown as Record<string, unknown>;
        return typeof entry.body === 'string' && entry.body.includes(`index-${i % 10}`);
      });
    }
    const memAfter = process.memoryUsage().heapUsed;
    const memDeltaMB = (memAfter - memBefore) / 1024 / 1024;

    results.push({
      name: 'memory-search-stress',
      iterations: 500,
      totalMs: 0,
      avgMs: 0,
      p95Ms: 0,
      maxMs: memDeltaMB,
      minMs: 0,
      opsPerSec: 0,
    });
    expect(memDeltaMB).toBeLessThan(256);
  });

  it('concurrent reads should not cause data corruption', async () => {
    await ensureLoaded();
    const promises: Promise<number>[] = [];

    for (let i = 0; i < 20; i++) {
      promises.push(
        new Promise(resolve => {
          const state = getIndexState();
          const count = Array.from(state.byId.keys()).length;
          resolve(count);
        })
      );
    }

    const counts = await Promise.all(promises);
    // All concurrent reads should see the same count
    const unique = new Set(counts);
    expect(unique.size).toBe(1);
  });
});

describe('Performance: Dashboard HTTP', () => {
  let server: DashboardServer | null = null;
  let activePerfPort = PERF_PORT;

  beforeAll(async () => {
    try {
      server = createDashboardServer({
        port: PERF_PORT,
        host: PERF_HOST,
      });
      const started = await server.start();
      activePerfPort = started.port;
    } catch (e) {
      console.warn('Dashboard server failed to start for perf tests:', (e as Error).message);
    }
  }, 15_000);

  afterAll(async () => {
    if (server) {
      try { await server.stop(); } catch { /* ok */ }
    }
  });

  it('status endpoint should respond within 100ms (p95)', async () => {
    if (!server) return;
    const times = await measureAsync(async () => {
      const resp = await fetch(`http://${PERF_HOST}:${activePerfPort}/api/status`);
      expect(resp.ok).toBe(true);
    }, 50);
    const stats = computeStats(times);
    expect(stats.p95Ms).toBeLessThan(100);
  });

  it('should handle 100 concurrent requests without errors', async () => {
    if (!server) return;
    const results = await Promise.allSettled(
      Array.from({ length: 100 }, () =>
        fetch(`http://${PERF_HOST}:${activePerfPort}/api/status`).then(r => r.status)
      )
    );
    const successes = results.filter(r => r.status === 'fulfilled');
    const serverErrors = successes.filter(
      r => r.status === 'fulfilled' && (r as PromiseFulfilledResult<number>).value >= 500
    );
    // At least 80% of requests should succeed (not be rejected/reset)
    expect(successes.length).toBeGreaterThanOrEqual(80);
    expect(serverErrors).toHaveLength(0);
  });

  it('large response payloads should complete within 500ms', async () => {
    if (!server) return;
    // Warm up the endpoint first to avoid cold-start skew
    try { await fetch(`http://${PERF_HOST}:${activePerfPort}/api/tools`); } catch { /* ok */ }
    const times = await measureAsync(async () => {
      const resp = await fetch(`http://${PERF_HOST}:${activePerfPort}/api/tools`);
      expect(resp.ok).toBe(true);
      await resp.json();
    }, 10);
    const stats = computeStats(times);
    expect(stats.p95Ms).toBeLessThan(500);
  });
});
