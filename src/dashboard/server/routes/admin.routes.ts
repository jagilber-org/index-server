/**
 * Admin Panel Routes
 * Routes: GET /admin/config, GET /admin/flags, POST /admin/config,
 *         GET /admin/sessions, POST /admin/sessions, DELETE /admin/sessions/:sessionId,
 *         GET /admin/connections, GET /admin/sessions/history,
 *         GET /admin/maintenance, POST /admin/maintenance/mode,
 *         POST /admin/maintenance/normalize, POST /admin/maintenance/backup,
 *         GET /admin/maintenance/backups, POST /admin/maintenance/restore,
 *         DELETE /admin/maintenance/backup/:id, POST /admin/maintenance/backups/prune,
 *         GET /admin/maintenance/backup/:id/export, POST /admin/maintenance/backup/import,
 *         GET /admin/stats, POST /admin/restart, POST /admin/cache/clear,
 *         POST /admin/clear-metrics
 */

import fs from 'fs';
import { Router, Request, Response } from 'express';
import { MetricsCollector } from '../MetricsCollector.js';
import { getAdminPanel } from '../AdminPanel.js';
import { getWebSocketManager } from '../WebSocketManager.js';
import { dumpFlags, updateFlags } from '../../../services/featureFlags.js';
import { getFlagRegistrySnapshot } from '../../../services/handlers.dashboardConfig.js';
import { getLocalHandler } from '../../../server/registry.js';
import { dashboardAdminAuth } from './adminAuth.js';

