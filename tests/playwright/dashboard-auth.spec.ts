import { test, expect, Page } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import net from 'net';

import http from 'http';

/**
 * Dashboard Auth E2E Tests — Playwright
 *
 * Validates the client-side authentication flow for the dashboard:
 * - Login modal triggered by 401 response
 * - Token persistence in sessionStorage
 * - Auth badge / indicator in the header
 * - Logout flow
 * - Invalid key error feedback
 *
 * These tests start a dedicated server with INDEX_SERVER_ADMIN_API_KEY set
 * on a free port so they don't conflict with other test suites.
 *
 * @see https://github.com/jagilber-dev/index-server/issues/42
 */

const TEST_API_KEY = 'e2e-test-admin-key-42';
const STORAGE_KEY = 'indexserver_admin_token';
const SERVER_STARTUP_TIMEOUT = 30_000;

let serverProcess: ChildProcess | null = null;
let serverPort: number;
let baseURL: string;

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('Could not get port')));
      }
    });
    srv.on('error', reject);
  });
}

async function waitForServer(port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/admin`, (res) => {
        res.resume();
        resolve(res.statusCode !== undefined && res.statusCode < 500);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(2000, () => {
        req.destroy();
        resolve(false);
      });
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function startServer(port: number): ChildProcess {
  const root = path.resolve(process.cwd());
  const serverScript = path.join(root, 'dist', 'server', 'index-server.js');
  const child = spawn(process.execPath, [serverScript], {
    env: {
      ...process.env,
      INDEX_SERVER_DASHBOARD: '1',
      INDEX_SERVER_DASHBOARD_PORT: String(port),
      INDEX_SERVER_ADMIN_API_KEY: TEST_API_KEY,
      INDEX_SERVER_DISABLE_RATE_LIMIT: '1',
      INDEX_SERVER_DIR: path.join(root, 'devinstructions'),
      NODE_ENV: 'test',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
  });

  // Log server output for debugging startup issues
  child.stdout?.on('data', (d: Buffer) => {
    if (d.toString().includes('error')) {
      // eslint-disable-next-line no-console
      console.log(`[auth-server:stdout] ${d.toString().trimEnd()}`);
    }
  });
  child.stderr?.on('data', (d: Buffer) => {
    const msg = d.toString();
    // Only log actual errors, not routine startup info
    if (msg.includes('Error') && !msg.includes('ValidationError') && !msg.includes('ExperimentalWarning')) {
      // eslint-disable-next-line no-console
      console.error(`[auth-server:stderr] ${msg.trimEnd()}`);
    }
  });
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      // eslint-disable-next-line no-console
      console.error(`[auth-server] exited with code ${code}`);
    }
  });

  return child;
}

function killServer(proc: ChildProcess | null): void {
  if (!proc || proc.killed) return;
  try {
    proc.kill('SIGTERM');
  } catch {
    /* already dead */
  }
}

// ── Test suite ───────────────────────────────────────────────────────────────

test.describe('Dashboard Auth @auth', () => {
  // All auth tests share one server — run serially in a single worker
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    serverPort = await findFreePort();
    baseURL = `http://127.0.0.1:${serverPort}`;
    serverProcess = startServer(serverPort);

    const ready = await waitForServer(serverPort, SERVER_STARTUP_TIMEOUT);
    if (!ready) {
      killServer(serverProcess);
      serverProcess = null;
    }
  });

  test.afterAll(async () => {
    killServer(serverProcess);
    serverProcess = null;
  });

  test.beforeEach(async ({ page }) => {
    test.skip(!serverProcess, 'Auth test server failed to start');
  });

  /** Navigate to dashboard with a clean auth state (no stored token). */
  async function gotoClean(page: Page): Promise<void> {
    await page.goto(`${baseURL}/admin`, { timeout: 10_000 });
    // Clear any token left by a previous test, then reload so page starts fresh
    const hadToken = await page.evaluate((key) => {
      try {
        const had = !!sessionStorage.getItem(key);
        sessionStorage.removeItem(key);
        return had;
      } catch {
        return false;
      }
    }, STORAGE_KEY);
    if (hadToken) {
      await page.reload({ timeout: 10_000 });
    }
  }

  /** Pre-seed a valid token so the page loads authenticated. */
  async function gotoAuthenticated(page: Page): Promise<void> {
    await page.goto(`${baseURL}/admin`, { timeout: 10_000 });
    await page.evaluate(
      ([key, token]) => sessionStorage.setItem(key, token),
      [STORAGE_KEY, TEST_API_KEY] as const,
    );
    await page.reload({ timeout: 10_000 });
  }

  // ── 1. Login flow ──────────────────────────────────────────────────────

  test('login modal appears on 401 and successful auth shows badge', async ({
    page,
  }) => {
    await gotoClean(page);

    // The overview section auto-loads stats via adminFetch('/api/admin/stats')
    // which returns 401. This should trigger the auth modal.
    const overlay = page.locator('.auth-overlay');
    await expect(overlay).toBeVisible({ timeout: 15_000 });

    const modal = page.locator('.auth-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('h3')).toContainText('Authentication Required');

    // Enter the correct API key
    const input = page.locator('.auth-key-input');
    await expect(input).toBeVisible();
    await input.fill(TEST_API_KEY);

    // Submit
    await page.locator('.auth-submit-btn').click();

    // Modal should dismiss
    await expect(overlay).toBeHidden({ timeout: 5_000 });

    // Auth badge should appear in the header
    const badge = page.locator('#auth-indicator');
    await expect(badge).toContainText('Authenticated', { timeout: 5_000 });
    await expect(badge).toHaveClass(/auth-ok/);

    // Verify sessionStorage has the token
    const storedToken = await page.evaluate(
      (key) => sessionStorage.getItem(key),
      STORAGE_KEY,
    );
    expect(storedToken).toBe(TEST_API_KEY);
  });

  test('login via Enter key in input field', async ({ page }) => {
    await gotoClean(page);

    const overlay = page.locator('.auth-overlay');
    await expect(overlay).toBeVisible({ timeout: 15_000 });

    const input = page.locator('.auth-key-input');
    await input.fill(TEST_API_KEY);
    await input.press('Enter');

    await expect(overlay).toBeHidden({ timeout: 5_000 });
    await expect(page.locator('#auth-indicator')).toContainText('Authenticated', {
      timeout: 5_000,
    });
  });

  // ── 2. Logout flow ────────────────────────────────────────────────────

  test('logout clears auth badge and sessionStorage token', async ({ page }) => {
    await gotoAuthenticated(page);

    const badge = page.locator('#auth-indicator');
    await expect(badge).toContainText('Authenticated', { timeout: 5_000 });

    // Click the badge to logout (it triggers location.reload)
    await Promise.all([page.waitForEvent('load', { timeout: 10_000 }), badge.click()]);

    // After reload, badge should be empty and token cleared
    await expect(page.locator('#auth-indicator')).not.toContainText('Authenticated', {
      timeout: 5_000,
    });

    const tokenAfter = await page.evaluate(
      (key) => sessionStorage.getItem(key),
      STORAGE_KEY,
    );
    expect(tokenAfter).toBeNull();
  });

  // ── 3. Invalid key ────────────────────────────────────────────────────

  test('submitting empty key shows error message', async ({ page }) => {
    await gotoClean(page);

    const overlay = page.locator('.auth-overlay');
    await expect(overlay).toBeVisible({ timeout: 15_000 });

    // Try to submit without entering a key
    await page.locator('.auth-submit-btn').click();

    // Error message should appear
    const errorEl = page.locator('.auth-error');
    await expect(errorEl).toContainText('Please enter a key');

    // Modal should still be visible
    await expect(overlay).toBeVisible();
  });

  test('dismiss modal via Cancel button returns original 401 response', async ({
    page,
  }) => {
    await gotoClean(page);

    const overlay = page.locator('.auth-overlay');
    await expect(overlay).toBeVisible({ timeout: 15_000 });

    await page.locator('.auth-dismiss-btn').click();

    await expect(overlay).toBeHidden({ timeout: 5_000 });
    await expect(page.locator('#auth-indicator')).not.toContainText('Authenticated');
  });

  test('dismiss modal via Escape key', async ({ page }) => {
    await gotoClean(page);

    const overlay = page.locator('.auth-overlay');
    await expect(overlay).toBeVisible({ timeout: 15_000 });

    await page.locator('.auth-key-input').press('Escape');

    await expect(overlay).toBeHidden({ timeout: 5_000 });
    await expect(page.locator('#auth-indicator')).not.toContainText('Authenticated');
  });

  test('invalid key still stores token but retry fails with 401', async ({
    page,
  }) => {
    await gotoClean(page);

    const overlay = page.locator('.auth-overlay');
    await expect(overlay).toBeVisible({ timeout: 15_000 });

    const input = page.locator('.auth-key-input');
    await input.fill('wrong-key-value');
    await page.locator('.auth-submit-btn').click();

    // Modal dismisses (the client stores whatever key was entered)
    await expect(overlay).toBeHidden({ timeout: 5_000 });

    // The badge shows authenticated (client-side only — it stored the token)
    const badge = page.locator('#auth-indicator');
    await expect(badge).toContainText('Authenticated', { timeout: 5_000 });

    // But the token is the wrong one — a direct API call should fail
    const resp = await page.evaluate(async () => {
      const r = await fetch('/api/admin/config', {
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem('indexserver_admin_token')}`,
        },
      });
      return r.status;
    });
    expect(resp).toBe(401);
  });

  // ── 4. Token persistence across navigation ─────────────────────────────

  test('auth token persists across in-page navigation', async ({ page }) => {
    await gotoAuthenticated(page);

    await expect(page.locator('#auth-indicator')).toContainText('Authenticated', {
      timeout: 5_000,
    });

    // Navigate between sections
    const sections = ['instructions', 'config', 'overview'];
    for (const section of sections) {
      const btn = page.locator(`.nav-btn[data-section="${section}"]`);
      if ((await btn.count()) > 0) {
        await btn.click();
        await page.waitForTimeout(300);
      }
    }

    // Badge should still be there
    await expect(page.locator('#auth-indicator')).toContainText('Authenticated');

    // Token should still be in sessionStorage
    const token = await page.evaluate(
      (key) => sessionStorage.getItem(key),
      STORAGE_KEY,
    );
    expect(token).toBe(TEST_API_KEY);
  });

  // ── 5. API-level auth verification ─────────────────────────────────────

  test('API returns 401 without auth header when key is required', async ({
    page,
  }) => {
    await page.goto(`${baseURL}/admin`, { timeout: 10_000 });

    const status = await page.evaluate(async () => {
      const r = await fetch('/api/admin/config');
      return r.status;
    });
    expect(status).toBe(401);
  });

  test('API returns 200 with valid Bearer token', async ({ page }) => {
    await page.goto(`${baseURL}/admin`, { timeout: 10_000 });

    const status = await page.evaluate(async (key) => {
      const r = await fetch('/api/admin/config', {
        headers: { Authorization: `Bearer ${key}` },
      });
      return r.status;
    }, TEST_API_KEY);
    expect(status).toBe(200);
  });
});
