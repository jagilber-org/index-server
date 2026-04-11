import { test, expect, Page } from '@playwright/test';

/**
 * Comprehensive dashboard controls baseline covering navigation buttons, refresh actions,
 * toggle switches, log tail controls, graph feature toggles, and performance/monitor sections.
 * All tests tagged @baseline so they participate in drift runs.
 */

test.describe('Dashboard Control Functionality @baseline', () => {
  async function goto(page: Page) {
    await page.goto('/admin');
    await page.waitForSelector('.admin-root, body');
  }

  test('navigation buttons render and switch sections', async ({ page }) => {
    await goto(page);
    // Use data-section attributes for stability (emojis / text may vary)
    const sections = ['overview','instructions','graph','monitoring','config'];
    for (const sec of sections) {
      await expect(page.locator(`.nav-btn[data-section="${sec}"]`)).toBeVisible();
    }
    for (const sec of ['instructions','graph','overview']) {
      await page.click(`.nav-btn[data-section="${sec}"]`);
      await page.waitForTimeout(120);
    }
  });

  test('instructions section refresh & editor open', async ({ page }) => {
    await goto(page);
    await page.click('.nav-btn[data-section="instructions"]');
    await page.waitForSelector('#instructions-list');
    // Optional refresh button
    const refresh = page.locator('#instructions-section button:has-text("Refresh")');
    if (await refresh.count()) {
      await refresh.click();
      await page.waitForTimeout(200);
    }
    const first = page.locator('#instructions-list .instruction-item').first();
    await first.waitFor({ timeout: 5000 });
    await first.click();
    await expect(page.locator('#instruction-editor')).toBeVisible({ timeout: 5000 });
  });

  test('log tail start/stop cycle', async ({ page }) => {
    await goto(page);
    const btn = page.locator('#log-tail-btn');
    await expect(btn).toBeVisible({ timeout: 4000 });
    await btn.click();
    await page.waitForTimeout(300);
    if (await btn.isVisible()) await btn.click();
  });

  test('graph toggles enrichment/categories/usage', async ({ page }) => {
    await goto(page);
  await page.click('.nav-btn[data-section="graph"]');
    await page.waitForSelector('#graph-mermaid');
    const toggles = ['#graph-enrich', '#graph-categories', '#graph-usage'];
    for (const sel of toggles) {
      const el = page.locator(sel);
      if (await el.count()) {
        const initChecked = await el.isChecked().catch(()=>false);
        await el.click();
        await page.waitForTimeout(100);
        // revert to original state for baseline determinism
        if (initChecked !== undefined) {
          await el.click();
        }
      }
    }
  });

  test('performance and monitor cards visible', async ({ page }) => {
    await goto(page);
    await expect(page.locator('#system-health')).toBeVisible();
    const perfCard = page.locator('.admin-card .card-title:has-text("Performance")');
    await perfCard.first().waitFor({ timeout: 4000 });
    await expect(perfCard.first()).toBeVisible();
  });
});
