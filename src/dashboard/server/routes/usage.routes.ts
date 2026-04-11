/**
 * Usage Signal Routes
 * Routes: GET /usage/snapshot - returns per-instruction usage signals
 */

import { Router, Request, Response } from 'express';
import { loadUsageSnapshot } from '../../../services/indexContext.js';

export function createUsageRoutes(): Router {
  const router = Router();

  /**
   * GET /api/usage/snapshot - Get the usage snapshot (per-instruction signals)
   */
  router.get('/usage/snapshot', (_req: Request, res: Response) => {
    try {
      const snap = loadUsageSnapshot() as Record<string, Record<string, unknown>>;
      res.json({ success: true, snapshot: snap, count: Object.keys(snap).length, timestamp: Date.now() });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to load usage snapshot', message: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  return router;
}
