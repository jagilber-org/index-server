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
 *   POST /mcp/rpc    - JSON-RPC 2.0 request/response
 *   GET  /mcp/health - Health check for thin clients
 *   GET  /mcp/leader - Leader info (PID, port, role)
 */

import express, { Request, Response, Router } from 'express';
import { getLocalHandler } from '../../server/registry';

export interface HttpTransportOptions {
  /** Handler lookup function (defaults to registry getHandler) */
  handlerLookup?: (method: string) => ((params: unknown) => Promise<unknown>) | undefined;
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

  // JSON-RPC 2.0 endpoint
  router.post('/rpc', express.json({ limit: '1mb' }), async (req: Request, res: Response) => {
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

    // Look up handler
    const handler = lookup(method);
    if (!handler) {
      return res.status(404).json({
        jsonrpc: '2.0',
        error: { code: -32601, message: `Method not found: ${method}` },
        id: id ?? null,
      });
    }

    try {
      const result = await handler(params ?? {});
      res.json({
        jsonrpc: '2.0',
        result,
        id: id ?? null,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Internal error';
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message },
        id: id ?? null,
      });
    }
  });

  return router;
}
