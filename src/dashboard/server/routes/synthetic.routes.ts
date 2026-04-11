/**
 * Synthetic Activity Routes
 * Routes: POST /admin/synthetic/activity, GET /admin/synthetic/status
 */

import { Router, Request, Response } from 'express';
import { MetricsCollector } from '../MetricsCollector.js';
import { listRegisteredMethods, getLocalHandler } from '../../../server/registry.js';
import { getWebSocketManager } from '../WebSocketManager.js';

export function createSyntheticRoutes(_metricsCollector: MetricsCollector): Router {
  const router = Router();

  // Module-private state
  let syntheticActiveRequests = 0;
  interface SyntheticSummary { runId: string; executed: number; errors: number; durationMs: number; iterationsRequested: number; concurrency: number; availableCount: number; missingHandlerCount: number; traceReason?: string; timestamp: number; }
  let lastSyntheticSummary: SyntheticSummary | null = null;
  let lastSyntheticRunId: string | null = null;

  /**
   * POST /api/admin/synthetic/activity - Generate synthetic tool activity to exercise metrics
   * body: { iterations?: number, concurrency?: number }
   */
  router.post('/admin/synthetic/activity', async (req: Request, res: Response) => {
    try {
      const iterations = Math.min(Math.max(parseInt(req.body.iterations || '10', 10), 1), 500);
      const concurrency = Math.min(Math.max(parseInt(req.body.concurrency || '2', 10), 1), 25);
      const start = Date.now();
      const runId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const wantTrace = req.query.trace === '1' || req.body?.trace === true || req.query.debug === '1' || req.body?.debug === true;
      const wantStream = wantTrace && (req.query.stream === '1' || req.body?.stream === true);

      // Whitelist of safe, read-only or idempotent methods + minimal params
      const PARAM_MAP: Record<string, unknown> = {
        'health_check': {},
        'metrics_snapshot': {},
        'meta_tools': {},
        'gates_evaluate': {},
        'index_dispatch:add': { action: 'add', entry: { id: `synthetic-${runId}`, title: 'Synthetic Instruction', body: 'Temporary synthetic entry', audience: 'all', requirement: 'optional', priority: 'low', categories: ['synthetic'], owner: 'synthetic' }, overwrite: true, lax: true },
        'index_dispatch:get': { action: 'get', id: `synthetic-${runId}` },
        'index_dispatch:list': { action: 'list' },
        'index_dispatch:query': { action: 'query', keyword: 'Synthetic', categoriesAll: [], requirement: undefined },
        'index_dispatch:update': { action: 'add', entry: { id: `synthetic-${runId}`, title: 'Synthetic Instruction Updated', body: 'Updated body', audience: 'all', requirement: 'optional', priority: 'medium', categories: ['synthetic', 'updated'], owner: 'synthetic' }, overwrite: true, lax: true },
        'index_dispatch:remove': { action: 'remove', id: `synthetic-${runId}` },
        'usage_track': { id: 'synthetic.activity' }
      };

      const allRegistered = listRegisteredMethods();
      const expandedParamEntries = Object.entries(PARAM_MAP).map(([k, v]) => {
        if (k.startsWith('index_dispatch:')) return ['index_dispatch', v] as const;
        return [k, v] as const;
      });
      const available = allRegistered.filter(m => expandedParamEntries.some(([name]) => name === m));
      if (!available.length) {
        return res.status(503).json({
          success: false,
          error: 'No safe tools available for synthetic activity',
          registeredCount: allRegistered.length,
          registeredSample: allRegistered.slice(0, 15),
          expectedAnyOf: Object.keys(PARAM_MAP),
          hint: 'If this persists, ensure handlers.* imports occur before dashboard start (see server/index.ts import order).',
          timestamp: Date.now()
        });
      }

      let executed = 0;
      let errors = 0;
      let missingHandlerCount = 0;
      const traces: Array<{ method: string; success: boolean; durationMs: number; started: number; ended: number; error?: string; skipped?: boolean; }> = [];

      let seq = 0;
      const wsManager = wantStream ? getWebSocketManager() : null;
      const runOne = async () => {
        const picked = expandedParamEntries[Math.floor(Math.random() * expandedParamEntries.length)];
        const method = picked[0];
        if (!available.includes(method)) return;
        const payload = picked[1];
        const handler = getLocalHandler(method);
        const started = Date.now();
        try {
          syntheticActiveRequests++;
          if (handler) {
            await Promise.resolve(handler(payload));
            const ended = Date.now();
            if (wantTrace && traces.length < iterations) traces.push({ method, success: true, durationMs: ended - started, started, ended });
            if (wantStream && wsManager) {
              try { wsManager.broadcast({ type: 'synthetic_trace', timestamp: Date.now(), data: { runId, seq: ++seq, total: iterations, method, success: true, durationMs: ended - started, started, ended } }); } catch {/* ignore */}
            }
          } else {
            missingHandlerCount++;
            const ended = Date.now();
            if (wantTrace && traces.length < iterations) traces.push({ method, success: false, durationMs: ended - started, started, ended, error: 'handler_not_registered', skipped: true });
            if (wantStream && wsManager) {
              try { wsManager.broadcast({ type: 'synthetic_trace', timestamp: Date.now(), data: { runId, seq: ++seq, total: iterations, method, success: false, durationMs: ended - started, started, ended, error: 'handler_not_registered', skipped: true } }); } catch {/* ignore */}
            }
          }
        } catch (err) {
          errors++;
          const ended = Date.now();
          if (wantTrace && traces.length < iterations) traces.push({ method, success: false, durationMs: ended - started, started, ended, error: err instanceof Error ? err.message : String(err) });
          if (wantStream && wsManager) {
            try { wsManager.broadcast({ type: 'synthetic_trace', timestamp: Date.now(), data: { runId, seq: ++seq, total: iterations, method, success: false, durationMs: ended - started, started, ended, error: err instanceof Error ? err.message : String(err) } }); } catch {/* ignore */}
          }
        }
        executed++;
        syntheticActiveRequests--;
      };

      // Concurrency control
      const inFlight: Promise<void>[] = [];
      for (let i = 0; i < iterations; i++) {
        if (inFlight.length >= concurrency) {
          await Promise.race(inFlight);
        }
        const p = runOne().finally(() => {
          const idx = inFlight.indexOf(p);
          if (idx >= 0) inFlight.splice(idx, 1);
        });
        inFlight.push(p);
      }
      await Promise.all(inFlight);

      const durationMs = Date.now() - start;
      const debug = req.query.debug === '1' || req.body?.debug === true;
      const traceReason = wantTrace && traces.length === 0
        ? (available.length === 0
          ? 'no_safe_tools_registered'
          : missingHandlerCount === iterations
            ? 'all_selected_handlers_missing'
            : 'no_traces_captured')
        : undefined;
      lastSyntheticRunId = runId;
      lastSyntheticSummary = {
        runId,
        executed,
        errors,
        durationMs,
        iterationsRequested: iterations,
        concurrency,
        availableCount: available.length,
        missingHandlerCount,
        traceReason,
        timestamp: Date.now()
      };
      syntheticActiveRequests = 0; // safety reset
      res.json({
        success: true,
        message: 'Synthetic activity completed',
        runId,
        executed,
        errors,
        durationMs,
        iterationsRequested: iterations,
        concurrency,
        availableCount: available.length,
        missingHandlerCount,
        ...(traceReason ? { traceReason } : {}),
        ...(debug ? { available } : {}),
        ...(wantTrace ? { traces } : {}),
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] Synthetic activity error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to run synthetic activity',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/admin/synthetic/status - real-time synthetic run status (active in-flight requests)
   */
  router.get('/admin/synthetic/status', (_req: Request, res: Response) => {
    res.json({
      success: true,
      activeRequests: syntheticActiveRequests,
      lastRunId: lastSyntheticRunId,
      lastSummary: lastSyntheticSummary,
      timestamp: Date.now()
    });
  });

  /** Expose activeSyntheticRequests for other modules (e.g. metrics.routes /performance/detailed) */
  (router as Router & { getSyntheticActiveRequests?: () => number }).getSyntheticActiveRequests = () => syntheticActiveRequests;

  return router;
}
