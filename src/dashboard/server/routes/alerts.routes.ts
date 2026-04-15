/**
 * Alerts Routes
 * Routes: GET /alerts/active, POST /alerts/:id/resolve, POST /alerts/generate
 */

import { Router, Request, Response } from 'express';
import { MetricsCollector } from '../MetricsCollector.js';

export function createAlertsRoutes(metricsCollector: MetricsCollector): Router {
  const router = Router();

  /**
   * GET /api/alerts/active - Get active alerts
   */
  router.get('/alerts/active', (_req: Request, res: Response) => {
    try {
      const activeAlerts = metricsCollector.getActiveAlerts();
      res.json({
        success: true,
        data: activeAlerts,
        count: activeAlerts.length,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] Active alerts error:', error);
      res.status(500).json({
        error: 'Failed to get active alerts',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/alerts/:id/resolve - Resolve an alert
   */
  router.post('/alerts/:id/resolve', (req: Request, res: Response) => {
    try {
      const alertId = req.params.id;
      const resolved = metricsCollector.resolveAlert(alertId);

      if (resolved) {
        res.json({
          success: true,
          message: `Alert ${alertId} resolved successfully`,
          timestamp: Date.now()
        });
      } else {
        res.status(404).json({
          error: 'Alert not found',
          message: `Alert with ID ${alertId} not found`,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('[API] Resolve alert error:', error);
      res.status(500).json({
        error: 'Failed to resolve alert',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/alerts/generate - Generate test alert for Phase 4 testing
   */
  router.post('/alerts/generate', (req: Request, res: Response) => {
    try {
      const { type, severity, message, value, threshold } = req.body;

      // Basic validation
      if (!type || !severity || !message || value === undefined || threshold === undefined) {
        return res.status(400).json({
          error: 'Missing required fields',
          required: ['type', 'severity', 'message', 'value', 'threshold'],
          timestamp: Date.now()
        });
      }

      const alert = metricsCollector.generateRealTimeAlert(type, severity, message, value, threshold);

      res.json({
        success: true,
        data: alert,
        message: 'Alert generated successfully',
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] Generate alert error:', error);
      res.status(500).json({
        error: 'Failed to generate alert',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  return router;
}
