/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, Page } from '@playwright/test';

/**
 * Dashboard flat-view preview "Copy" e2e coverage (TS-11).
 * Validates: opening a flat-view preview renders a Copy button, clicking it puts
 * the previewed markdown body on the clipboard, the button reports the result and
 * restores its label, and closing the preview removes the button.
 *
 * `navigator.clipboard.writeText` is stubbed with a recorder rather than relying on
 * clipboard permissions, which are not grantable uniformly across chromium, firefox
 * and webkit. The stub sits at the browser boundary, so everything the dashboard
 * does to reach it is still exercised.
 *
 * Requires a running dashboard server at baseURL (default http://127.0.0.1:8787).
 * Tests skip gracefully if the server is not reachable.
 * Implements: https://github.com/jagilber-org/index-server/issues/552
 */

const TEST_ID = `e2e-copy-preview-${Date.now()}`;
const TEST_BODY = '# Copy Target\n\nThe body that the preview pane renders.';

async function tryConnect(page: Page): Promise<boolean> {
  try {
    const resp = await page.goto('/admin', { timeout: 5000 });
    if (!resp || resp.status() >= 400) return false;
    await page.waitForSelector('body', { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function apiRequest(page: Page, method: string, urlPath: string, body?: object): Promise<{ status: number }> {
  const baseURL = page.url().replace(/\/admin.*$/, '');
  const resp = await page.request.fetch(`${baseURL}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    data: body ? JSON.stringify(body) : undefined,
  });
  return { status: resp.status() };
}

/** Record clipboard writes in-page so the assertion works without OS clipboard access. */
async function stubClipboard(page: Page) {
  await page.addInitScript(() => {
    (window as any).__clipboardWrites = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => { (window as any).__clipboardWrites.push(text); },
      },
    });
  });
}

/** Open the instructions section in flat (non-tree) view with `name` filtered in. */
async function showFlatInstruction(page: Page, name: string) {
  await page.goto('/admin');
  await page.waitForSelector('.admin-root, body', { timeout: 8000 });
  await page.evaluate(() => {
    if (typeof (window as any).showSection === 'function') (window as any).showSection('instructions');
  });
  await page.click('.nav-btn[data-section="instructions"]').catch(() => {});
  await page.waitForSelector('#instructions-list', { timeout: 10000 });
  // Tree view is the default; the flat list is where #552's preview pane lives.
  await page.evaluate(() => (window as any).setInstructionViewMode?.('flat'));
  await page.locator('#instruction-filter').fill(name);
  await expect(page.locator(`.instruction-item[data-instruction="${name}"]`)).toBeVisible({ timeout: 10000 });
}

test.describe('Dashboard Flat Preview Copy @baseline', () => {

  test.beforeEach(async ({ page }) => {
    await stubClipboard(page);
    const reachable = await tryConnect(page);
    test.skip(!reachable, 'Dashboard server not reachable -- skipping preview copy tests');
    await apiRequest(page, 'POST', '/api/instructions', {
      name: TEST_ID,
      content: { id: TEST_ID, title: 'Copy Preview Test', body: TEST_BODY, priority: 50, categories: ['test'], schemaVersion: '4' },
    });
  });

  test.afterEach(async ({ page }) => {
    try { await apiRequest(page, 'DELETE', `/api/instructions/${TEST_ID}`); } catch { /* cleanup */ }
  });

  test('copy button copies the previewed markdown body and reports success', async ({ page }) => {
    await showFlatInstruction(page, TEST_ID);

    const item = page.locator(`.instruction-item[data-instruction="${TEST_ID}"]`);
    await item.locator('.action-btn:has-text("Preview")').click();

    await expect(item.locator('.flat-preview-pane')).toBeVisible({ timeout: 10000 });
    const copyBtn = item.locator('[data-flat-copy]');
    await expect(copyBtn).toBeVisible();
    await expect(copyBtn).toHaveText('📋 Copy');

    await copyBtn.click();

    // The exact body is what lands on the clipboard -- not the rendered HTML,
    // and not the JSON envelope the API returned it in.
    await expect.poll(() => page.evaluate(() => (window as any).__clipboardWrites))
      .toEqual([TEST_BODY]);
    await expect(copyBtn).toHaveText('✓ Copied');
    // Transient feedback only: the canonical label comes back on its own.
    await expect(copyBtn).toHaveText('📋 Copy', { timeout: 5000 });
  });

  test('closing the preview removes the copy button', async ({ page }) => {
    await showFlatInstruction(page, TEST_ID);

    const item = page.locator(`.instruction-item[data-instruction="${TEST_ID}"]`);
    const toggle = item.locator('.action-btn:has-text("Preview")');
    await toggle.click();
    await expect(item.locator('[data-flat-copy]')).toBeVisible({ timeout: 10000 });

    await item.locator('.action-btn:has-text("Hide")').click();

    await expect(item.locator('.flat-preview-pane')).toHaveCount(0);
    await expect(item.locator('[data-flat-copy]')).toHaveCount(0);
  });
});