export function createAdminRoutes(metricsCollector: MetricsCollector): Router {
  const router = Router();
  const adminPanel = getAdminPanel();

  router.use(dashboardAdminAuth);

  /**
   * GET /api/admin/config - Get admin configuration
   */
  router.get('/admin/config', (_req: Request, res: Response) => {
    try {
      const config = adminPanel.getAdminConfig();
      // Surface feature flags (environment + file) for visibility
      let featureFlags: Record<string, boolean> = {};
      try { featureFlags = dumpFlags(); } catch { /* ignore */ }
      // Include full registry snapshot for UI (so dashboard shows ALL flags, not just active)
      let allFlags = [] as ReturnType<typeof getFlagRegistrySnapshot>;
      try { allFlags = getFlagRegistrySnapshot(); } catch { /* ignore */ }
      res.json({
        success: true,
        config,
        featureFlags, // currently configured / resolved flags
        allFlags,     // full registry with metadata + parsed values
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] Get admin config error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get admin configuration',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Lightweight flags-only endpoint so the UI can retry if /admin/config was served from an older cache.
  router.get('/admin/flags', (_req: Request, res: Response) => {
    try {
      let featureFlags: Record<string, boolean> = {};
      try { featureFlags = dumpFlags(); } catch { /* ignore */ }
      let allFlags = [] as ReturnType<typeof getFlagRegistrySnapshot>;
      try { allFlags = getFlagRegistrySnapshot(); } catch { /* ignore */ }
      res.json({ success: true, featureFlags, allFlags, total: allFlags.length, timestamp: Date.now() });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to get flags snapshot', message: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  /**
   * POST /api/admin/config - Update admin configuration
   */
  router.post('/admin/config', (req: Request, res: Response) => {
    try {
      const updates = req.body;
      const result = adminPanel.updateAdminConfig(updates);
      // Feature flag persistence (optional field featureFlags { name:boolean })
      if (updates.featureFlags && typeof updates.featureFlags === 'object') {
        try { updateFlags(updates.featureFlags); } catch (e) { console.warn('[API] feature flag update failed:', e instanceof Error ? e.message : e); }
      }

      if (result.success) {
        res.json({
          success: true,
          message: result.message,
          timestamp: Date.now()
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.message,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('[API] Update admin config error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update admin configuration',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/admin/sessions - Get active admin sessions
   */
  router.get('/admin/sessions', (_req: Request, res: Response) => {
    try {
      const sessions = adminPanel.getActiveSessions();
      res.json({
        success: true,
        sessions,
        count: sessions.length,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] Get admin sessions error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get admin sessions',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/admin/connections - Get active websocket connections (Phase 4.1 enhancement)
   */
  router.get('/admin/connections', (_req: Request, res: Response) => {
    try {
      const wsMgr = getWebSocketManager();
      const connections = wsMgr.getActiveConnectionSummaries();
      res.json({
        success: true,
        connections: connections.sort((a: { connectedAt: number }, b: { connectedAt: number }) => a.connectedAt - b.connectedAt),
        count: connections.length,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] Get active connections error:', error);
      res.status(500).json({ success: false, error: 'Failed to get active connections' });
    }
  });

  /**
   * POST /api/admin/sessions - Create new admin session
   */
  router.post('/admin/sessions', (req: Request, res: Response) => {
    try {
      const { userId } = req.body;
      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      const session = adminPanel.createAdminSession(userId, ipAddress, userAgent);

      res.json({
        success: true,
        session,
        message: 'Admin session created successfully',
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] Create admin session error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create admin session',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * DELETE /api/admin/sessions/:sessionId - Terminate admin session
   */
  router.delete('/admin/sessions/:sessionId', (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const terminated = adminPanel.terminateSession(sessionId);

      if (terminated) {
        res.json({
          success: true,
          message: 'Admin session terminated successfully',
          timestamp: Date.now()
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Session not found',
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('[API] Terminate admin session error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to terminate admin session',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/admin/maintenance - Get maintenance information
   */
  router.get('/admin/maintenance', (_req: Request, res: Response) => {
    try {
      const maintenance = adminPanel.getMaintenanceInfo();
      res.json({
        success: true,
        maintenance,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] Get maintenance info error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get maintenance information',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/admin/maintenance/mode - Set maintenance mode
   */
  router.post('/admin/maintenance/mode', (req: Request, res: Response) => {
    try {
      const { enabled, message } = req.body;
      const result = adminPanel.setMaintenanceMode(enabled, message);

      if (result.success) {
        res.json({
          success: true,
          message: result.message,
          timestamp: Date.now()
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.message,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('[API] Set maintenance mode error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to set maintenance mode',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/admin/maintenance/normalize - Normalize instruction index
   * (FIX: extracted from /status handler where it was accidentally nested)
   */
  router.post('/admin/maintenance/normalize', async (req: Request, res: Response) => {
    try {
      const { dryRun, forceCanonical } = req.body || {};
      // We call the handler directly (registered via handlers.instructions) ensuring mutation flag is respected.
      const handler = getLocalHandler('index_normalize');
      if (!handler) {
        return res.status(503).json({ success: false, error: 'normalize_tool_unavailable' });
      }
      const started = Date.now();
      const summary = await Promise.resolve(handler({ dryRun: !!dryRun, forceCanonical: !!forceCanonical }));
      const durationMs = Date.now() - started;
      res.json({ success: true, durationMs, dryRun: !!dryRun, forceCanonical: !!forceCanonical, summary });
    } catch (err) {
      res.status(500).json({ success: false, error: 'normalize_failed', message: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * POST /api/admin/maintenance/backup - Perform system backup
   */
  router.post('/admin/maintenance/backup', async (_req: Request, res: Response) => {
    try {
      const result = await adminPanel.performBackup();

      if (result.success) {
        res.json({
          success: true,
          message: result.message,
          backupId: result.backupId,
          timestamp: Date.now()
        });
      } else {
        res.status(500).json({
          success: false,
          error: result.message,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('[API] Perform backup error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to perform backup',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/admin/maintenance/backups - List available backups
   */
  router.get('/admin/maintenance/backups', (_req: Request, res: Response) => {
    try {
      const backups = adminPanel.listBackups();
      res.json({ success: true, backups, count: backups.length, timestamp: Date.now() });
    } catch (error) {
      console.error('[API] List backups error:', error);
      res.status(500).json({ success: false, error: 'Failed to list backups', message: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  /**
   * POST /api/admin/maintenance/restore - Restore a backup
   * body: { backupId: string }
   */
  router.post('/admin/maintenance/restore', (req: Request, res: Response) => {
    try {
      const { backupId } = req.body || {};
      const result = adminPanel.restoreBackup(backupId);
      if (result.success) {
        res.json({ success: true, message: result.message, restored: result.restored, timestamp: Date.now() });
      } else {
        res.status(400).json({ success: false, error: result.message, timestamp: Date.now() });
      }
    } catch (error) {
      console.error('[API] Restore backup error:', error);
      res.status(500).json({ success: false, error: 'Failed to restore backup', message: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  /**
   * DELETE /api/admin/maintenance/backup/:id - Delete a specific backup directory
   */
  router.delete('/admin/maintenance/backup/:id', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const result = adminPanel.deleteBackup(id);
      if (result.success) {
        res.json({ success: true, message: result.message, removed: result.removed, timestamp: Date.now() });
      } else {
        res.status(400).json({ success: false, error: result.message, timestamp: Date.now() });
      }
    } catch (error) {
      console.error('[API] Delete backup error:', error);
      res.status(500).json({ success: false, error: 'Failed to delete backup', message: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  /**
   * POST /api/admin/maintenance/backups/prune { retain:number } - retain newest N (0 = delete all)
   */
  router.post('/admin/maintenance/backups/prune', (req: Request, res: Response) => {
    try {
      const retain = typeof req.body?.retain === 'number' ? req.body.retain : 10;
      const result = adminPanel.pruneBackups(retain);
      if (result.success) {
        res.json({ success: true, message: result.message, pruned: result.pruned, timestamp: Date.now() });
      } else {
        res.status(400).json({ success: false, error: result.message, timestamp: Date.now() });
      }
    } catch (error) {
      console.error('[API] Prune backups error:', error);
      res.status(500).json({ success: false, error: 'Failed to prune backups', message: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  /**
   * GET /api/admin/maintenance/backup/:id/export - Export backup as downloadable zip or JSON bundle
   */
  router.get('/admin/maintenance/backup/:id/export', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const result = adminPanel.exportBackup(id);
      if (result.success && result.zipPath) {
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${id}.zip"`);
        const stream = fs.createReadStream(result.zipPath);
        stream.pipe(res);
      } else if (result.success && result.bundle) {
        // Legacy directory backup — serve as JSON
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${id}.json"`);
        res.json(result.bundle);
      } else {
        res.status(400).json({ success: false, error: result.message, timestamp: Date.now() });
      }
    } catch (error) {
      console.error('[API] Export backup error:', error);
      res.status(500).json({ success: false, error: 'Failed to export backup', message: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  /**
   * POST /api/admin/maintenance/backup/import - Import backup from uploaded JSON bundle
   * body: { manifest?: object, files: { [filename]: content } }
   */
  router.post('/admin/maintenance/backup/import', (req: Request, res: Response) => {
    try {
      const bundle = req.body;
      if (!bundle || typeof bundle !== 'object' || !bundle.files) {
        return res.status(400).json({ success: false, error: 'Request body must contain a "files" object', timestamp: Date.now() });
      }
      const result = adminPanel.importBackup(bundle);
      if (result.success) {
        res.json({ success: true, message: result.message, backupId: result.backupId, files: result.files, timestamp: Date.now() });
      } else {
        res.status(400).json({ success: false, error: result.message, timestamp: Date.now() });
      }
    } catch (error) {
      console.error('[API] Import backup error:', error);
      res.status(500).json({ success: false, error: 'Failed to import backup', message: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  /**
   * GET /api/admin/stats - Get comprehensive admin statistics
   */
  router.get('/admin/stats', (_req: Request, res: Response) => {
    try {
      const stats = adminPanel.getAdminStats();
      res.json({
        success: true,
        stats,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] Get admin stats error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get admin statistics',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/admin/sessions/history - Historical admin sessions (bounded)
   */
  router.get('/admin/sessions/history', (req: Request, res: Response) => {
    try {
      const limitParam = req.query.limit as string | undefined;
      const limit = limitParam ? parseInt(limitParam, 10) : undefined;
      const history = adminPanel.getSessionHistory(limit);
      res.json({
        success: true,
        history,
        count: history.length,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] Get session history error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get session history',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * POST /api/admin/restart - Restart server components
   */
  router.post('/admin/restart', async (req: Request, res: Response) => {
    try {
      const { component = 'all' } = req.body;
      const result = await adminPanel.restartServer(component);

      if (result.success) {
        res.json({
          success: true,
          message: result.message,
          timestamp: Date.now()
        });
      } else {
        res.status(500).json({
          success: false,
          error: result.message,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('[API] Restart server error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to restart server',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/admin/cache/clear - Clear server caches
   */
  router.post('/admin/cache/clear', (_req: Request, res: Response) => {
    try {
      const result = adminPanel.clearCaches();

      if (result.success) {
        res.json({
          success: true,
          message: result.message,
          cleared: result.cleared,
          timestamp: Date.now()
        });
      } else {
        res.status(500).json({
          success: false,
          error: result.message,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('[API] Clear caches error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to clear caches',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/admin/clear-metrics - Clear all metrics data (admin only)
   */
  router.post('/admin/clear-metrics', (_req: Request, res: Response) => {
    try {
      metricsCollector.clearMetrics();

      res.json({
        success: true,
        message: 'Metrics cleared successfully',
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('[API] Clear metrics error:', error);
      res.status(500).json({
        error: 'Failed to clear metrics',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  return router;
}
