/**
 * Route module index — re-exports all route factories and mounts dashboard routes.
 */

import { readFile } from 'fs/promises';
import path from 'path';
import { Express } from 'express';
import expressRateLimit from 'express-rate-limit';
import { createApiRoutes } from '../ApiRoutes.js';
import { MetricsCollector } from '../MetricsCollector.js';
import { generateDashboardHtml, stripGraphTab } from '../legacyDashboardHtml.js';
import { listRegisteredMethods } from '../../../server/registry.js';
import { logError } from '../../../services/logger.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { validatePathContainment } from '../utils/pathContainment.js';
import { getRuntimeConfig } from '../../../config/runtimeConfig.js';

/**
 * Strict allowlist for static-asset path parameters. Returns the matched
 * filename only if it matches the allowlist regex; otherwise null. Using a
 * fresh string from RegExp.exec() avoids passing the original tainted
 * req.params.name down the file-access chain.
 */
function safeAssetName(raw: string, pattern: RegExp): string | null {
  const match = pattern.exec(String(raw || ''));
  return match ? match[0] : null;
}

export { createStatusRoutes } from './status.routes.js';
export { createMetricsRoutes } from './metrics.routes.js';
export { createAdminRoutes } from './admin.routes.js';
export { createGraphRoutes } from './graph.routes.js';
export { createInstructionsRoutes } from './instructions.routes.js';
export { createKnowledgeRoutes } from './knowledge.routes.js';
export { createAlertsRoutes } from './alerts.routes.js';
export { createLogsRoutes } from './logs.routes.js';
export { createSyntheticRoutes } from './synthetic.routes.js';
export { createInstancesRoutes } from './instances.routes.js';
export { createToolsRoutes } from './tools.routes.js';
export { createEmbeddingsRoutes } from './embeddings.routes.js';
export { createUsageRoutes } from './usage.routes.js';
export { createScriptsRoutes } from './scripts.routes.js';
export { createMessagingRoutes } from './messaging.routes.js';
export { createSqliteRoutes } from './sqlite.routes.js';
export { createAdminFeedbackRoutes } from './admin.feedback.routes.js';

// ---------------------------------------------------------------------------
// Dashboard-level route mounting (top-level routes, not /api sub-routes)
// ---------------------------------------------------------------------------

export interface DashboardRoutesContext {
  metricsCollector: MetricsCollector;
  enableWebSockets: boolean;
  enableCors: boolean;
  graphEnabled: boolean;
  wsProtocol: 'wss' | 'ws';
  getServerInfo: () => { port: number; host: string; url: string } | null;
}

