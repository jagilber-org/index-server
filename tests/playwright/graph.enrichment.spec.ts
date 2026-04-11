import { test, expect } from '@playwright/test';

// Tag: @baseline (structural validation only, no snapshots) ensures this runs during drift checks
test.describe('Graph Enrichment Toggle @baseline', () => {
  test('graph enrichment toggle updates schema version meta line', async ({ page }) => {
    await page.goto('/admin');
    await page.click("button:has-text('Graph')");

    // Wait for initial load (schema v1 or v2 allowed depending on timing of enrich flag)
    await page.waitForFunction(() => {
      const meta = document.getElementById('graph-meta');
      return !!meta && /schema=v[12]/.test(meta.textContent || '');
    }, { timeout: 15000 });
    const metaInitial = await page.locator('#graph-meta').innerText();
    expect(metaInitial).toMatch(/schema=v[12]/);

    // Disable enrichment + categories (drive back to v1) then refresh
    const enrichToggle = page.locator('#graph-enrich');
    if (await enrichToggle.isChecked()) await enrichToggle.click();
    const categoriesToggle = page.locator('#graph-categories');
    if (await categoriesToggle.isChecked()) await categoriesToggle.click();
    await page.click('#graph-section button:has-text("Refresh")');

    await page.waitForFunction(() => {
      const meta = document.getElementById('graph-meta');
      return !!meta && /schema=v1/.test(meta.textContent || '');
    }, { timeout: 15000 });

    const metaAfter = await page.locator('#graph-meta').innerText();
    expect(metaAfter).toMatch(/schema=v1/);

  // Re-enable enrichment & categories to ensure it flips back to v2
  await enrichToggle.click();
  await categoriesToggle.click();
    await page.click('#graph-section button:has-text("Refresh")');
    await page.waitForFunction(() => {
      const meta = document.getElementById('graph-meta');
      return !!meta && /schema=v2/.test(meta.textContent || '');
    }, { timeout: 15000 });
    const metaFinal = await page.locator('#graph-meta').innerText();
    expect(metaFinal).toMatch(/schema=v2/);
  });
});
