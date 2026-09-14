/**
 * HttpTransport - HTTP/JSON-RPC transport for the Index Server leader.
 *
 * **EXPERIMENTAL** — APIs, configuration, and behavior may change.
 *
 * When running as leader, the server exposes an HTTP endpoint that thin clients
 * can forward JSON-RPC requests to. This reuses the existing handler registry
 * so all MCP tools work over HTTP without any handler changes.
 *
 * Endpoints:
 *   POST /mcp/rpc    - JSON-RPC 2.0 request/response (authenticated, guarded)
 *   GET  /mcp/health - Health check for thin clients
 *   GET  /mcp/leader - Leader info (PID, port, role)
 *
 * Issue #605: `POST /mcp/rpc` is a live tool-invocation path and must carry the
 * same controls as the stdio `tools/call` path. It now runs:
 *   - {@link mcpTransportAuth} — loopback-only without an admin key, Bearer
 *     with one, matching `routes/adminAuth.ts` so the leader cannot expose
 *     unauthenticated tool invocation when bound to 0.0.0.0.
 *   - {@link guardToolInvocation} — the declared-tool gate (#592), handler
 *     lookup and INPUT_SCHEMA validation (#581), shared with sdkServer rather
 *     than copied, so a third transport cannot miss them.
 */

import express, { NextFunction, Request, Response, Router } from 'express';
import { getLocalHandler } from '../../server/registry';
import { log } from '../../services/logger';
import { logAudit } from '../../services/auditLog';
import { guardToolInvocation } from '../../server/toolInvocationGuard';
import { constantTimeKeyMatch, isLoopbackHost } from './routes/adminAuth.js';
import { getRuntimeConfig } from '../../config/runtimeConfig.js';

export interface HttpTransportOptions {
  /** Handler lookup function (defaults to the registry's local, unwrapped handlers) */
  handlerLookup?: (method: string) => ((params: unknown) => Promise<unknown>) | undefined;
}

/**
 * Authentication for the MCP HTTP transport's tool-invocation route.
 *
 * Deliberately identical in policy to `dashboardAdminAuth`: no key set means
 * loopback callers pass and everyone else gets 403; a key set means a
 * constant-time `Authorization: Bearer` match is required, 401 otherwise. It
 * is a separate function only because this router is mounted on its own bare
 * express app (`multiInstanceStartup.ts:38,90`), never on the dashboard app,
 * so it cannot inherit the dashboard's middleware.
 *
 * Fails CLOSED: any caller that is neither loopback nor key-bearing is refused
 * before the JSON body is parsed.
 */
export function mcpTransportAuth(req: Request, res: Response, next: NextFunction): void {
  const adminKey = getRuntimeConfig().dashboard.http.adminApiKey;
  if (!adminKey) {
    const host = req.ip || req.socket.remoteAddress;
    if (isLoopbackHost(host)) {
      next();
      return;
    }
    logAudit('rpc_auth_denied', undefined, { reason: 'non_loopback_no_key', host: host ?? null }, 'http');
    res.status(403).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'MCP HTTP transport restricted to localhost' },
      id: null,
    });
    return;
  }

  const provided = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (constantTimeKeyMatch(provided, adminKey)) {
    next();
    return;
  }

  logAudit('rpc_auth_denied', undefined, { reason: 'bad_or_missing_key' }, 'http');
  res.status(401).json({
    jsonrpc: '2.0',
    error: { code: -32001, message: 'Admin API key required. Set INDEX_SERVER_ADMIN_API_KEY and pass via Authorization: Bearer <key>' },
    id: null,
  });
}

/**
 * Create an Express router for the MCP HTTP transport.
 */
export function createMcpTransportRoutes(options: HttpTransportOptions = {}): Router {
  const router = Router();
  const lookup = options.handlerLookup ?? getLocalHandler;

  // Health check for thin client connectivity probing
  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      pid: process.pid,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // Leader info endpoint
  router.get('/leader', (_req: Request, res: Response) => {
    res.json({
      pid: process.pid,
      port: (res.req.socket.localPort || 0),
      role: 'leader',
      timestamp: new Date().toISOString(),
    });
  });

  // JSON-RPC 2.0 endpoint — authenticated (#605) before the body is parsed.
  router.post('/rpc', mcpTransportAuth, express.json({ limit: '1mb' }), async (req: Request, res: Response) => {
    const body = req.body;

    // Validate JSON-RPC structure
    if (!body || body.jsonrpc !== '2.0' || !body.method) {
      return res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32600, message: 'Invalid Request: missing jsonrpc or method' },
        id: body?.id ?? null,
      });
    }

    const { method, params, id } = body;

    // Two request shapes reach this route, both produced by code in this repo:
    //   - `method: '<tool>'`        — the follower handler proxy
    //     (`multiInstanceStartup.ts:71-77`, `docs/multi_instance_design.md:261`)
    //   - `method: 'tools/call'`    — a raw MCP frame relayed verbatim by the
    //     thin client (`ThinClient.processFrame` -> `sendRpc(parsed.method, ...)`)
    // Both must pass the same guard, so normalise to (tool, args) first. The
    // tools/call form additionally gets the MCP content-array result shape, as
    // stdio produces, because its response is relayed straight to an MCP host.
    const isToolsCall = method === 'tools/call';
    const envelope = (isToolsCall ? params : undefined) as { name?: string; arguments?: Record<string, unknown> } | undefined;
    const toolName = isToolsCall ? (typeof envelope?.name === 'string' ? envelope.name : '') : String(method);
    const args = (isToolsCall ? (envelope?.arguments ?? {}) : (params ?? {})) as Record<string, unknown>;

    // Declared-tool gate + handler lookup + schema validation, shared verbatim
    // with the stdio path (#605). `reason` is a server-side discriminator only.
    const guard = guardToolInvocation(toolName, args, { lookup, auditKind: 'http', transport: 'http' });
    if (!guard.ok) {
      const { code, message } = guard.error;
      // -32602 (bad params for a declared tool) is a client error: 400.
      // -32601 is the uniform unknown-tool refusal; it stays 404 as before and
      // is byte-identical whether the tool is undeclared or merely absent, so
      // the status code cannot be used to enumerate hidden handlers (#592).
      const status = code === -32602 ? 400 : 404;
      return res.status(status).json({
        jsonrpc: '2.0',
        error: { code, message },
        id: id ?? null,
      });
    }

    try {
      const result = await guard.handler(args);
      res.json({
        jsonrpc: '2.0',
        result: isToolsCall
          ? { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
          : result,
        id: id ?? null,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Internal error';
      const stack = error instanceof Error ? error.stack : undefined;
      const errorType = error instanceof Error ? error.constructor.name : typeof error;
      log('ERROR', `[HttpTransport] RPC handler error for method '${method}': ${message}`, { detail: stack });
      // #605: the stack goes to the ERROR log (operator-facing, rotated) and no
      // longer into the audit log, which is an append-only record read by tools
      // and shipped with support bundles. The stdio path audits no stack either.
      logAudit('rpc_error', toolName, { error: message, errorType, requestId: id ?? null }, 'http');
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message },
        id: id ?? null,
      });
    }
  });

  return router;
}
