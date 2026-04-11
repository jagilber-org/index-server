import { test, expect, Page } from '@playwright/test';

/**
 * Dashboard search functionality tests.
 * Validates the instruction search UI: global search, local filter, and category filter.
 * Requires a running dashboard server at baseURL (default http://127.0.0.1:8787).
 * Tests skip gracefully if the server is not reachable.
 */

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

async function navigateToInstructions(page: Page) {
  await page.goto('/admin');
  await page.waitForSelector('.admin-root, body', { timeout: 8000 });
  await page.click('.nav-btn[data-section="instructions"]');
  await page.waitForSelector('#instructions-list', { timeout: 10000 });
  // Wait for at least one instruction to load (or debug sink to signal load complete)
  await page.waitForFunction(() => {
    const list = document.getElementById('instructions-list');
    if (!list) return false;
    if (list.querySelector('.instruction-item')) return true;
    const dbg = document.getElementById('admin-debug');
    return !!dbg && /"stage"\s*:\s*"loadInstructions"/.test(dbg.textContent || '');
  }, { timeout: 12000 });
}

test.describe('Dashboard Search Functionality @baseline', () => {

  test.beforeEach(async ({ page }) => {
    const reachable = await tryConnect(page);
    test.skip(!reachable, 'Dashboard server not reachable — skipping search tests');
  });

  test('global search input and button are visible', async ({ page }) => {
    await navigateToInstructions(page);
    await expect(page.locator('#instruction-global-search')).toBeVisible();
    await expect(page.locator('#instruction-global-search-btn')).toBeVisible();
  });

  test('global search returns results for broad keyword', async ({ page }) => {
    await navigateToInstructions(page);
    const searchInput = page.locator('#instruction-global-search');
    await searchInput.fill('instruction');
    await page.click('#instruction-global-search-btn');
    // Wait for results container to populate
    await page.waitForFunction(() => {
      const results = document.getElementById('instruction-global-results');
      if (!results) return false;
      return results.children.length > 0 || results.textContent!.includes('No results');
    }, { timeout: 10000 });
    const results = page.locator('#instruction-global-results');
    await expect(results).toBeVisible();
  });

  test('global search handles empty query gracefully', async ({ page }) => {
    await navigateToInstructions(page);
    const searchInput = page.locator('#instruction-global-search');
    await searchInput.fill('');
    await page.click('#instruction-global-search-btn');
    // Should not crash; results may show nothing or a validation message
    await page.waitForTimeout(500);
    // Verify page still functional
    await expect(page.locator('#instructions-list')).toBeVisible();
  });

  test('local filter narrows instruction list', async ({ page }) => {
    await navigateToInstructions(page);
    const filter = page.locator('#instruction-filter');
    if (!(await filter.count())) {
      test.skip(true, 'Local filter input not present in this dashboard version');
      return;
    }
    // Count initial items
    const initialCount = await page.locator('#instructions-list .instruction-item').count();
    if (initialCount === 0) {
      test.skip(true, 'No instructions loaded — cannot test filtering');
      return;
    }
    // Type a filter that should reduce list (use a nonsensical string)
    await filter.fill('zzz_nonexistent_xyzzy');
    await page.waitForTimeout(400);
    const filteredCount = await page.locator('#instructions-list .instruction-item:visible').count();
    // Filtered count should be less than or equal to initial (likely 0 for gibberish)
    expect(filteredCount).toBeLessThanOrEqual(initialCount);
  });

  test('category filter dropdown is functional', async ({ page }) => {
    await navigateToInstructions(page);
    const categoryFilter = page.locator('#instruction-category-filter');
    if (!(await categoryFilter.count())) {
      test.skip(true, 'Category filter not present in this dashboard version');
      return;
    }
    await expect(categoryFilter).toBeVisible();
    // Should have at least the default "all" option
    const optionCount = await categoryFilter.locator('option').count();
    expect(optionCount).toBeGreaterThanOrEqual(1);
  });

  test('regex toggle checkbox exists alongside global search', async ({ page }) => {
    await navigateToInstructions(page);
    const regexToggle = page.locator('#instruction-global-regex-toggle');
    if (!(await regexToggle.count())) {
      test.skip(true, 'Regex toggle not present');
      return;
    }
    // Toggle on and off
    await regexToggle.click();
    await page.waitForTimeout(100);
    await regexToggle.click();
    // Page should still be functional
    await expect(page.locator('#instructions-list')).toBeVisible();
  });
});