function sanitizeDocUrl(rawUrl: string, allowDataImage = false): string {
  const url = rawUrl.trim();
  if (!url) return '#';
  if (/^(https?:\/\/|\/|\.\/|\.\.\/|#)/i.test(url)) return url;
  if (allowDataImage && /^data:image\//i.test(url)) return url;
  return '#';
}

export function renderPanelMarkdownHtml(name: string, markdown: string): string {
  const bodyHtml = escapeHtml(markdown)
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^---$/gm, '<hr>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m: string, alt: string, url: string) => {
      const safeUrl = sanitizeDocUrl(url, true);
      const safeAlt = alt;
      return `<img src="${safeUrl}" alt="${safeAlt}" style="max-width:100%;border-radius:8px;border:1px solid #1f2a3a;margin:12px 0;">`;
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m: string, label: string, url: string) => {
      const safeUrl = sanitizeDocUrl(url);
      return `<a href="${safeUrl}" target="_blank" rel="noopener">${label}</a>`;
    })
    .replace(/^\| (.+) \|$/gm, (_m: string, row: string) => {
      const cells = row.split('|').map((c: string) => c.trim());
      return '<tr>' + cells.map((c: string) => `<td>${c}</td>`).join('') + '</tr>';
    })
    .replace(/^\|[-| ]+\|$/gm, '')
    .replace(/((?:<tr>.*<\/tr>\n?)+)/g, '<table>$1</table>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
    .replace(/\n{2,}/g, '\n<br>\n');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${escapeHtml(name)} - Panel Docs</title><style>body{background:#0b0f19;color:#e3ebf5;font-family:'Segoe UI',system-ui,sans-serif;padding:24px 32px;max-width:800px;margin:0 auto;line-height:1.6;}h1{color:#667eea;border-bottom:1px solid #1f2a3a;padding-bottom:8px;}h2{color:#9fb5cc;margin-top:24px;}h3{color:#b0c4de;}table{width:100%;border-collapse:collapse;margin:12px 0;}td{padding:6px 10px;border:1px solid #1f2a3a;font-size:13px;}tr:first-child td{background:#101726;font-weight:600;}code{background:#182234;padding:2px 6px;border-radius:4px;font-size:12px;}a{color:#667eea;}hr{border:none;border-top:1px solid #1f2a3a;margin:20px 0;}ul{padding-left:20px;}li{margin:4px 0;}</style></head><body>${bodyHtml}</body></html>`;
}

/**
 * Registers all top-level dashboard routes on the given Express app.
 * Called once during DashboardServer construction after middleware is set up.
 */
export function mountDashboardRoutes(app: Express, ctx: DashboardRoutesContext): void {
  // Build a per-route rate limiter using the same dashboard.http.rateLimit*
  // configuration as the /api router. Re-uses the same window/max so behavior
  // is consistent across the dashboard. Disabled if rateLimitEnabled is false.
  const httpCfg = getRuntimeConfig().dashboard.http;
  const dashboardLimiter = expressRateLimit({
    windowMs: Math.max(1, httpCfg.rateLimitWindowMs),
    max: Math.max(1, httpCfg.rateLimitMax),
    standardHeaders: true,
    legacyHeaders: false,
    validate: { ip: false },
    skip: () => !httpCfg.rateLimitEnabled,
    handler: (_req, res) => {
      const retryAfter = Number(res.getHeader('Retry-After') || Math.ceil(httpCfg.rateLimitWindowMs / 1000));
      res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Try again in ${retryAfter} second(s).`,
        retryAfterSeconds: retryAfter,
      });
    },
  });

  // Redirect root to admin panel (v2 dashboard)
  app.get('/', (_req, res) => {
    res.redirect('/admin');
  });

  // Legacy v1 dashboard (kept for backward compatibility)
  app.get('/legacy', (_req, res) => {
    const nonce = res.locals.cspNonce as string;
    const snapshot = ctx.metricsCollector.getCurrentSnapshot();
    const serverInfo = ctx.getServerInfo();
    const webSocketUrl =
      ctx.enableWebSockets && serverInfo
        ? `${ctx.wsProtocol}://${serverInfo.host}:${serverInfo.port}/ws`
        : null;
    res.send(generateDashboardHtml(nonce, snapshot, webSocketUrl));
  });

  // Admin Panel (v2 dashboard — primary UI)
  app.get('/admin', dashboardLimiter, async (_req, res) => {
    try {
      // __dirname here is src/dashboard/server/routes — step up two levels to reach client/
      const adminHtmlPath = path.join(__dirname, '..', '..', 'client', 'admin.html');
      let adminHtml = await readFile(adminHtmlPath, 'utf-8');
      if (!ctx.graphEnabled) {
        adminHtml = stripGraphTab(adminHtml);
      }
      const nonce = res.locals.cspNonce as string;
      // Inject the CSP nonce by replacing literal opening <script> tokens
      // with the nonce-bearing variant. The nonce is server-generated via
      // crypto and never user-controlled. Avoid open-ended tag regex by
      // matching only the exact literal opening forms used in admin.html.
      adminHtml = adminHtml.split('<script>').join(`<script nonce="${nonce}">`);
      adminHtml = adminHtml.split('<script defer ').join(`<script nonce="${nonce}" defer `);
      res.type('html').send(adminHtml);
    } catch (error) {
      logError('[Dashboard] Admin panel load error:', error);
      res.status(500).send('<h1>500 - Admin Panel Error</h1><p>Failed to load admin panel</p>');
    }
  });

  // Health check
  app.get('/health', (_req, res) => { // lgtm[js/missing-rate-limiting] — health check must be unrestricted
    const snapshot = ctx.metricsCollector.getCurrentSnapshot();
    res.json({
      status: 'healthy',
      timestamp: Date.now(),
      uptime: snapshot.server.uptime,
      version: snapshot.server.version,
    });
  });

  // Panel documentation — serves markdown rendered as styled HTML
  app.get('/api/docs/:name', dashboardLimiter, async (req, res) => {
    // Strict basename allowlist: a–z0–9_- only, 1–64 chars. Returns a fresh
    // string from RegExp.exec; the original tainted req.params.name never
    // reaches path.resolve. validatePathContainment is retained as
    // defense-in-depth.
    const name = safeAssetName(req.params.name, /^[a-z0-9_-]{1,64}$/i);
    if (!name) { res.status(400).send('Invalid doc name'); return; }
    const docsDir = path.resolve(__dirname, '..', '..', '..', '..', 'docs', 'panels');
    try {
      const docPath = validatePathContainment(path.resolve(docsDir, `${name}.md`), docsDir);
      const md = await readFile(docPath, 'utf-8');
      res.type('html').send(renderPanelMarkdownHtml(name, md));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Path escapes allowed base:')) {
        res.status(400).send('Invalid doc name');
        return;
      }
      res.status(404).send('<h1>404</h1><p>Panel documentation not found.</p><p><a href="/admin">Back to Admin</a></p>');
    }
  });

  // Panel screenshot — serves PNG images from docs/screenshots/
  app.get('/api/screenshots/:name', dashboardLimiter, async (req, res) => {
    // Strict basename allowlist: a–z0–9._- only, must end in .png, 1–80 chars.
    const fileName = safeAssetName(req.params.name, /^[a-z0-9._-]{1,80}\.png$/i);
    if (!fileName) { res.status(400).send('Invalid'); return; }
    const screenshotsDir = path.resolve(__dirname, '..', '..', '..', '..', 'docs', 'screenshots');
    try {
      const filePath = validatePathContainment(path.resolve(screenshotsDir, fileName), screenshotsDir);
      const data = await readFile(filePath);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(data);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Path escapes allowed base:')) {
        res.status(400).send('Invalid path');
        return;
      }
      res.status(404).send('Screenshot not found');
    }
  });

  // API sub-routes (mounted at /api). Rate limits sourced from runtimeConfig
  // (INDEX_SERVER_RATE_LIMIT_*) — see ApiRoutes.createApiRoutes.
  app.use('/api', createApiRoutes({ enableCors: ctx.enableCors }));

  // Back-compat: legacy tests expect /tools.json at dashboard root
  app.get('/tools.json', (_req, res) => {
    try {
      const tools = listRegisteredMethods();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolMetrics = ctx.metricsCollector.getToolMetrics() as Record<string, any>;
      const enrichedTools = tools.map(toolName => ({
        name: toolName,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metrics: (toolMetrics as any)[toolName] || {
          callCount: 0,
          successCount: 0,
          errorCount: 0,
          totalResponseTime: 0,
          errorTypes: {},
        },
      }));
      res.json({ tools: enrichedTools, totalTools: tools.length, timestamp: Date.now(), legacy: true });
    } catch (error) {
      logError('[Dashboard] /tools.json route error:', error);
      res.status(500).json({ error: 'Failed to get tools list' });
    }
  });

  // WebSocket connection info
  app.get('/ws-info', (_req, res) => {
    const serverInfo = ctx.getServerInfo();
    res.json({
      enabled: ctx.enableWebSockets,
      url: serverInfo ? `${ctx.wsProtocol}://${serverInfo.host}:${serverInfo.port}/ws` : null,
    });
  });

  // 404 fallback
  app.use((_req, res) => {
    res.status(404).send('<h1>404 - Page Not Found</h1><p>Return to <a href="/">Dashboard</a></p>');
  });
}
