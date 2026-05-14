/**
 * RED: Dashboard Feedback Tab — Human-operator CRUD + GitHub issue handoff
 *
 * Execution order step 4: proves the MISSING behavior that Trinity (server routes)
 * and Mouse (admin.html + admin.feedback.js) must implement.
 *
 * Design constraints (from architecture review / decisions.md):
 *   - The existing api.feedback.routes.ts is the WEBHOOK/EXTERNAL-CONNECTOR surface.
 *     It MUST NOT be reused as the operator CRUD contract.
 *   - New CRUD endpoints live at /api/admin/feedback (operator-facing, admin-tier).
 *   - Storage is shared via feedbackStorage.ts (no duplication with feedback_submit MCP tool).
 *   - GitHub issue handoff is CLIENT-SIDE ONLY:
 *       • Builds a github.com URL with pre-filled title/body from the selected entry.
 *       • No server-side GitHub API calls, no token handling, no OAuth.
 *   - GitHub target repo: jagilber-org/index-server (not the internal development repo).
 *
 * Three failing surfaces exposed here:
 *   A. admin.html — no Feedback tab / section / GitHub handoff button
 *   B. admin.feedback.js — file does not exist
 *   C. /api/admin/feedback CRUD routes — not mounted (all return 404)
 *
 * After Trinity + Mouse implement the required code, all tests turn GREEN.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createDashboardServer, DashboardServer } from '../dashboard/server/DashboardServer.js';

// ── File path constants ────────────────────────────────────────────────────────

const projectRoot = path.resolve(__dirname, '..', '..');
const clientDir = path.resolve(projectRoot, 'src', 'dashboard', 'client');
const adminHtmlPath = path.resolve(clientDir, 'admin.html');
const feedbackJsPath = path.resolve(clientDir, 'js', 'admin.feedback.js');

const adminHtml = fs.readFileSync(adminHtmlPath, 'utf-8');

// ── GitHub target constants ────────────────────────────────────────────────────

const GITHUB_ORG = 'jagilber-org';
const GITHUB_REPO = 'index-server';
const GITHUB_ISSUES_URL = `https://github.com/${GITHUB_ORG}/${GITHUB_REPO}/issues/new`;

// ═══════════════════════════════════════════════════════════════════════════════
// Block A — admin.html structural tests (static file — no server needed)
// All RED: the Feedback tab does not exist in admin.html yet.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Dashboard Feedback Tab — admin.html structure', () => {

  // ── A-1: Nav button ──────────────────────────────────────────────────────────

  it('admin.html has a Feedback nav button with data-section="feedback"', () => {
    // The Feedback tab must appear in the top nav alongside Overview, Config, etc.
    expect(adminHtml).toMatch(/data-section=["']feedback["']/);
  });

  // ── A-2: Section container ───────────────────────────────────────────────────

  it('admin.html contains a feedback section element with id="feedback-section"', () => {
    expect(adminHtml).toMatch(/id=["']feedback-section["']/);
  });

  // ── A-3: Entries table ───────────────────────────────────────────────────────

  it('feedback-section contains a feedback entries table with id="feedback-table"', () => {
    // The section must contain an element for listing feedback entries.
    const sectionMatch = adminHtml.match(
      /id=["']feedback-section["'][\s\S]*?(?=<div\s+id=["'][a-z]+-section["']|$)/,
    );
    expect(sectionMatch, 'feedback-section must exist in admin.html').not.toBeNull();
    expect(
      sectionMatch![0],
      'feedback-section must contain an element with id="feedback-table"',
    ).toMatch(/id=["']feedback-table["']/);
  });

  // ── A-4: Create button ───────────────────────────────────────────────────────

  it('feedback-section contains a create-entry button with id="feedback-create-btn"', () => {
    const sectionMatch = adminHtml.match(
      /id=["']feedback-section["'][\s\S]*?(?=<div\s+id=["'][a-z]+-section["']|$)/,
    );
    expect(sectionMatch, 'feedback-section must exist').not.toBeNull();
    expect(
      sectionMatch![0],
      'feedback-section must contain id="feedback-create-btn"',
    ).toMatch(/id=["']feedback-create-btn["']/);
  });

  // ── A-5: Detail / edit area ──────────────────────────────────────────────────

  it('feedback-section contains a detail/edit area with id="feedback-detail"', () => {
    const sectionMatch = adminHtml.match(
      /id=["']feedback-section["'][\s\S]*?(?=<div\s+id=["'][a-z]+-section["']|$)/,
    );
    expect(sectionMatch, 'feedback-section must exist').not.toBeNull();
    expect(
      sectionMatch![0],
      'feedback-section must contain id="feedback-detail"',
    ).toMatch(/id=["']feedback-detail["']/);
  });

  // ── A-6: GitHub issue handoff button ─────────────────────────────────────────

  it('feedback-detail contains a GitHub issue handoff button with id="feedback-github-btn"', () => {
    const sectionMatch = adminHtml.match(
      /id=["']feedback-section["'][\s\S]*?(?=<div\s+id=["'][a-z]+-section["']|$)/,
    );
    expect(sectionMatch, 'feedback-section must exist').not.toBeNull();
    expect(
      sectionMatch![0],
      'feedback detail area must contain id="feedback-github-btn"',
    ).toMatch(/id=["']feedback-github-btn["']/);
  });

  // ── A-7: GitHub target repo is jagilber-org, not the internal development repo ──

  it('GitHub handoff button targets jagilber-org/index-server, not the internal development repo', () => {
    // The HTML may have a pre-wired href or a data-* attribute pointing at the correct repo.
    // Either form is acceptable; a server URL must NOT be used.
    const hasCorrectOrg = adminHtml.includes('jagilber-org/index-server');
    const internalRepo = `${['jagilber', 'dev'].join('-')}/index-server`;
    const hasWrongOrg = adminHtml.includes(internalRepo);
    expect(
      hasCorrectOrg,
      'admin.html must reference jagilber-org/index-server for the GitHub handoff',
    ).toBe(true);
    expect(
      hasWrongOrg,
      'admin.html must NOT reference the internal development repo',
    ).toBe(false);
  });

  // ── A-8: admin.feedback.js script tag ────────────────────────────────────────

  it('admin.html includes admin.feedback.js script tag', () => {
    expect(adminHtml).toContain('admin.feedback.js');
  });

  // ── A-9: No server-side token reference in feedback section ──────────────────

  it('feedback section HTML does not contain any GitHub token or Authorization reference', () => {
    // Client-side-only handoff: no server token should appear in HTML.
    const sectionMatch = adminHtml.match(
      /id=["']feedback-section["'][\s\S]*?(?=<div\s+id=["'][a-z]+-section["']|$)/,
    );
    // If the section doesn't exist yet this fails at A-2 — guard gracefully here.
    const sectionHtml = sectionMatch ? sectionMatch[0] : '';
    expect(sectionHtml).not.toMatch(/github[_-]?token/i);
    expect(sectionHtml).not.toMatch(/Authorization:\s*token/i);
    expect(sectionHtml).not.toMatch(/Bearer\s+[A-Za-z0-9_.-]{10,}/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Block B — admin.feedback.js static file tests
// All RED: the file does not exist yet.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Dashboard Feedback Tab — admin.feedback.js file', () => {

  // ── B-1: File existence ───────────────────────────────────────────────────────

  it('admin.feedback.js exists at src/dashboard/client/js/admin.feedback.js', () => {
    expect(
      fs.existsSync(feedbackJsPath),
      `admin.feedback.js not found at ${feedbackJsPath}`,
    ).toBe(true);
  });

  // Helper: read file only when it exists (avoids crashing subsequent tests)
  function readFeedbackJs(): string {
    if (!fs.existsSync(feedbackJsPath)) return '';
    return fs.readFileSync(feedbackJsPath, 'utf-8');
  }

  // ── B-2: GitHub URL builder ───────────────────────────────────────────────────

  it('admin.feedback.js contains a buildGitHubIssueUrl (or equivalent) function', () => {
    const src = readFeedbackJs();
    // Accept either a named function or an arrow assigned to a variable.
    const hasFn =
      /function\s+buildGitHubIssueUrl\b/.test(src) ||
      /buildGitHubIssueUrl\s*[=:]\s*(function|\()/.test(src) ||
      /buildGitHub(Issue)?Url\b/.test(src);
    expect(
      hasFn,
      'admin.feedback.js must contain a buildGitHubIssueUrl (or equivalent) function',
    ).toBe(true);
  });

  // ── B-3: Targets the correct GitHub repo URL ──────────────────────────────────

  it(`admin.feedback.js constructs a URL pointing at ${GITHUB_ISSUES_URL}`, () => {
    const src = readFeedbackJs();
    expect(src).toContain(GITHUB_ISSUES_URL);
  });

  // ── B-4: Passes title param from feedback entry ───────────────────────────────

  it('admin.feedback.js includes "title" query param when building the GitHub URL', () => {
    const src = readFeedbackJs();
    // The function must set a `title` query parameter on the GitHub new-issue URL.
    expect(src).toMatch(/['"?&]title['"=]/);
  });

  // ── B-5: Passes body param from feedback entry ────────────────────────────────

  it('admin.feedback.js includes "body" query param when building the GitHub URL', () => {
    const src = readFeedbackJs();
    expect(src).toMatch(/['"?&]body['"=]/);
  });

  // ── B-6: No GitHub token handling ─────────────────────────────────────────────

  it('admin.feedback.js does NOT contain any GitHub token or OAuth handling', () => {
    const src = readFeedbackJs();
    expect(src).not.toMatch(/github[_-]?token/i);
    expect(src).not.toMatch(/Authorization:\s*token/i);
    expect(src).not.toMatch(/octokit/i);
    expect(src).not.toMatch(/Bearer\s+[A-Za-z0-9_.-]{10,}/);
  });

  // ── B-7: No server-side GitHub API fetch ─────────────────────────────────────

  it('admin.feedback.js does NOT fetch the GitHub API server-side', () => {
    const src = readFeedbackJs();
    // A client-side handoff opens a URL — it does NOT POST to the GitHub REST API.
    expect(src).not.toMatch(/fetch\s*\(\s*['"]https:\/\/api\.github\.com/);
    expect(src).not.toMatch(/github\.com\/repos\/.+\/issues['"].*method:\s*['"]POST['"]/);
  });

  // ── B-8: Uses window.open or anchor href for the handoff (not fetch) ─────────

  it('admin.feedback.js uses window.open or sets an <a> href to hand off to GitHub', () => {
    const src = readFeedbackJs();
    const usesWindowOpen = /window\.open\s*\(/.test(src);
    const setsHref = /\.href\s*=/.test(src);
    const setsTarget = /target\s*=\s*['"]_blank['"]/.test(src);
    expect(
      usesWindowOpen || setsHref || setsTarget,
      'admin.feedback.js must use window.open or set an href to open the GitHub issue URL',
    ).toBe(true);
  });

  it('admin.feedback.js does not inject showTableMessage content with innerHTML', () => {
    const src = readFeedbackJs();
    expect(src).toContain('message.textContent = String(msg || \'\')');
    expect(src).not.toContain('container.innerHTML = `<div class="feedback-empty">${msg}</div>`');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Block C — Dashboard CRUD API integration (HTTP round-trip tests)
// All RED: the /api/admin/feedback routes are not mounted yet.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Dashboard Feedback Tab — CRUD API (/api/admin/feedback)', () => {
  let server: DashboardServer | null = null;
  let baseUrl = '';

  // Minimal feedback entry payload for create tests
  const validEntry = {
    type: 'bug-report',
    severity: 'medium',
    title: 'Tank RED test entry',
    description: 'Proves the CRUD endpoint is missing',
  };

  /** Low-level HTTP helper that avoids relying on global fetch */
  function httpRequest(
    method: string,
    url: string,
    body?: unknown,
  ): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const options: http.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port ? Number(parsedUrl.port) : 80,
        path: parsedUrl.pathname + parsedUrl.search,
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
      };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data });
        });
      });
      req.on('error', reject);
      req.setTimeout(30000, () => req.destroy(new Error('request timeout')));
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  beforeAll(async () => {
    try {
      server = createDashboardServer({ port: 0, host: '127.0.0.1', maxPortTries: 5 });
      const info = await server.start();
      baseUrl = info.url.replace(/\/$/, '');
    } catch (e) {
      console.warn('[FeedbackCrudRed] Dashboard server failed to start:', (e as Error).message);
    }
  }, 15_000);

  afterAll(async () => {
    if (server) {
      try { await server.stop(); } catch { /* ok */ }
    }
  });

  // ── C-1: GET /api/admin/feedback — list all entries ───────────────────────────

  it('GET /api/admin/feedback returns 200 with an entries array', async () => {
    if (!server) return;
    const resp = await httpRequest('GET', `${baseUrl}/api/admin/feedback`);
    expect(
      resp.status,
      `Expected 200 from GET /api/admin/feedback, got ${resp.status}. Route not mounted.`,
    ).toBe(200);
    const data = JSON.parse(resp.body) as Record<string, unknown>;
    expect(
      Array.isArray(data.entries),
      'Response must have an "entries" array',
    ).toBe(true);
  });

  // ── C-2: POST /api/admin/feedback — create a new entry ───────────────────────

  it('POST /api/admin/feedback with valid body returns 201 and the new entry', async () => {
    if (!server) return;
    const resp = await httpRequest('POST', `${baseUrl}/api/admin/feedback`, validEntry);
    expect(
      resp.status,
      `Expected 201 from POST /api/admin/feedback, got ${resp.status}. Route not mounted.`,
    ).toBe(201);
    const data = JSON.parse(resp.body) as Record<string, unknown>;
    expect(
      typeof data.id === 'string',
      'Created entry must have an "id" field',
    ).toBe(true);
    expect(data.title).toBe(validEntry.title);
    expect(data.status).toBe('new');
  });

  // ── C-3: GET /api/admin/feedback/:id — get single entry ──────────────────────

  it('GET /api/admin/feedback/:id returns 200 with the matching entry', async () => {
    if (!server) return;
    // Create an entry first so we have a real id to fetch
    const createResp = await httpRequest('POST', `${baseUrl}/api/admin/feedback`, validEntry);
    if (createResp.status !== 201) {
      // Route missing — still expose the failure for the GET assertion
      const getResp = await httpRequest('GET', `${baseUrl}/api/admin/feedback/nonexistent-id`);
      expect(
        getResp.status,
        `Expected 200 from GET /api/admin/feedback/:id, got ${getResp.status}.`,
      ).toBe(200);
      return;
    }
    const created = JSON.parse(createResp.body) as { id: string };
    const getResp = await httpRequest('GET', `${baseUrl}/api/admin/feedback/${created.id}`);
    expect(getResp.status, `Expected 200 for GET /api/admin/feedback/${created.id}`).toBe(200);
    const entry = JSON.parse(getResp.body) as Record<string, unknown>;
    expect(entry.id).toBe(created.id);
  });

  // ── C-4: PATCH /api/admin/feedback/:id — update status ────────────────────────

  it('PATCH /api/admin/feedback/:id with { status: "acknowledged" } returns 200', async () => {
    if (!server) return;
    const createResp = await httpRequest('POST', `${baseUrl}/api/admin/feedback`, validEntry);
    if (createResp.status !== 201) {
      // Prove the PATCH route is also missing
      const patchResp = await httpRequest('PATCH', `${baseUrl}/api/admin/feedback/nonexistent`, { status: 'acknowledged' });
      expect(
        patchResp.status,
        `Expected 200 from PATCH /api/admin/feedback/:id, got ${patchResp.status}.`,
      ).toBe(200);
      return;
    }
    const created = JSON.parse(createResp.body) as { id: string };
    const patchResp = await httpRequest('PATCH', `${baseUrl}/api/admin/feedback/${created.id}`, { status: 'acknowledged' });
    expect(patchResp.status, 'PATCH must return 200').toBe(200);
    const updated = JSON.parse(patchResp.body) as Record<string, unknown>;
    expect(updated.status).toBe('acknowledged');
  });

  it('PATCH /api/admin/feedback/:id with invalid severity returns 400', async () => {
    if (!server) return;
    const createResp = await httpRequest('POST', `${baseUrl}/api/admin/feedback`, validEntry);
    expect(createResp.status).toBe(201);
    const created = JSON.parse(createResp.body) as { id: string };
    const patchResp = await httpRequest('PATCH', `${baseUrl}/api/admin/feedback/${created.id}`, { severity: 'urgent' });
    expect(patchResp.status).toBe(400);
    expect(patchResp.body).toContain('Invalid severity');
  });

  // ── C-5: DELETE /api/admin/feedback/:id — remove entry ────────────────────────

  it('DELETE /api/admin/feedback/:id returns 200 or 204', async () => {
    if (!server) return;
    const createResp = await httpRequest('POST', `${baseUrl}/api/admin/feedback`, validEntry);
    if (createResp.status !== 201) {
      // Prove the DELETE route is missing
      const delResp = await httpRequest('DELETE', `${baseUrl}/api/admin/feedback/nonexistent`);
      expect(
        [200, 204].includes(delResp.status),
        `Expected 200 or 204 from DELETE /api/admin/feedback/:id, got ${delResp.status}.`,
      ).toBe(true);
      return;
    }
    const created = JSON.parse(createResp.body) as { id: string };
    const delResp = await httpRequest('DELETE', `${baseUrl}/api/admin/feedback/${created.id}`);
    expect(
      [200, 204].includes(delResp.status),
      `DELETE must return 200 or 204; got ${delResp.status}`,
    ).toBe(true);
  });

  // ── C-6: Response shape uses FeedbackEntry fields, NOT webhook/connector fields ─

  it('GET /api/admin/feedback response does NOT contain webhook or connector primitives', async () => {
    if (!server) return;
    const resp = await httpRequest('GET', `${baseUrl}/api/admin/feedback`);
    if (resp.status === 404) {
      // Route absent — fail with a clear message
      expect(
        resp.status,
        'GET /api/admin/feedback returned 404: feedback CRUD route not mounted. ' +
        'This must NOT share the api.feedback.routes.ts webhook surface.',
      ).toBe(200);
      return;
    }
    const data = JSON.parse(resp.body) as Record<string, unknown>;
    // Webhook surface keys must be absent
    expect(data).not.toHaveProperty('webhooks');
    expect(data).not.toHaveProperty('connectors');
    expect(data).not.toHaveProperty('webhookCount');
    expect(data).not.toHaveProperty('connectorCount');
  });

  // ── C-7: Each entry returned by GET list conforms to FeedbackEntry schema ─────

  it('GET /api/admin/feedback entries conform to the FeedbackEntry schema (id, type, severity, title, status)', async () => {
    if (!server) return;
    // First create an entry to ensure there is at least one
    await httpRequest('POST', `${baseUrl}/api/admin/feedback`, validEntry);
    const resp = await httpRequest('GET', `${baseUrl}/api/admin/feedback`);
    if (resp.status !== 200) {
      expect(resp.status, 'GET /api/admin/feedback must return 200 before schema can be verified').toBe(200);
      return;
    }
    const data = JSON.parse(resp.body) as { entries: Record<string, unknown>[] };
    expect(data.entries.length).toBeGreaterThan(0);
    for (const entry of data.entries) {
      expect(typeof entry.id).toBe('string');
      expect(typeof entry.type).toBe('string');
      expect(typeof entry.severity).toBe('string');
      expect(typeof entry.title).toBe('string');
      expect(typeof entry.status).toBe('string');
    }
  });

  // ── C-8: POST with missing required fields returns 400 ─────────────────────────

  it('POST /api/admin/feedback with missing title returns 400', async () => {
    if (!server) return;
    const resp = await httpRequest('POST', `${baseUrl}/api/admin/feedback`, {
      type: 'bug-report',
      severity: 'low',
      // title deliberately omitted
    });
    expect(
      resp.status,
      `Expected 400 for POST /api/admin/feedback without title, got ${resp.status}.`,
    ).toBe(400);
  });

  it('POST /api/admin/feedback caps title/description length and sanitizes tags', async () => {
    if (!server) return;
    const resp = await httpRequest('POST', `${baseUrl}/api/admin/feedback`, {
      type: 'bug-report',
      severity: 'low',
      title: 'T'.repeat(250),
      description: 'D'.repeat(10_500),
      tags: ['alpha', 7, ' beta ', '', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa'],
    });
    expect(resp.status).toBe(201);
    const data = JSON.parse(resp.body) as { title: string; description: string; tags?: string[] };
    expect(data.title).toHaveLength(200);
    expect(data.description).toHaveLength(10_000);
    expect(data.tags).toEqual(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa']);
  });

  // ── C-9: GET /api/admin/feedback/:id for unknown id returns 404 ───────────────

  it('GET /api/admin/feedback/nonexistent-id returns 404', async () => {
    if (!server) return;
    const resp = await httpRequest('GET', `${baseUrl}/api/admin/feedback/00000000000000000000`);
    expect(
      resp.status,
      `Expected 404 for unknown feedback id, got ${resp.status}.`,
    ).toBe(404);
  });
});
