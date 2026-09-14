/**
 * GET /api/usage/growth — end-to-end through the real router.
 *
 * The unit tests in catalogGrowth.spec.ts pin the maths. These pin the wiring:
 * that the route actually reads the loaded catalog, that its default window
 * reaches back to the catalog's own first entry rather than the usual 30 days,
 * and that a bad bucket is rejected rather than silently coerced.
 *
 * The seam between a correct function and its caller is exactly where a chart
 * ends up drawing nothing while every unit test stays green.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import express from 'express';
import { createUsageRoutes } from '../dashboard/server/routes/usage.routes.js';

function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('timeout')); });
  });
}

/** Catalog entry carrying only what the growth derivation reads. */
function entry(id: string, createdAt: string) {
  return { id, title: `Entry ${id}`, body: 'b', createdAt, updatedAt: createdAt };
}

describe('GET /api/usage/growth', () => {
  let server: http.Server;
  let base: string;

  // Deliberately spread over months so a 30-day default window would miss most
  // of them — that is the regression this route exists to avoid.
  const DATES = [
    '2026-02-08T01:00:00.000Z',
    '2026-02-08T02:00:00.000Z',
    '2026-02-26T10:00:00.000Z',
    '2026-06-05T10:00:00.000Z',
    '2026-08-27T09:00:00.000Z',
  ];

  beforeAll(async () => {
    // Injected rather than staged on disk. Writing fixtures to a temp dir means
    // setting INDEX_SERVER_DIR, which is process-wide; with pool:'forks' and
    // maxWorkers:3 that raced other specs doing the same and failed ~1 run in 3.
    const list = DATES.map((d, i) => entry(`growth-entry-${i}`, d));
    const app = express();
    app.use('/api', createUsageRoutes({
      loadIndex: () => ({ list }),
      listArchived: () => [],
    }));
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterAll(() => {
    if (server) server.close();
  });

  it('reaches back to the catalog\'s first entry when no window is given', async () => {
    const res = await httpGet(`${base}/api/usage/growth`);
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);

    expect(json.success).toBe(true);
    // February, not "30 days ago".
    expect(new Date(json.since).getUTCMonth()).toBe(1);
    expect(json.totals.firstCreated.slice(0, 10)).toBe('2026-02-08');
    expect(json.points.length).toBeGreaterThan(150);
  });

  it('ends at the full catalog size', async () => {
    const json = JSON.parse((await httpGet(`${base}/api/usage/growth`)).body);
    expect(json.points.at(-1).cumulative).toBe(DATES.length);
    expect(json.totals.entries).toBe(DATES.length);
  });

  it('is monotonically non-decreasing with nothing archived', async () => {
    const json = JSON.parse((await httpGet(`${base}/api/usage/growth`)).body);
    const cums = json.points.map((p: { cumulative: number }) => p.cumulative);
    for (let i = 1; i < cums.length; i++) expect(cums[i]).toBeGreaterThanOrEqual(cums[i - 1]);
  });

  it('opens a short window at the real running total, not at zero', async () => {
    const until = Date.parse('2026-09-06T00:00:00.000Z');
    const since = until - 30 * 86400000; // ~2026-08-07
    const json = JSON.parse((await httpGet(`${base}/api/usage/growth?since=${since}&until=${until}`)).body);
    // Four of the five entries predate this window, so it opens at 4 rather
    // than at zero — the regression that would make a months-old catalog look
    // like it was created last month. The fifth (2026-08-27) lands inside the
    // window and lifts the curve to 5.
    expect(json.baseline).toBe(4);
    expect(json.points[0].cumulative).toBe(4);
    expect(json.points.at(-1).cumulative).toBe(5);
    expect(json.points.reduce((n: number, p: { added: number }) => n + p.added, 0)).toBe(1);
  });

  it('marks the payload as derived', async () => {
    const json = JSON.parse((await httpGet(`${base}/api/usage/growth`)).body);
    expect(json.derived).toBe(true);
  });

  it('honours weekly bucketing', async () => {
    const json = JSON.parse((await httpGet(`${base}/api/usage/growth?bucket=week`)).body);
    expect(json.bucket).toBe('week');
    expect(json.bucketMs).toBe(7 * 86400000);
    expect(json.points.at(-1).cumulative).toBe(DATES.length);
  });

  it('rejects an unknown bucket instead of silently defaulting', async () => {
    const res = await httpGet(`${base}/api/usage/growth?bucket=fortnight`);
    expect(res.status).toBe(400);
    const json = JSON.parse(res.body);
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/Expected one of/);
  });
});

/**
 * The tests above inject their data source, which leaves the DEFAULT wiring —
 * `ensureLoaded` and `listArchivedEntries` — unexercised. That is precisely the
 * gap where a route stays green in every unit test and still serves an empty
 * chart in production, so it gets its own case.
 *
 * Asserts shape, not counts: the ambient catalog under test varies by
 * environment, and pinning a number here would either be wrong or would require
 * the process-global fixture setup this file just removed.
 */
describe('GET /api/usage/growth — default wiring', () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.use('/api', createUsageRoutes()); // no deps — real ensureLoaded/listArchivedEntries
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterAll(() => { if (server) server.close(); });

  it('resolves its data source without injection and returns a well-formed series', async () => {
    const res = await httpGet(`${base}/api/usage/growth`);
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);

    expect(json.success).toBe(true);
    expect(json.derived).toBe(true);
    expect(Array.isArray(json.points)).toBe(true);
    expect(typeof json.baseline).toBe('number');
    expect(typeof json.totals.entries).toBe('number');
    // Dense series: every bucket is present and carries a numeric running total.
    for (const p of json.points.slice(0, 25)) {
      expect(Number.isFinite(p.ts)).toBe(true);
      expect(Number.isFinite(p.cumulative)).toBe(true);
      expect(p.cumulative).toBeGreaterThanOrEqual(0);
    }
  });
});
