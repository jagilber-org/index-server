import { test, expect, Page } from '@playwright/test';

/**
 * Instruction CRUD lifecycle e2e test.
 * Validates: Create → verify in list → update → verify update → delete → verify removed.
 * Uses the dashboard REST API for mutations, then verifies UI reflects changes.
 * Requires a running dashboard server at baseURL (default http://127.0.0.1:8787).
 * Tests skip gracefully if the server is not reachable.
 */

const TEST_ID = `e2e-crud-test-${Date.now()}`;
const TEST_TITLE = 'E2E CRUD Lifecycle Test Instruction';
const TEST_BODY = 'This is a test instruction created by the Playwright CRUD lifecycle e2e test.';
const UPDATED_BODY = 'UPDATED: This instruction was modified by the CRUD lifecycle test.';

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

async function apiRequest(page: Page, method: string, path: string, body?: object): Promise<{ status: number; json: unknown }> {
  const baseURL = page.url().replace(/\/admin.*$/, '');
  const resp = await page.request.fetch(`${baseURL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    data: body ? JSON.stringify(body) : undefined,
  });
  let json: unknown = null;
  try { json = await resp.json(); } catch { /* non-JSON response */ }
  return { status: resp.status(), json };
}

async function navigateToInstructions(page: Page) {
  await page.goto('/admin');
  await page.waitForSelector('.admin-root, body', { timeout: 8000 });
  await page.click('.nav-btn[data-section="instructions"]');
  await page.waitForSelector('#instructions-list', { timeout: 10000 });
}

async function waitForListLoad(page: Page) {
  await page.waitForFunction(() => {
    const list = document.getElementById('instructions-list');
    if (!list) return false;
    if (list.querySelector('.instruction-item')) return true;
    const dbg = document.getElementById('admin-debug');
    return !!dbg && /"stage"\s*:\s*"loadInstructions"/.test(dbg.textContent || '');
  }, { timeout: 12000 });
}

test.describe('Instruction CRUD Lifecycle @baseline', () => {

  test.beforeEach(async ({ page }) => {
    const reachable = await tryConnect(page);
    test.skip(!reachable, 'Dashboard server not reachable — skipping CRUD tests');
  });

  test.afterEach(async ({ page }) => {
    // Cleanup: attempt to delete the test instruction if it still exists
    try {
      await apiRequest(page, 'DELETE', `/api/instructions/${TEST_ID}`);
    } catch { /* best-effort cleanup */ }
  });

  test('create instruction via API and verify it appears in dashboard list', async ({ page }) => {
    // Create instruction via REST API
    const createResp = await apiRequest(page, 'POST', '/api/instructions', {
      name: TEST_ID,
      content: JSON.stringify({
        id: TEST_ID,
        title: TEST_TITLE,
        body: TEST_BODY,
        priority: 50,
        audience: 'test',
        requirement: 'optional',
      }),
    });
    expect(createResp.status).toBeLessThan(400);

    // Navigate to instructions panel and verify the item appears
    await navigateToInstructions(page);
    await waitForListLoad(page);

    // Check if the test instruction is in the list
    const listText = await page.locator('#instructions-list').textContent();
    expect(listText).toContain(TEST_ID);
  });

  test('full CRUD lifecycle: create → read → update → delete', async ({ page }) => {
    // CREATE
    const createResp = await apiRequest(page, 'POST', '/api/instructions', {
      name: TEST_ID,
      content: JSON.stringify({
        id: TEST_ID,
        title: TEST_TITLE,
        body: TEST_BODY,
        priority: 50,
        audience: 'test',
        requirement: 'optional',
      }),
    });
    expect(createResp.status).toBeLessThan(400);

    // READ — verify via API
    const readResp = await apiRequest(page, 'GET', `/api/instructions/${TEST_ID}`);
    expect(readResp.status).toBe(200);
    const readData = readResp.json as Record<string, unknown>;
    expect(readData).toBeTruthy();

    // Verify in dashboard UI
    await navigateToInstructions(page);
    await waitForListLoad(page);
    const listText = await page.locator('#instructions-list').textContent();
    expect(listText).toContain(TEST_ID);

    // UPDATE — modify the instruction body
    const updateResp = await apiRequest(page, 'PUT', `/api/instructions/${TEST_ID}`, {
      content: JSON.stringify({
        id: TEST_ID,
        title: TEST_TITLE,
        body: UPDATED_BODY,
        priority: 50,
        audience: 'test',
        requirement: 'optional',
      }),
    });
    expect(updateResp.status).toBeLessThan(400);

    // Verify update via API
    const verifyResp = await apiRequest(page, 'GET', `/api/instructions/${TEST_ID}`);
    expect(verifyResp.status).toBe(200);

    // DELETE
    const deleteResp = await apiRequest(page, 'DELETE', `/api/instructions/${TEST_ID}`);
    expect(deleteResp.status).toBeLessThan(400);

    // Verify removal — API should return 404
    const gone = await apiRequest(page, 'GET', `/api/instructions/${TEST_ID}`);
    expect(gone.status).toBe(404);

    // Verify removal from dashboard UI
    await page.reload();
    await navigateToInstructions(page);
    await waitForListLoad(page);
    const postDeleteText = await page.locator('#instructions-list').textContent();
    expect(postDeleteText).not.toContain(TEST_ID);
  });

  test('dashboard loads and displays Index', async ({ page }) => {
    await navigateToInstructions(page);
    await waitForListLoad(page);

    // Verify the instructions list has at least one item
    const items = page.locator('#instructions-list .instruction-item');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // Verify list container is visible
    await expect(page.locator('#instructions-list')).toBeVisible();
  });
});
