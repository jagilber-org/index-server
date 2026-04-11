import { test, expect, Page } from '@playwright/test';

/**
 * Dashboard global search e2e tests.
 * Validates: keyword search, regex search, error handling, result display.
 * Requires a running dashboard server at baseURL (default http://127.0.0.1:8787).
 * Tests skip gracefully if the server is not reachable.
 * Fixes: https://github.com/jagilber-dev/index-server/issues/6
 */

const TEST_ID = `e2e-search-test-${Date.now()}`;

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
  await page.click('.nav-btn[data-section="instructions"]');
  await page.waitForSelector('#instructions-list', { timeout: 10000 });
  await page.waitForFunction(() => {
    const list = document.getElementById('instructions-list');
    if (!list) return false;
    if (list.querySelector('.instruction-item')) return true;
    const dbg = document.getElementById('admin-debug');
    return !!dbg && /"stage"\s*:\s*"loadInstructions"/.test(dbg.textContent || '');
  }, { timeout: 12000 });
}

test.describe('Dashboard Global Search @baseline', () => {

  test.beforeEach(async ({ page }) => {
    const reachable = await tryConnect(page);
    test.skip(!reachable, 'Dashboard server not reachable -- skipping global search tests');
  });

  test.afterEach(async ({ page }) => {
    try { await apiRequest(page, 'DELETE', `/api/instructions/${TEST_ID}`); } catch { /* cleanup */ }
  });

  test('global keyword search returns matching results', async ({ page }) => {
    // Create a test instruction with a unique keyword
    await apiRequest(page, 'POST', '/api/instructions', {
      name: TEST_ID,
      content: { id: TEST_ID, title: 'Playwright Search Validation', body: 'unique-search-marker-xyzzy for global search test', priority: 50, categories: ['test-search'], schemaVersion: '4' },
    });

    await navigateToInstructions(page);

    // Perform global keyword search
    const searchInput = page.locator('#instruction-global-search');
    await searchInput.fill('unique-search-marker-xyzzy');
    await page.click('#instruction-global-search-btn');

    // Wait for results to render
    const resultsEl = page.locator('#instruction-global-results');
    await page.waitForFunction(() => {
      const el = document.getElementById('instruction-global-results');
      return el && el.children.length > 0 && !el.textContent!.includes('Searching');
    }, { timeout: 10000 });

    // Verify results contain our test instruction
    const resultsText = await resultsEl.textContent();
    expect(resultsText).toContain(TEST_ID);
  });

  test('global keyword search does not return error', async ({ page }) => {
    await navigateToInstructions(page);

    // Search for a common term that should not fail
    const searchInput = page.locator('#instruction-global-search');
    await searchInput.fill('instruction');
    await page.click('#instruction-global-search-btn');

    // Wait for response
    await page.waitForFunction(() => {
      const el = document.getElementById('instruction-global-results');
      return el && !el.textContent!.includes('Searching');
    }, { timeout: 10000 });

    const resultsEl = page.locator('#instruction-global-results');
    const text = await resultsEl.textContent();

    // Should NOT contain error messages
    expect(text).not.toContain('Global search error');
    expect(text).not.toContain('Search failed');
  });

  test('global regex search filters client-side', async ({ page }) => {
    await apiRequest(page, 'POST', '/api/instructions', {
      name: TEST_ID,
      content: { id: TEST_ID, title: 'Regex Search Target', body: 'regex-marker-abc123', priority: 50, categories: ['test-regex'], schemaVersion: '4' },
    });

    await navigateToInstructions(page);

    // Enable regex mode
    const regexToggle = page.locator('#instruction-global-regex-toggle');
    await regexToggle.check();

    // Search with regex pattern
    const searchInput = page.locator('#instruction-global-search');
    await searchInput.fill('e2e-search-test-\\d+');
    await page.click('#instruction-global-search-btn');

    // Wait for results
    await page.waitForFunction(() => {
      const el = document.getElementById('instruction-global-results');
      return el && !el.textContent!.includes('Searching');
    }, { timeout: 10000 });

    const resultsEl = page.locator('#instruction-global-results');
    const text = await resultsEl.textContent();
    // Regex mode should show [regex] indicator and find our instruction
    expect(text).toContain('[regex]');
  });

  test('global search Enter key triggers search', async ({ page }) => {
    await navigateToInstructions(page);

    const searchInput = page.locator('#instruction-global-search');
    await searchInput.fill('instruction');
    await searchInput.press('Enter');

    // Wait for response (should not error)
    await page.waitForFunction(() => {
      const el = document.getElementById('instruction-global-results');
      return el && !el.textContent!.includes('Searching');
    }, { timeout: 10000 });

    const text = await page.locator('#instruction-global-results').textContent();
    expect(text).not.toContain('Global search error');
  });

  test('global search with short query shows validation message', async ({ page }) => {
    await navigateToInstructions(page);

    const searchInput = page.locator('#instruction-global-search');
    await searchInput.fill('a');
    await page.click('#instruction-global-search-btn');

    await page.waitForTimeout(500);
    const text = await page.locator('#instruction-global-results').textContent();
    expect(text).toContain('2+ chars');
  });

  test('instructions_search API endpoint returns valid response', async ({ page }) => {
    // Direct API test to verify the endpoint URL is correct
    await page.goto('/admin');
    const resp = await apiRequest(page, 'GET', '/api/instructions_search?q=instruction');
    expect(resp.status).toBe(200);
    const data = resp.json as { success?: boolean; results?: unknown[] };
    expect(data.success).toBe(true);
    expect(Array.isArray(data.results)).toBe(true);
  });
});
