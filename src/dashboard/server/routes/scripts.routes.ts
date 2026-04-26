/**
 * Scripts Routes — Serve client scripts for download
 * Routes: GET /scripts, GET /scripts/:name
 *
 * Provides downloadable REST client scripts for agents and users
 * that lack MCP tool access and need to interact via HTTP.
 */

import { Router, Request, Response } from 'express';
import { readFile } from 'fs/promises';
import path from 'path';
import { validatePathContainment } from '../utils/pathContainment.js';

/** Allowed script files with metadata */
const AVAILABLE_SCRIPTS: Record<string, { file: string; contentType: string; description: string }> = {
  'index-server-client.ps1': {
    file: 'index-server-client.ps1',
    contentType: 'application/octet-stream',
    description: 'PowerShell REST client for Index Server (agents without MCP)',
  },
  'index-server-client.sh': {
    file: 'index-server-client.sh',
    contentType: 'application/octet-stream',
    description: 'Bash REST client for Index Server (agents without MCP)',
  },
};

export function createScriptsRoutes(): Router {
  const router = Router();

  /**
   * GET /api/scripts — List available client scripts with download URLs
   */
  router.get('/scripts', (_req: Request, res: Response) => {
    const scripts = Object.entries(AVAILABLE_SCRIPTS).map(([name, meta]) => ({
      name,
      description: meta.description,
      downloadUrl: `/api/scripts/${name}`,
    }));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ scripts });
  });

  /**
   * GET /api/scripts/:name — Download a specific client script
   */
  router.get('/scripts/:name', async (req: Request, res: Response) => { // lgtm[js/missing-rate-limiting] — parent router applies rate-limit
    const name = req.params.name;

    // Validate against allowlist (no path traversal)
    const meta = AVAILABLE_SCRIPTS[name];
    if (!meta) {
      res.status(404).json({
        error: `Script not found: ${name}`,
        available: Object.keys(AVAILABLE_SCRIPTS),
      });
      return;
    }

    try {
      const scriptsDir = path.join(process.cwd(), 'scripts');
      const filePath = path.join(scriptsDir, meta.file); // nosemgrep: javascript.express.security.audit.express-path-join-resolve-traversal.express-path-join-resolve-traversal -- path validated below via startsWith check

      let resolved: string;
      try {
        resolved = validatePathContainment(path.resolve(filePath), scriptsDir); // nosemgrep: javascript.express.security.audit.express-path-join-resolve-traversal.express-path-join-resolve-traversal -- containment validated by shared helper
      } catch {
        res.status(400).json({ error: 'Invalid script path' });
        return;
      }

      const content = await readFile(resolved, 'utf-8');
      res.setHeader('Content-Type', meta.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${meta.file}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(content); // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write -- content served with Content-Type, Content-Disposition attachment, and X-Content-Type-Options: nosniff headers
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('ENOENT')) {
        res.status(404).json({ error: `Script file not found on disk: ${name}` });
      } else {
        res.status(500).json({ error: `Failed to read script: ${message}` });
      }
    }
  });

  return router;
}
