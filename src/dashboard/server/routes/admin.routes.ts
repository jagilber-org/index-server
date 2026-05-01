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
import { Router, Request, Response, raw } from 'express';
import { MetricsCollector } from '../MetricsCollector.js';
import { getAdminPanel } from '../AdminPanel.js';
import { getWebSocketManager } from '../WebSocketManager.js';
import { dumpFlags, updateFlags } from '../../../services/featureFlags.js';
import { getFlagRegistrySnapshot } from '../../../services/handlers.dashboardConfig.js';
import { getLocalHandler } from '../../../server/registry.js';
import { dashboardAdminAuth } from './adminAuth.js';
import { logError, logWarn } from '../../../services/logger.js';

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
      logError('[API] Get admin config error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get admin configuration',
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
      logError('[Admin] Failed to get flags snapshot:', error);
      res.status(500).json({ success: false, error: 'Failed to get flags snapshot' });
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
        try { updateFlags(updates.featureFlags); } catch (e) { logWarn('[API] feature flag update failed:', e instanceof Error ? e.message : e); }
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
      logError('[API] Update admin config error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update admin configuration',
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
      logError('[API] Get admin sessions error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get admin sessions',
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
      logError('[API] Get active connections error:', error);
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
      logError('[API] Create admin session error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create admin session',
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
      logError('[API] Terminate admin session error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to terminate admin session',
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
      logError('[API] Get maintenance info error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get maintenance information',
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
      logError('[API] Set maintenance mode error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to set maintenance mode',
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
      logError('[Admin] Normalize failed:', err);
      res.status(500).json({ success: false, error: 'normalize_failed' });
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
      logError('[API] Perform backup error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to perform backup',
      });
    }
  });

  /**
   * GET /api/admin/maintenance/backups - List available backups
   */
  router.get('/admin/maintenance/backups', (_req: Request, res: Response) => {
    try {
      const backups = adminPanel.listBackups();
      const hasWarnings = backups.some(b => b.warnings && b.warnings.length > 0);
      res.json({ success: true, backups, count: backups.length, hasWarnings, timestamp: Date.now() });
    } catch (error) {
      logError('[API] List backups error:', error);
      res.status(500).json({ success: false, error: 'Failed to list backups' });
    }
  });

  /**
   * POST /api/admin/maintenance/restore - Restore a backup
   * body: { backupId: string }
   */
  router.post('/admin/maintenance/restore', (req: Request, res: Response) => {
    try {
      const { backupId } = req.body || {};
      process.stderr.write(`[admin] restore requested backupId=${backupId}\n`);
      const result = adminPanel.restoreBackup(backupId);
      process.stderr.write(`[admin] restore result success=${result.success} restored=${result.restored ?? 0} msg=${result.message}\n`);
      if (result.success) {
        res.json({ success: true, message: result.message, restored: result.restored, timestamp: Date.now() });
      } else {
        res.status(400).json({ success: false, error: result.message, timestamp: Date.now() });
      }
    } catch (error) {
      logError('[API] Restore backup error:', error);
      res.status(500).json({ success: false, error: 'Failed to restore backup' });
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
      logError('[API] Delete backup error:', error);
      res.status(500).json({ success: false, error: 'Failed to delete backup' });
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
        const response: Record<string, unknown> = { success: true, message: result.message, pruned: result.pruned, timestamp: Date.now() };
        if (result.errors && result.errors.length > 0) response.errors = result.errors;
        res.json(response);
      } else {
        res.status(400).json({ success: false, error: result.message, timestamp: Date.now() });
      }
    } catch (error) {
      logError('[API] Prune backups error:', error);
      res.status(500).json({ success: false, error: 'Failed to prune backups' });
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
        // Legacy directory backup — serve as JSON (include warnings if present)
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${id}.json"`);
        const body: Record<string, unknown> = { ...result.bundle };
        if (result.warnings && result.warnings.length > 0) body._warnings = result.warnings;
        res.json(body);
      } else {
        res.status(400).json({ success: false, error: result.message, timestamp: Date.now() });
      }
    } catch (error) {
      logError('[API] Export backup error:', error);
      res.status(500).json({ success: false, error: 'Failed to export backup' });
    }
  });

  /**
   * POST /api/admin/maintenance/backup/import - Import backup from uploaded JSON bundle or zip archive
   * body: { manifest?: object, files: { [filename]: content } } or raw zip bytes
   * query: ?restore=1  - if set, immediately restore the imported backup (one-click "Restore from File")
   */
  router.post('/admin/maintenance/backup/import', raw({ type: ['application/zip', 'application/octet-stream'], limit: '100mb' }), (req: Request, res: Response) => { // lgtm[js/missing-rate-limiting] — parent router applies rate-limit
    // Narrow req.query.restore safely — Express may return string | string[] | ParsedQs | ParsedQs[].
    // Only treat a literal scalar string '1' / 'true' (case-insensitive) as opt-in; arrays/objects are rejected.
    const restoreParam = req.query?.restore;
    const wantRestore = typeof restoreParam === 'string' && (restoreParam === '1' || restoreParam.toLowerCase() === 'true');
    const ctype = req.header('content-type') || '';
    const rawBody: unknown = req.body;
    // Refine req.body through typed locals so downstream uses don't rely on `as Buffer` casts.
    // CodeQL js/type-confusion-through-parameter-tampering does NOT recognize Buffer.isBuffer
    // as a sanitizer; use `instanceof Buffer` (native JS predicate, modeled by CodeQL).
    // Array.isArray IS recognized. Avoid `.length` interpolation on tainted values.
    const bodyBuffer: Buffer | null = rawBody instanceof Buffer ? rawBody : null;
    const bodyArray: unknown[] | null = Array.isArray(rawBody) ? rawBody : null;
    const bodyObject: Record<string, unknown> | null =
      rawBody !== null
        && typeof rawBody === 'object'
        && !Array.isArray(rawBody)
        && !(rawBody instanceof Buffer)
        ? (rawBody as Record<string, unknown>)
        : null;
    const bodyKind = bodyBuffer !== null
      ? 'buffer'
      : bodyArray !== null
        ? 'array'
        : bodyObject !== null
          ? 'json'
          : typeof rawBody;
    process.stderr.write(`[admin] backup/import received ctype=${ctype} body=${bodyKind} restore=${wantRestore}\n`);
    try {
      let importResult: { success: boolean; message: string; backupId?: string; files?: number };
      if (bodyBuffer !== null && bodyBuffer.length > 0) {
        const filenameHeader = req.header('x-backup-filename') || req.header('x-file-name');
        const sourceName = typeof filenameHeader === 'string' ? filenameHeader : undefined;
        importResult = adminPanel.importZipBackup(bodyBuffer, sourceName);
      } else {
        if (bodyObject === null) {
          process.stderr.write(`[admin] backup/import rejected: body is not a JSON object\n`);
          return res.status(400).json({ success: false, error: 'Request body must be a JSON object containing a "files" object', timestamp: Date.now() });
        }
        const bundle = bodyObject;
        const files = bundle.files;
        if (!files || typeof files !== 'object' || Array.isArray(files)) {
          process.stderr.write(`[admin] backup/import rejected: missing or invalid files object\n`);
          return res.status(400).json({ success: false, error: 'Request body must contain a "files" object', timestamp: Date.now() });
        }
        importResult = adminPanel.importBackup({
          manifest: typeof bundle.manifest === 'object' && bundle.manifest !== null && !Array.isArray(bundle.manifest)
            ? (bundle.manifest as Record<string, unknown>)
            : undefined,
          files: files as Record<string, unknown>,
        });
      }

      if (!importResult.success) {
        process.stderr.write(`[admin] backup/import failed: ${importResult.message}\n`);
        return res.status(400).json({ success: false, error: importResult.message, timestamp: Date.now() });
      }
      process.stderr.write(`[admin] backup/import ok backupId=${importResult.backupId} files=${importResult.files}\n`);

      if (wantRestore && importResult.backupId) {
        process.stderr.write(`[admin] backup/import auto-restore start backupId=${importResult.backupId}\n`);
        const restoreResult = adminPanel.restoreBackup(importResult.backupId);
        process.stderr.write(`[admin] backup/import auto-restore result success=${restoreResult.success} restored=${restoreResult.restored ?? 0} msg=${restoreResult.message}\n`);
        if (!restoreResult.success) {
          return res.status(500).json({ success: false, error: `Imported as ${importResult.backupId} but restore failed: ${restoreResult.message}`, backupId: importResult.backupId, files: importResult.files, restored: 0, timestamp: Date.now() });
        }
        return res.json({ success: true, message: `Imported and restored ${importResult.backupId} (${restoreResult.restored ?? 0} files)`, backupId: importResult.backupId, files: importResult.files, restored: restoreResult.restored ?? 0, restored_applied: true, timestamp: Date.now() });
      }

      return res.json({ success: true, message: importResult.message, backupId: importResult.backupId, files: importResult.files, timestamp: Date.now() });
    } catch (error) {
      logError('[API] Import backup error:', error);
      res.status(500).json({ success: false, error: 'Failed to import backup' });
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
      logError('[API] Get admin stats error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get admin statistics',
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
      logError('[API] Get session history error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get session history',
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
      logError('[API] Restart server error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to restart server',
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
      logError('[API] Clear caches error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to clear caches',
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
      logError('[API] Clear metrics error:', error);
      res.status(500).json({
        error: 'Failed to clear metrics',
      });
    }
  });

  return router;
}
