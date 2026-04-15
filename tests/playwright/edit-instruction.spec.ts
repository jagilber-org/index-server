/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, Page } from '@playwright/test';

/**
 * Dashboard instruction editing e2e tests.
 * Validates: open editor, modify content, save, verify persistence.
 * Requires a running dashboard server at baseURL (default http://127.0.0.1:8787).
 * Tests skip gracefully if the server is not reachable.
 * Fixes: https://github.com/jagilber-dev/index-server/issues/5
 */

const TEST_ID = `e2e-edit-test-${Date.now()}`;

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

async function apiRequest(page: Page, method: string, urlPath: string, body?: object): Promise<{ status: number; json: unknown }> {
  const baseURL = page.url().replace(/\/admin.*$/, '');
  const resp = await page.request.fetch(`${baseURL}${urlPath}`, {
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
  // Use evaluate to call showSection directly -- avoids dependency on the
  // inline onclick handler dispatch (which is the subject of other tests).
  await page.evaluate(() => {
    if (typeof (window as any).showSection === 'function') {
      (window as any).showSection('instructions');
    }
  });
  // Fallback: also click the nav button in case evaluate didn't work
  await page.click('.nav-btn[data-section="instructions"]').catch(() => {});
  await page.waitForSelector('#instructions-list', { timeout: 10000 });
  await page.waitForFunction(() => {
    const list = document.getElementById('instructions-list');
    if (!list) return false;
    if (list.querySelector('.instruction-item')) return true;
    const dbg = document.getElementById('admin-debug');
    return !!dbg && /"stage"\s*:\s*"loadInstructions"/.test(dbg.textContent || '');
  }, { timeout: 12000 });
}

test.describe('Dashboard Instruction Editing @baseline', () => {

  test.beforeEach(async ({ page }) => {
    const reachable = await tryConnect(page);
    test.skip(!reachable, 'Dashboard server not reachable -- skipping edit tests');
  });

  test('edit button onclick passes instruction name, not Event object', async ({ page }) => {
    // Regression test: safeExecInlineCode must forward the original string
    // argument from onclick="editInstruction('name')" instead of the click Event.
    await apiRequest(page, 'POST', '/api/instructions', {
      name: TEST_ID,
      content: { id: TEST_ID, title: 'Onclick Arg Test', body: 'body', priority: 50, categories: ['test'], schemaVersion: '4' },
    });

    await navigateToInstructions(page);

    // Filter to find our test instruction (it may be off the first page)
    const filter = page.locator('#instruction-filter');
    await filter.fill(TEST_ID);
    await page.waitForTimeout(500);

    // Intercept editInstruction to capture the argument it receives
    await page.evaluate(() => {
      (window as any).__editCallArgs = null;
      const orig = (window as any).editInstruction;
      (window as any).editInstruction = function (...args: unknown[]) {
        (window as any).__editCallArgs = args.map((a: unknown) =>
          a && typeof a === 'object' && 'isTrusted' in (a as any) ? 'EVENT_OBJECT' : a
        );
        return orig.apply(this, args);
      };
    });

    // Click the Edit button via the DOM (not programmatically calling editInstruction)
    const editBtn = page.locator(`.instruction-item[data-instruction="${TEST_ID}"] .action-btn:has-text("Edit")`);
    await expect(editBtn).toBeVisible({ timeout: 5000 });
    await editBtn.click();

    // Retrieve what editInstruction was actually called with
    const callArgs = await page.evaluate(() => (window as any).__editCallArgs);
    expect(callArgs).toBeTruthy();
    expect(callArgs[0]).toBe(TEST_ID); // Must be the name string, NOT 'EVENT_OBJECT'
    expect(callArgs[0]).not.toBe('EVENT_OBJECT');

    // Also verify the editor loaded successfully
    await expect(page.locator('#instruction-editor')).toBeVisible({ timeout: 5000 });
    const content = await page.locator('#instruction-content').inputValue();
    expect(content).toContain('Onclick Arg Test');
  });

  test('delete button onclick passes instruction name correctly', async ({ page }) => {
    // Same regression class: deleteInstruction must receive the name string
    const delId = `${TEST_ID}-del`;
    await apiRequest(page, 'POST', '/api/instructions', {
      name: delId,
      content: { id: delId, title: 'Delete Arg Test', body: 'body', priority: 50, categories: ['test'], schemaVersion: '4' },
    });

    await navigateToInstructions(page);

    // Filter to find our test instruction
    const filter = page.locator('#instruction-filter');
    await filter.fill(delId);
    await page.waitForTimeout(500);

    // Handle confirm dialog before clicking
    page.on('dialog', dialog => dialog.accept());

    // Intercept deleteInstruction
    await page.evaluate(() => {
      (window as any).__deleteCallArgs = null;
      const origDel = (window as any).deleteInstruction;
      (window as any).deleteInstruction = function (...args: unknown[]) {
        (window as any).__deleteCallArgs = args.map((a: unknown) =>
          a && typeof a === 'object' && 'isTrusted' in (a as any) ? 'EVENT_OBJECT' : a
        );
        // Don't actually delete -- just capture the args
        void origDel;
      };
    });

    const deleteBtn = page.locator(`.instruction-item[data-instruction="${delId}"] .action-btn:has-text("Delete")`);
    await expect(deleteBtn).toBeVisible({ timeout: 5000 });
    await deleteBtn.click();

    const callArgs = await page.evaluate(() => (window as any).__deleteCallArgs);
    expect(callArgs).toBeTruthy();
    expect(callArgs[0]).toBe(delId);
    expect(callArgs[0]).not.toBe('EVENT_OBJECT');

    // Cleanup
    try { await apiRequest(page, 'DELETE', `/api/instructions/${delId}`); } catch { /* ok */ }
  });

  test.afterEach(async ({ page }) => {
    try { await apiRequest(page, 'DELETE', `/api/instructions/${TEST_ID}`); } catch { /* cleanup */ }
  });

  test('edit button opens editor with instruction content', async ({ page }) => {
    // Create test instruction via API
    await apiRequest(page, 'POST', '/api/instructions', {
      name: TEST_ID,
      content: { id: TEST_ID, title: 'Edit Test', body: 'Original body', priority: 50, categories: ['test'], schemaVersion: '4' },
    });

    await navigateToInstructions(page);

    // Filter to find our test instruction (pagination hides it otherwise)
    const filter = page.locator('#instruction-filter');
    await filter.fill(TEST_ID);
    await page.waitForTimeout(500);

    // Find and click the edit button for our test instruction
    const editBtn = page.locator(`.instruction-item[data-instruction="${TEST_ID}"] .action-btn:has-text("Edit")`);
    await expect(editBtn).toBeVisible({ timeout: 5000 });
    await editBtn.click();

    // Verify editor is visible
    const editor = page.locator('#instruction-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });

    // Verify content textarea has content
    const textarea = page.locator('#instruction-content');
    await expect(textarea).toBeVisible();
    const content = await textarea.inputValue();
    expect(content.length).toBeGreaterThan(10);
    expect(content).toContain('Edit Test');

    // Verify filename field is populated and disabled (editing mode)
    const filenameInput = page.locator('#instruction-filename');
    await expect(filenameInput).toBeVisible();
    await expect(filenameInput).toBeDisabled();
  });

  test('save instruction persists changes via PUT', async ({ page }) => {
    // Create test instruction via API
    await apiRequest(page, 'POST', '/api/instructions', {
      name: TEST_ID,
      content: { id: TEST_ID, title: 'Edit Test', body: 'Original body', priority: 50, categories: ['test'], schemaVersion: '4' },
    });

    await navigateToInstructions(page);

    // Filter to find our test instruction
    const filter = page.locator('#instruction-filter');
    await filter.fill(TEST_ID);
    await page.waitForTimeout(500);

    // Click edit on our instruction
    const editBtn = page.locator(`.instruction-item[data-instruction="${TEST_ID}"] .action-btn:has-text("Edit")`);
    await expect(editBtn).toBeVisible({ timeout: 5000 });
    await editBtn.click();
    await expect(page.locator('#instruction-editor')).toBeVisible({ timeout: 5000 });

    // Modify the content
    const textarea = page.locator('#instruction-content');
    const originalContent = await textarea.inputValue();
    const parsed = JSON.parse(originalContent);
    parsed.body = 'Updated body from Playwright test';
    await textarea.fill(JSON.stringify(parsed, null, 2));

    // Click save
    await page.click('#instruction-save-btn');

    // Wait for success feedback (the editor stays open, list refreshes)
    await page.waitForTimeout(1000);

    // Verify via API that the change persisted
    const readResp = await apiRequest(page, 'GET', `/api/instructions/${TEST_ID}`);
    expect(readResp.status).toBe(200);
    const data = readResp.json as { content?: { body?: string } };
    expect(data.content?.body).toBe('Updated body from Playwright test');
  });

  test('editor diagnostics update on input', async ({ page }) => {
    await apiRequest(page, 'POST', '/api/instructions', {
      name: TEST_ID,
      content: { id: TEST_ID, title: 'Diag Test', body: 'Test body', priority: 50, categories: ['test'], schemaVersion: '4' },
    });

    await navigateToInstructions(page);

    // Filter to find our test instruction
    const filter = page.locator('#instruction-filter');
    await filter.fill(TEST_ID);
    await page.waitForTimeout(500);

    const editBtn = page.locator(`.instruction-item[data-instruction="${TEST_ID}"] .action-btn:has-text("Edit")`);
    await expect(editBtn).toBeVisible({ timeout: 5000 });
    await editBtn.click();
    await expect(page.locator('#instruction-editor')).toBeVisible({ timeout: 5000 });

    // Check diagnostics element shows schema info
    const diag = page.locator('#instruction-diagnostics');
    await expect(diag).toBeVisible();
    const diagText = await diag.textContent();
    expect(diagText).toContain('Schema');

    // Type invalid JSON and check diagnostics show error
    const textarea = page.locator('#instruction-content');
    await textarea.fill('{ invalid json }');
    await page.waitForTimeout(300);
    const diagAfter = await diag.textContent();
    expect(diagAfter).toContain('Invalid JSON');
  });

  test('cancel edit hides the editor', async ({ page }) => {
    await apiRequest(page, 'POST', '/api/instructions', {
      name: TEST_ID,
      content: { id: TEST_ID, title: 'Cancel Test', body: 'Test', priority: 50, categories: ['test'], schemaVersion: '4' },
    });

    await navigateToInstructions(page);

    // Filter to find our test instruction
    const filter = page.locator('#instruction-filter');
    await filter.fill(TEST_ID);
    await page.waitForTimeout(500);

    const editBtn = page.locator(`.instruction-item[data-instruction="${TEST_ID}"] .action-btn:has-text("Edit")`);
    await expect(editBtn).toBeVisible({ timeout: 5000 });
    await editBtn.click();
    await expect(page.locator('#instruction-editor')).toBeVisible({ timeout: 5000 });

    // Click cancel
    await page.click('#instruction-cancel-btn');
    await expect(page.locator('#instruction-editor')).toBeHidden({ timeout: 3000 });
  });
});
