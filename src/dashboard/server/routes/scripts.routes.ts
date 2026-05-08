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

    // Candidate dirs (first existing wins):
    //  1. Installed package layout: <pkg-root>/scripts/client (resolved from __dirname = dist/dashboard/server/routes)
    //  2. Installed package layout (alt): <pkg-root>/scripts/dist (legacy)
    //  3. Repo dev layout: <cwd>/scripts/client
    //  4. Repo dev layout (legacy): <cwd>/scripts/dist
    const pkgRoot = path.resolve(__dirname, '..', '..', '..', '..');
    const candidateDirs = [
      path.join(pkgRoot, 'scripts', 'client'),
      path.join(pkgRoot, 'scripts', 'dist'),
      path.join(process.cwd(), 'scripts', 'client'),
      path.join(process.cwd(), 'scripts', 'dist'),
    ];

    let content: string | undefined;
    let lastErr: unknown;
    for (const scriptsDir of candidateDirs) {
      const filePath = path.join(scriptsDir, meta.file); // nosemgrep: javascript.express.security.audit.express-path-join-resolve-traversal.express-path-join-resolve-traversal -- path validated below via startsWith check
      let resolved: string;
      try {
        resolved = validatePathContainment(path.resolve(filePath), scriptsDir); // nosemgrep: javascript.express.security.audit.express-path-join-resolve-traversal.express-path-join-resolve-traversal -- containment validated by shared helper
      } catch {
        continue;
      }
      try {
        content = await readFile(resolved, 'utf-8');
        break;
      } catch (err) {
        lastErr = err;
      }
    }

    try {
      if (content === undefined) {
        const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
        if (!lastErr || message.includes('ENOENT')) {
          res.status(404).json({ error: `Script file not found on disk: ${name}` });
        } else {
          res.status(500).json({ error: `Failed to read script: ${message}` });
        }
        return;
      }
      res.setHeader('Content-Type', meta.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${meta.file}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(content); // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write -- content served with Content-Type, Content-Disposition attachment, and X-Content-Type-Options: nosniff headers
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Failed to send script: ${message}` });
    }
  });

  return router;
}
