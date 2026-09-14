/**
 * Usage Signal Routes
 * Routes:
 *   GET /usage/snapshot          - per-instruction usage signals (current state)
 *   GET /usage/activity          - bucketed activity flow series (added/modified/signaled/...)
 *   GET /usage/activity/instances- per-instance activity totals
 *   GET /usage/activity/events   - raw recent events for drill-down
 *   GET /usage/growth            - cumulative catalog size derived from entry timestamps
 */

import { Router, Request, Response } from 'express';
import { ensureLoaded, listArchivedEntries, loadUsageSnapshot } from '../../../services/indexContext.js';
import { computeCatalogGrowth, type GrowthSourceEntry } from '../../../services/catalogGrowth.js';
import { logError } from '../../../services/logger.js';
import {
  getActivityBuckets,
  getInstanceActivity,
  listActivity,
  getActivityLogHealth,
  type ActivityType,
} from '../../../services/activityLog.js';
import { ACTIVITY_TYPES } from '../../../services/storage/sqliteActivityStore.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Named bucket widths. Free-form widths are rejected to keep buckets aligned. */
const BUCKETS: Record<string, number> = {
  hour: HOUR_MS,
  '6h': 6 * HOUR_MS,
  day: DAY_MS,
  week: 7 * DAY_MS,
};

const DEFAULT_WINDOW_MS = 30 * DAY_MS;
const MAX_WINDOW_MS = 400 * DAY_MS;

/**
 * Resolve the `since`/`until` window from query params, clamped to
 * MAX_WINDOW_MS so a hostile or careless `since=0` cannot ask the store for
 * every row it has.
 */
function resolveWindow(req: Request): { since: number; until: number } {
  const until = Number(req.query.until) || Date.now();
  const rawSince = Number(req.query.since);
  const since = Number.isFinite(rawSince) && rawSince > 0 ? rawSince : until - DEFAULT_WINDOW_MS;
  return { since: Math.max(since, until - MAX_WINDOW_MS), until };
}

/**
 * Injectable data seams, mirroring the pattern CatalogSampler already uses.
 *
 * These exist so the growth route can be tested without reaching for process
 * globals. The obvious spec — point INDEX_SERVER_DIR at a temp directory and
 * call reloadRuntimeConfig() — mutates process-wide state, and vitest runs with
 * `pool: 'forks'` and `maxWorkers: 3`, so it collides with any other spec doing
 * the same. That produced a real 1-in-3 flake against unit/negativeTests.
 * Injecting the two reads removes the shared state instead of racing on it.
 */
export interface UsageRouteDeps {
  loadIndex?: () => { list: unknown[] };
  listArchived?: () => unknown[];
}

