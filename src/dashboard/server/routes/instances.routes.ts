/**
 * Instances Routes
 * Routes: GET /instances
 */

import { Router, Request, Response } from 'express';
import { getActiveInstances } from '../InstanceManager.js';
import { logError } from '../../../services/logger.js';

export function createInstancesRoutes(): Router {
  const router = Router();

  /**
   * GET /api/instances - List all active dashboard instances
   */
  router.get('/instances', (_req: Request, res: Response) => {
    try {
      const instances = getActiveInstances();
      const current = instances.find(i => i.current);
      res.json({
        current: current ? { pid: current.pid, port: current.port, host: current.host } : null,
        instances,
        count: instances.length,
        timestamp: Date.now(),
      });
    } catch (error) {
      logError('[API] Failed to list instances:', error);
      res.status(500).json({
        error: 'Failed to list instances',
        timestamp: Date.now(),
      });
    }
  });

  return router;
}
