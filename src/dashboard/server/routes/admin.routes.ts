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
import { getFlagRegistrySnapshot, FLAG_REGISTRY } from '../../../services/handlers.dashboardConfig.js';
import { reloadRuntimeConfig } from '../../../config/runtimeConfig.js';
import { writeOverride, clearOverride, shadowedEnv } from '../../../config/runtimeOverrides.js';
import { validateFlagUpdate, isWriteable } from '../../../services/configValidation.js';
import { listEvents, eventCounts, clearEvents } from '../../../services/eventBuffer.js';
import { getLocalHandler } from '../../../server/registry.js';
import { dashboardAdminAuth } from './adminAuth.js';
import { logError, logInfo, logWarn } from '../../../services/logger.js';

export function createAdminRoutes(metricsCollector: MetricsCollector): Router {
  const router = Router();
  const adminPanel = getAdminPanel();

  router.use(dashboardAdminAuth);

  /**
   * GET /api/admin/config - Get admin configuration (flag registry — clean break, #359).
   *
   * Response shape: { success, allFlags[], timestamp }.
   * No legacy `config`/`indexSettings`/`securitySettings`/`featureFlags` envelope.
   * Each flag carries `overlayShadowsEnv:boolean` (Morpheus revision #4).
   */
  router.get('/admin/config', (_req: Request, res: Response) => {
    try {
      let allFlags = [] as ReturnType<typeof getFlagRegistrySnapshot>;
      try { allFlags = getFlagRegistrySnapshot(); } catch (err) {
        logWarn('[API] getFlagRegistrySnapshot failed:', err instanceof Error ? err.message : err);
      }
      res.json({
        success: true,
        allFlags,
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
   * POST /api/admin/config - Update admin configuration (flag registry, #359).
   *
   * Body shape: { updates: { [FLAG_NAME]: value } }.
   * Legacy `{ serverSettings:{…} }`/`indexSettings`/`securitySettings` payloads
   * are rejected with 400 USE_FLAG_KEYS — clean break, no compatibility shim.
   *
   * Per-field validation runs through validateFlagUpdate(); ok values are
   * persisted to the overlay via writeOverride() and mirrored into process.env.
   * On any successful application the runtime config cache is invalidated so
   * `dynamic` consumers observe the new value on their next read.
   */
  router.post('/admin/config', (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      // Legacy envelope → 400. Single canonical entry point: `updates`.
      const legacyKeys = ['serverSettings', 'indexSettings', 'securitySettings'];
      const hasLegacy = legacyKeys.some(k => Object.prototype.hasOwnProperty.call(body, k));
      const updates = body.updates;
      if (hasLegacy || updates === undefined) {
        res.status(400).json({
          success: false,
          error: 'Legacy envelope payloads are no longer accepted; POST { updates: { FLAG_NAME: value } } instead.',
          code: 'USE_FLAG_KEYS',
          timestamp: Date.now(),
        });
        return;
      }
      if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
        res.status(400).json({
          success: false,
          error: 'Field `updates` must be an object of { FLAG_NAME: value }.',
          code: 'USE_FLAG_KEYS',
          timestamp: Date.now(),
        });
        return;
      }

      const registryByName = new Map(FLAG_REGISTRY.map(f => [f.name, f]));
      const results: Record<string, { applied: boolean; reloadBehavior: string; requiresRestart: boolean; error?: string }> = {};
      let anyApplied = false;

      for (const [name, raw] of Object.entries(updates as Record<string, unknown>)) {
        const entry = registryByName.get(name);
        if (!entry) {
          results[name] = { applied: false, reloadBehavior: 'restart-required', requiresRestart: true, error: `Unknown flag: ${name}` };
          continue;
        }
        const result = validateFlagUpdate(entry, raw);
        if (!result.ok) {
          results[name] = {
            applied: false,
            reloadBehavior: entry.reloadBehavior,
            requiresRestart: entry.reloadBehavior === 'restart-required',
            error: `[${result.code}] ${result.error}`,
          };
          continue;
        }
        try {
          const stringified = typeof result.value === 'boolean'
            ? (result.value ? '1' : '0')
            : String(result.value);
          writeOverride(name, stringified);
          results[name] = {
            applied: true,
            reloadBehavior: entry.reloadBehavior,
            requiresRestart: entry.reloadBehavior === 'restart-required',
          };
          anyApplied = true;
        } catch (e) {
          results[name] = {
            applied: false,
            reloadBehavior: entry.reloadBehavior,
            requiresRestart: entry.reloadBehavior === 'restart-required',
            error: `persist failed: ${e instanceof Error ? e.message : String(e)}`,
          };
        }
      }

      if (anyApplied) {
        try { reloadRuntimeConfig(); } catch (e) {
          logWarn('[API] reloadRuntimeConfig after admin update failed:', e instanceof Error ? e.message : e);
        }
        const appliedNames = Object.entries(results).filter(([, r]) => r.applied).map(([k]) => k);
        logInfo(`[admin] applied ${appliedNames.length} flag(s) via overlay: ${appliedNames.join(', ')}`);
      }

      const httpStatus = anyApplied
        ? (Object.values(results).every(r => r.applied) ? 200 : 207)
        : 400;
      res.status(httpStatus).json({
        success: anyApplied,
        results,
        timestamp: Date.now(),
      });
    } catch (error) {
      logError('[API] Update admin config error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update admin configuration',
      });
    }
  });

  /**
   * POST /api/admin/config/reset/:flag - Clear a single overlay entry (#359).
   *
   * Reset semantics:
   *  - If the flag's overlay value was shadowing a boot-time ENV value, the
   *    response message says "revert to ENV value X" and process.env is
   *    restored to the shadowed value.
   *  - Otherwise the message mentions reverting to the built-in default.
   * In both cases the on-disk overlay entry is removed atomically and the
   * runtime config cache is reloaded.
   */
  router.post('/admin/config/reset/:flag', (req: Request, res: Response) => {
    const name = req.params.flag;
    try {
      const entry = FLAG_REGISTRY.find(f => f.name === name);
      if (!entry) {
        res.status(404).json({ success: false, error: `Unknown flag: ${name}`, timestamp: Date.now() });
        return;
      }
      // #359 C1 — readonly guard. Resetting a readonly flag (especially
      // `INDEX_SERVER_ADMIN_API_KEY` with readonlyReason:'sensitive') would
      // delete the admin bearer token from process.env, leaving the loopback
      // fallback as the only auth gate. Reject any readonly reset here.
      if (!isWriteable(entry)) {
        res.status(409).json({
          success: false,
          error: `Flag ${name} is readonly (${entry.editable === false ? entry.readonlyReason : 'reserved'}) and cannot be reset via the dashboard.`,
          code: 'READONLY',
          readonlyReason: entry.editable === false ? entry.readonlyReason : undefined,
          timestamp: Date.now(),
        });
        return;
      }
      const priorShadow = shadowedEnv()[name];
      const shadowing = priorShadow !== undefined;
      // clearOverride() now owns the process.env restore contract (#359
      // reliability advisory): on success it restores the shadowed value
      // when present, or deletes the env var otherwise. We still read
      // shadowedEnv() above to produce the right user-facing message copy.
      try { clearOverride(name); } catch (e) {
        res.status(500).json({ success: false, error: `Failed to clear overlay: ${e instanceof Error ? e.message : String(e)}`, timestamp: Date.now() });
        return;
      }
      try { reloadRuntimeConfig(); } catch (e) {
        logWarn('[API] reloadRuntimeConfig after reset failed:', e instanceof Error ? e.message : e);
      }
      const defaultLabel = entry.default ?? '(default)';
      const message = shadowing
        ? `Reverted ${name} to ENV value \`${priorShadow}\`.`
        : `Reverted ${name} to default \`${defaultLabel}\`.`;
      res.json({ success: true, message, shadowedEnvValue: shadowing ? priorShadow : null, timestamp: Date.now() });
    } catch (error) {
      logError('[API] Reset admin config error:', error);
      res.status(500).json({ success: false, error: 'Failed to reset admin configuration' });
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
      logInfo('[admin] restore requested', { backupId });
      const result = adminPanel.restoreBackup(backupId);
      logInfo('[admin] restore result', { backupId, success: result.success, restored: result.restored ?? 0, message: result.message });
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
    logInfo('[admin] backup/import received', { ctype, body: bodyKind, restore: wantRestore });
    try {
      let importResult: { success: boolean; message: string; backupId?: string; files?: number };
      if (bodyBuffer !== null && bodyBuffer.length > 0) {
        const filenameHeader = req.header('x-backup-filename') || req.header('x-file-name');
        const sourceName = typeof filenameHeader === 'string' ? filenameHeader : undefined;
        importResult = adminPanel.importZipBackup(bodyBuffer, sourceName);
      } else {
        if (bodyObject === null) {
          logWarn('[admin] backup/import rejected', { reason: 'body-not-json-object', ctype });
          return res.status(400).json({ success: false, error: 'Request body must be a JSON object containing a "files" object', timestamp: Date.now() });
        }
        const bundle = bodyObject;
        const files = bundle.files;
        if (!files || typeof files !== 'object' || Array.isArray(files)) {
          logWarn('[admin] backup/import rejected', { reason: 'missing-or-invalid-files-object' });
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
        logWarn('[admin] backup/import failed', { message: importResult.message });
        return res.status(400).json({ success: false, error: importResult.message, timestamp: Date.now() });
      }
      logInfo('[admin] backup/import ok', { backupId: importResult.backupId, files: importResult.files });

      if (wantRestore && importResult.backupId) {
        logInfo('[admin] backup/import auto-restore start', { backupId: importResult.backupId });
        const restoreResult = adminPanel.restoreBackup(importResult.backupId);
        logInfo('[admin] backup/import auto-restore result', { backupId: importResult.backupId, success: restoreResult.success, restored: restoreResult.restored ?? 0, message: restoreResult.message });
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

  /**
   * GET /api/admin/events - Recent WARN/ERROR events from the in-memory ring buffer
   * Query: ?since=<id>&level=WARN|ERROR&limit=<n>
   */
  router.get('/admin/events', (req: Request, res: Response) => {
    try {
      const since = req.query.since !== undefined ? parseInt(String(req.query.since), 10) : undefined;
      const limit = req.query.limit !== undefined ? parseInt(String(req.query.limit), 10) : undefined;
      const levelRaw = String(req.query.level || '').toUpperCase();
      const level = (levelRaw === 'WARN' || levelRaw === 'ERROR') ? levelRaw : undefined;
      const events = listEvents({
        sinceId: Number.isFinite(since) ? since : undefined,
        limit: Number.isFinite(limit) ? limit : undefined,
        level,
      });
      const counts = eventCounts(0);
      res.json({ success: true, events, counts, timestamp: Date.now() });
    } catch (error) {
      logError('[API] Get events error:', error);
      res.status(500).json({ success: false, error: 'Failed to read events' });
    }
  });

  /**
   * GET /api/admin/events/counts - Lightweight counts for nav-bubble polling
   */
  router.get('/admin/events/counts', (req: Request, res: Response) => {
    try {
      const since = req.query.since !== undefined ? parseInt(String(req.query.since), 10) : 0;
      const counts = eventCounts(Number.isFinite(since) ? since : 0);
      res.json({ success: true, counts, timestamp: Date.now() });
    } catch (error) {
      logError('[API] Get event counts error:', error);
      res.status(500).json({ success: false, error: 'Failed to read event counts' });
    }
  });

  /**
   * DELETE /api/admin/events - Clear the buffer (also acts as "mark all read")
   */
  router.delete('/admin/events', (_req: Request, res: Response) => {
    try {
      clearEvents();
      res.json({ success: true, message: 'Events cleared', timestamp: Date.now() });
    } catch (error) {
      logError('[API] Clear events error:', error);
      res.status(500).json({ success: false, error: 'Failed to clear events' });
    }
  });

  return router;
}