export function createUsageRoutes(deps: UsageRouteDeps = {}): Router {
  const router = Router();
  const loadIndex = deps.loadIndex ?? ensureLoaded;
  const listArchived = deps.listArchived ?? listArchivedEntries;

  /**
   * GET /api/usage/snapshot - Get the usage snapshot (per-instruction signals)
   */
  router.get('/usage/snapshot', (_req: Request, res: Response) => {
    try {
      const snap = loadUsageSnapshot() as Record<string, Record<string, unknown>>;
      res.json({ success: true, snapshot: snap, count: Object.keys(snap).length, timestamp: Date.now() });
    } catch (error) {
      logError('[API] Failed to load usage snapshot:', error);
      res.status(500).json({ success: false, error: 'Failed to load usage snapshot' });
    }
  });

  /**
   * GET /api/usage/activity - Bucketed activity flow series.
   *
   * Query: since, until (epoch ms), bucket (hour|6h|day|week), instance.
   *
   * Returns a DENSE series: buckets with no events are emitted as zeroes.
   * The store omits empty buckets, and a sparse series read as a bar chart
   * silently compresses quiet periods out of existence — an idle week would
   * render as adjacent to a busy one.
   */
  router.get('/usage/activity', (req: Request, res: Response) => {
    try {
      const { since, until } = resolveWindow(req);
      const bucketName = String(req.query.bucket || 'day');
      const bucketMs = BUCKETS[bucketName];
      if (!bucketMs) {
        res.status(400).json({
          success: false,
          error: `Invalid bucket "${bucketName}". Expected one of: ${Object.keys(BUCKETS).join(', ')}.`,
        });
        return;
      }

      const instance = req.query.instance ? String(req.query.instance) : undefined;
      const sparse = getActivityBuckets({ since, until, bucketMs, instance });

      const byTs = new Map(sparse.map((b) => [b.ts, b]));
      const buckets = [];
      const first = Math.floor(since / bucketMs) * bucketMs;
      for (let ts = first; ts <= until; ts += bucketMs) {
        buckets.push(
          byTs.get(ts) ?? {
            ts, added: 0, modified: 0, archived: 0, restored: 0, removed: 0, signaled: 0, signals: {},
          },
        );
      }

      res.json({
        success: true,
        since, until, bucket: bucketName, bucketMs,
        buckets,
        health: getActivityLogHealth(),
        timestamp: Date.now(),
      });
    } catch (error) {
      logError('[API] Failed to load activity buckets:', error);
      res.status(500).json({ success: false, error: 'Failed to load activity buckets' });
    }
  });

  /**
   * GET /api/usage/growth - Cumulative catalog size over time.
   *
   * Query: since, until (epoch ms), bucket (hour|6h|day|week).
   *
   * Unlike /usage/activity this reads no telemetry at all — it reconstructs the
   * curve from each entry's own createdAt/archivedAt, so it works back to the
   * oldest entry in the catalog on a server that has never recorded an activity
   * event. See src/services/catalogGrowth.ts for the survivor-curve caveat that
   * the response carries as `derived: true`.
   *
   * `since` defaults to the catalog's own first creation rather than the usual
   * 30-day window: the point of this chart is the whole history, and defaulting
   * to 30 days on a seven-month-old catalog would show a flat line.
   */
  router.get('/usage/growth', (req: Request, res: Response) => {
    try {
      const bucketName = String(req.query.bucket || 'day');
      const bucketMs = BUCKETS[bucketName];
      if (!bucketMs) {
        res.status(400).json({
          success: false,
          error: `Invalid bucket "${bucketName}". Expected one of: ${Object.keys(BUCKETS).join(', ')}.`,
        });
        return;
      }

      const live = loadIndex().list as unknown as GrowthSourceEntry[];
      // Archived entries still carry createdAt, so they belong in the curve —
      // counted on the day they were created and removed on the day they were
      // archived. Never fatal: a broken archive store must not blank the chart.
      let archived: GrowthSourceEntry[] = [];
      try {
        archived = listArchived() as unknown as GrowthSourceEntry[];
      } catch (error) {
        logError('[API] growth: archived entries unavailable, curve omits them', error);
      }
      const entries = [...live, ...archived];

      const until = Number(req.query.until) || Date.now();
      const rawSince = Number(req.query.since);
      let since: number;
      if (Number.isFinite(rawSince) && rawSince > 0) {
        since = rawSince;
      } else {
        let earliest: number | null = null;
        for (const e of entries) {
          const ms = e.createdAt ? Date.parse(e.createdAt) : NaN;
          if (Number.isFinite(ms) && (earliest === null || ms < earliest)) earliest = ms;
        }
        since = earliest ?? until - DEFAULT_WINDOW_MS;
      }
      // Same clamp as the activity window: bound the number of buckets a single
      // request can ask us to materialize.
      since = Math.max(since, until - MAX_WINDOW_MS);

      const growth = computeCatalogGrowth(entries, { since, until, bucketMs });

      res.json({
        success: true,
        since, until, bucket: bucketName, bucketMs,
        ...growth,
        timestamp: Date.now(),
      });
    } catch (error) {
      logError('[API] Failed to compute catalog growth:', error);
      res.status(500).json({ success: false, error: 'Failed to compute catalog growth' });
    }
  });

  /**
   * GET /api/usage/activity/instances - Per-instance activity totals.
   */
  router.get('/usage/activity/instances', (req: Request, res: Response) => {
    try {
      const { since, until } = resolveWindow(req);
      const instances = getInstanceActivity({ since, until });
      res.json({ success: true, since, until, instances, timestamp: Date.now() });
    } catch (error) {
      logError('[API] Failed to load instance activity:', error);
      res.status(500).json({ success: false, error: 'Failed to load instance activity' });
    }
  });

  /**
   * GET /api/usage/activity/events - Raw recent events for drill-down.
   */
  router.get('/usage/activity/events', (req: Request, res: Response) => {
    try {
      const { since, until } = resolveWindow(req);
      const rawType = req.query.type ? String(req.query.type) : undefined;
      if (rawType && !ACTIVITY_TYPES.includes(rawType as ActivityType)) {
        res.status(400).json({
          success: false,
          error: `Invalid type "${rawType}". Expected one of: ${ACTIVITY_TYPES.join(', ')}.`,
        });
        return;
      }

      const limit = Number(req.query.limit) || 200;
      const events = listActivity({
        since,
        until,
        type: rawType as ActivityType | undefined,
        instance: req.query.instance ? String(req.query.instance) : undefined,
        limit,
      });
      res.json({ success: true, since, until, count: events.length, events, timestamp: Date.now() });
    } catch (error) {
      logError('[API] Failed to load activity events:', error);
      res.status(500).json({ success: false, error: 'Failed to load activity events' });
    }
  });

  return router;
}
