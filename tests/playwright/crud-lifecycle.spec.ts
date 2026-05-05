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
const CREATE_CONTENT = {
  id: TEST_ID,
  title: TEST_TITLE,
  body: TEST_BODY,
  priority: 37,
  audience: 'group',
  requirement: 'recommended',
  categories: ['test', 'crud-lifecycle'],
  contentType: 'instruction',
  schemaVersion: '4',
  status: 'review',
  classification: 'internal',
};
const UPDATE_CONTENT = {
  ...CREATE_CONTENT,
  body: UPDATED_BODY,
  priority: 12,
  requirement: 'mandatory',
  status: 'approved',
  classification: 'restricted',
};

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

async function expectPersistedInstruction(page: Page, id: string, expected: Record<string, unknown>) {
  const readResp = await apiRequest(page, 'GET', `/api/instructions/${id}`);
  expect(readResp.status).toBe(200);
  const readData = readResp.json as { success?: boolean; content?: Record<string, unknown> };
  expect(readData.success).toBe(true);
  expect(readData.content).toBeTruthy();
  const { categories, ...expectedScalarFields } = expected;
  expect(readData.content).toMatchObject(expectedScalarFields);
  if (Array.isArray(categories)) {
    expect(readData.content!.categories).toEqual(expect.arrayContaining(categories));
    expect(readData.content!.categories).toHaveLength(categories.length);
  }
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
    if (!/Loading/i.test(list.textContent || '')) return true;
    const dbg = document.getElementById('admin-debug');
    return !!dbg && /"stage"\s*:\s*"loadInstructions"/.test(dbg.textContent || '');
  }, { timeout: 12000 });
}

test.describe('Instruction CRUD Lifecycle @baseline', () => {
  test.describe.configure({ mode: 'serial' });

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
      content: CREATE_CONTENT,
    });
    expect(createResp.status).toBeLessThan(400);
    expect((createResp.json as { verified?: boolean }).verified).toBe(true);
    await expectPersistedInstruction(page, TEST_ID, CREATE_CONTENT);

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
      content: CREATE_CONTENT,
    });
    expect(createResp.status).toBeLessThan(400);
    expect((createResp.json as { verified?: boolean }).verified).toBe(true);

    // READ — verify persisted values via API, not just successful response
    await expectPersistedInstruction(page, TEST_ID, CREATE_CONTENT);

    // Verify in dashboard UI
    await navigateToInstructions(page);
    await waitForListLoad(page);
    const listText = await page.locator('#instructions-list').textContent();
    expect(listText).toContain(TEST_ID);

    // UPDATE — modify the instruction body
    const updateResp = await apiRequest(page, 'PUT', `/api/instructions/${TEST_ID}`, {
      content: UPDATE_CONTENT,
    });
    expect(updateResp.status).toBeLessThan(400);
    expect((updateResp.json as { verified?: boolean }).verified).toBe(true);

    // Verify update via API with exact field values, catching no-op writes/coercion
    await expectPersistedInstruction(page, TEST_ID, UPDATE_CONTENT);

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
    const createResp = await apiRequest(page, 'POST', '/api/instructions', {
      name: TEST_ID,
      content: CREATE_CONTENT,
    });
    expect(createResp.status).toBeLessThan(400);

    await navigateToInstructions(page);
    await waitForListLoad(page);

    await expect(page.locator('#instructions-list')).toBeVisible();
    await expect(page.locator('#instructions-list')).toContainText(TEST_ID);
  });

  test('reject invalid instruction via API and keep it out of the dashboard list', async ({ page }) => {
    const invalidId = `${TEST_ID}-invalid`;
    const createResp = await apiRequest(page, 'POST', '/api/instructions', {
      name: invalidId,
      content: {
        id: invalidId,
        title: 'Invalid CRUD Lifecycle Test Instruction',
        body: 'This payload should be rejected.',
        priority: 50,
        audience: 'all',
        requirement: 'optional',
        categories: ['test'],
        classification: 'secret',
      },
    });
    expect(createResp.status).toBe(400);
    const createData = createResp.json as Record<string, unknown>;
    expect(createData.error).toBe('invalid_instruction');

    const readResp = await apiRequest(page, 'GET', `/api/instructions/${invalidId}`);
    expect(readResp.status).toBe(404);

    await navigateToInstructions(page);
    await waitForListLoad(page);
    const listText = await page.locator('#instructions-list').textContent();
    expect(listText).not.toContain(invalidId);
  });

  test('reject invalid governance values instead of coercing them', async ({ page }) => {
    const invalidId = `${TEST_ID}-invalid-governance`;
    const createResp = await apiRequest(page, 'POST', '/api/instructions', {
      name: invalidId,
      content: {
        ...CREATE_CONTENT,
        id: invalidId,
        title: 'Invalid Governance CRUD Lifecycle Test Instruction',
        audience: 'agents',
        status: 'active',
      },
    });
    expect(createResp.status).toBe(400);
    const createData = createResp.json as Record<string, unknown>;
    expect(createData.error).toBe('invalid_instruction');

    const readResp = await apiRequest(page, 'GET', `/api/instructions/${invalidId}`);
    expect(readResp.status).toBe(404);
  });
});
