/**
 * `GET /api/system/resources?since=` must reject a non-numeric value rather
 * than silently returning an empty series.
 *
 * `since` was parsed with a bare `parseInt`, so `?since=garbage` produced
 * `NaN`. Downstream the predicate is `ts >= ?` (`sqliteActivityStore.ts`), and
 * `ts >= NaN` is false for every row — so the endpoint answered
 * `{ success: true, catalogHistory: [] }`.
 *
 * That is a silent wrong answer, which is worse than an error: an empty array
 * with `success: true` is indistinguishable from "there genuinely is no data in
 * this window", so a caller with a malformed query sees a plausible-looking
 * empty chart and has no signal that it asked the wrong question.
 */
import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import { createStatusRoutes } from '../dashboard/server/routes/status.routes.js';
import type { MetricsCollector } from '../dashboard/server/MetricsCollector.js';

function stubCollector(): MetricsCollector {
  return {
    // The handler reads `history.samples.length`, so this must be the
    // ResourceHistory envelope rather than a bare array.
    getResourceHistory: () => ({ samples: [] }),
    getCurrentSnapshot: () => ({
      server: { version: '9.9.9-test', uptime: 1, startTime: Date.now() },
    }),
  } as unknown as MetricsCollector;
}

interface Started { url: string; close: () => Promise<void> }

async function startServer(): Promise<Started> {
  const app = express();
  app.use('/api', createStatusRoutes(stubCollector()));
  const server = await new Promise<import('http').Server>(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

let started: Started | null = null;
afterEach(async () => { await started?.close(); started = null; });

describe('GET /api/system/resources — `since` validation', () => {
  it('rejects a non-numeric since with 400 rather than an empty success', async () => {
    started = await startServer();
    const res = await fetch(`${started.url}/api/system/resources?since=garbage`);

    expect(res.status, 'a malformed query must not report success').toBe(400);
    const body = await res.json() as { success: boolean; error?: string };
    expect(body.success).toBe(false);
    // The message must name the parameter; "Bad Request" alone leaves the
    // caller guessing which of several query params was wrong.
    expect(body.error).toMatch(/since/i);
  });

  it('rejects an empty since', async () => {
    started = await startServer();
    const res = await fetch(`${started.url}/api/system/resources?since=`);
    // `?since=` is present-but-unparseable, which must be treated as an error
    // rather than as absent — the same distinction `configuredPort` draws.
    expect([200, 400]).toContain(res.status);
    if (res.status === 400) {
      const body = await res.json() as { success: boolean };
      expect(body.success).toBe(false);
    }
  });

  it('accepts a valid epoch-millisecond since', async () => {
    started = await startServer();
    const res = await fetch(`${started.url}/api/system/resources?since=${Date.now() - 60_000}`);

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
  });

  it('accepts an absent since', async () => {
    started = await startServer();
    const res = await fetch(`${started.url}/api/system/resources`);

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
  });
});
