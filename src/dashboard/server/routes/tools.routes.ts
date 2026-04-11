/**
 * Tools Routes — REST bridge for MCP tool handlers
 * Routes: POST /tools/:name, GET /tools
 */

import { Router, Request, Response } from 'express';
import { getLocalHandler, listRegisteredMethods } from '../../../server/registry.js';

export function createToolsRoutes(): Router {
  const router = Router();

  /**
   * GET /api/tools — List all registered tool names
   */
  router.get('/tools', (_req: Request, res: Response) => {
    res.json({ tools: listRegisteredMethods() });
  });

  /**
   * POST /api/tools/:name — Invoke a registered MCP tool handler by name
   * Body: JSON params passed directly to the handler
   * Returns: handler result or error
   */
  router.post('/tools/:name', async (req: Request, res: Response) => {
    const toolName = req.params.name;
    if (!toolName || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(toolName)) {
      res.status(400).json({ error: 'Invalid tool name' });
      return;
    }

    const handler = getLocalHandler(toolName);
    if (!handler) {
      res.status(404).json({ error: `Tool not found: ${toolName}`, available: listRegisteredMethods() });
      return;
    }

    try {
      const result = await handler(req.body);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message
        : (typeof err === 'object' && err !== null) ? JSON.stringify(err)
        : String(err);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
