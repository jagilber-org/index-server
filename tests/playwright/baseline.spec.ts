import { test, expect } from '@playwright/test';
import os from 'node:os';

// Utility to get numeric env with fallback
function envNum(name: string, def: number): number {
  const v = process.env[name];
  if (!v) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

const MAX_DIFF_RATIO = envNum('DRIFT_MAX_DIFF_RATIO', 0.002); // 0.2%
const MAX_DIFF_PIXELS = envNum('DRIFT_MAX_DIFF_PIXELS', 250);

import type { Page } from '@playwright/test';

async function gotoAdmin(page: Page){
  const start = Date.now();
  let lastErr: unknown;
  while(Date.now()-start < 8000){
    try {
      await page.goto('/admin');
      // Basic sanity: expect some root element
      if(await page.locator('body').count()) return;
    } catch(e){ lastErr = e; }
    await page.waitForTimeout(300);
  }
  throw lastErr || new Error('Failed to load /admin after retries');
}
// (platform captured via os.platform() inside snap())

function snap(region: string, browserName: string) {
  const platform = os.platform();
  // Normalize (defensive) – if region already contains browser/platform suffix avoid duplication
  const base = `${region}-${browserName}-${platform}`;
  return base.replace(/(-chromium|-firefox|-webkit)?-(win32|darwin|linux)(?:-\1-(?:win32|darwin|linux))?/, `$1-$2`) + '.png';
}

// Tag: @baseline - used for drift detection runs
// Provides structural checks plus snapshot capture for key UI regions.
// Assumes dashboard already running at configured baseURL.

test.describe('Admin Dashboard Baseline @baseline', () => {
  test('loads admin page and navigates to instructions section', async ({ page }) => {
    await page.goto('/admin');
    await gotoAdmin(page);

    // Overview (default) should show system health (use more specific selector to avoid strict mode violation)
    await expect(page.locator('.admin-card .card-title:has-text("System Health")')).toBeVisible();
    await expect(page.locator('#system-health')).toBeVisible();

    // Switch to instructions section via stable data attribute on nav button
    await page.click('.nav-btn[data-section="instructions"]');
    await page.waitForSelector('#instructions-list', { timeout: 15000 });
    // Poll for rows (class name changed from legacy .session-item to .instruction-item)
    await page.waitForFunction(() => {
      const list = document.querySelector('#instructions-list');
      if(!list) return false;
      const hasRows = !!list.querySelector('.instruction-item');
      // Also expose debug sink presence for visibility into load stage
      const dbg = document.getElementById('admin-debug');
      if(dbg && /"stage"\s*:\s*"loadInstructions"/.test(dbg.textContent||'')){
        // If load completed but no rows, allow function to succeed to avoid hard timeout (empty Index scenario)
        return true;
      }
      return hasRows;
    }, { timeout: 15000 });
    await expect(page.locator('#instructions-list')).toBeVisible();
  });

  test('instruction list renders items (light validation)', async ({ page }) => {
    await page.goto('/admin');
    await gotoAdmin(page);
    await page.click('.nav-btn[data-section="instructions"]');
    const rows = page.locator('#instructions-list .instruction-item');
    await page.waitForFunction(() => {
      const dbg = document.getElementById('admin-debug');
      const list = document.getElementById('instructions-list');
      const hasItem = !!list && !!list.querySelector('.instruction-item');
      if (hasItem) return true;
      if (dbg && /"stage"\s*:\s*"renderInstructionList"/.test(dbg.textContent||'')) return true;
      return false;
    }, { timeout: 12000 });
    // With deterministic seeding we expect at least one instruction
    await expect(rows.first().locator('.instruction-name')).toBeVisible();
  });

  test('capture visual snapshot of system health card', async ({ page, browserName }) => {
    await gotoAdmin(page);
  const card = page.locator('#system-health');
  await expect(card).toBeVisible();
  await page.waitForTimeout(1500); // allow spark charts to populate
  // Minor pixel drift (sparks timing) acceptable; rely on snapshot update process
  const start = performance.now();
  const shot = await card.screenshot();
  const elapsed = performance.now() - start;
  test.info().annotations.push({ type: 'perf', description: `system-health-screenshot-ms=${elapsed.toFixed(1)}` });
  expect(shot).toMatchSnapshot(snap('system-health-card', browserName), {
    maxDiffPixelRatio: MAX_DIFF_RATIO,
    maxDiffPixels: MAX_DIFF_PIXELS
  });
  });

  test('capture visual snapshot of performance card (cpu+memory)', async ({ page, browserName }) => {
    await gotoAdmin(page);
    // Performance card title text assumed stable
    const perfCard = page.locator('.admin-card .card-title:has-text("Performance")');
    await perfCard.first().waitFor({ timeout: 8000 });
    // Expand root card element (ancestor with class admin-card)
    const perfRoot = perfCard.first().locator('xpath=ancestor::*[contains(@class,"admin-card")][1]');
    await expect(perfRoot).toBeVisible();
    // Allow charts to stabilize (memory & cpu sparkline sampling)
    await page.waitForTimeout(1200);
    const start = performance.now();
    const shot = await perfRoot.screenshot();
    const elapsed = performance.now() - start;
    test.info().annotations.push({ type: 'perf', description: `performance-card-screenshot-ms=${elapsed.toFixed(1)}` });
    expect(shot).toMatchSnapshot(snap('performance-card', browserName), {
      maxDiffPixelRatio: MAX_DIFF_RATIO,
      maxDiffPixels: MAX_DIFF_PIXELS
    });
  });

  test('capture visual snapshot of instruction list region', async ({ page, browserName }) => {
  await page.goto('/admin');
    await gotoAdmin(page);
  await page.click('.nav-btn[data-section="instructions"]');
  const list = page.locator('#instructions-list');
  await expect(list).toBeVisible();
    try {
      await list.locator('.instruction-item').first().waitFor({ timeout: 15000 });
    } catch {
      await page.click('#instructions-section button:has-text("Refresh")').catch(()=>{});
      // Wait again but tolerate empty (skip handled later if zero rendered)
      await page.waitForTimeout(250);
    }
    // Normalize ordering to reduce snapshot volatility (stable alphabetical by data-id or text)
    await page.evaluate(() => {
      const listEl = document.getElementById('instructions-list');
      if (!listEl) return;
  const items = Array.from(listEl.querySelectorAll('.instruction-item')) as HTMLElement[];
      items.sort((a, b) => {
        const ta = (a.getAttribute('data-id') || a.textContent || '').trim();
        const tb = (b.getAttribute('data-id') || b.textContent || '').trim();
        return ta.localeCompare(tb);
      });
      for (const it of items) listEl.appendChild(it); // re-append in sorted order
    });
    // Small delay to allow layout reflow post-normalization
    await page.waitForTimeout(50);
    const start = performance.now();
    const shot = await list.screenshot();
    const elapsed = performance.now() - start;
    test.info().annotations.push({ type: 'perf', description: `instructions-list-screenshot-ms=${elapsed.toFixed(1)}` });
  expect(shot).toMatchSnapshot(snap('instructions-list', browserName), {
      maxDiffPixelRatio: MAX_DIFF_RATIO,
      maxDiffPixels: MAX_DIFF_PIXELS
    });
  });

  test('capture visual snapshot of instruction editor panel', async ({ page, browserName }) => {
  await gotoAdmin(page);
    await page.click("button:has-text('Instructions')");
    const list = page.locator('#instructions-list');
    await expect(list).toBeVisible();
    // Open first instruction row to reveal editor (if empty, skip)
  const firstRow = list.locator('.instruction-item').first();
    await firstRow.waitFor({ timeout: 15000 });
    await firstRow.click();
    const editor = page.locator('#instruction-editor');
    await editor.waitFor({ state: 'visible', timeout: 10000 });
    const shot = await editor.screenshot();
    test.info().annotations.push({ type: 'perf', description: 'instruction-editor-screenshot' });
    expect(shot).toMatchSnapshot(snap('instruction-editor', browserName), {
      maxDiffPixelRatio: MAX_DIFF_RATIO,
      maxDiffPixels: MAX_DIFF_PIXELS
    });
  });

  test('capture visual snapshot of log tail panel (activated if available)', async ({ page, browserName }) => {
    await page.goto('/admin');
    await gotoAdmin(page);
    // Start tail
    const tailBtn = page.locator('#log-tail-btn');
    await expect(tailBtn).toBeVisible({ timeout: 4000 });
    await tailBtn.click();
    // Heuristic wait for logs to populate (tail container assumed near button)
    await page.waitForTimeout(1200);
    // Narrow region: reuse surrounding container (assume button parent card)
    const parentCard = tailBtn.locator('xpath=ancestor::*[contains(@class,"admin-card")][1]');
    const shot = await parentCard.screenshot();
    test.info().annotations.push({ type: 'perf', description: 'log-tail-screenshot' });
  expect(shot).toMatchSnapshot(snap('log-tail', browserName), {
      maxDiffPixelRatio: MAX_DIFF_RATIO,
      maxDiffPixels: MAX_DIFF_PIXELS
    });
  });

  test('capture textual snapshot of graph mermaid (raw source normalized)', async ({ page, browserName }) => {
    await page.goto('/admin');
    await gotoAdmin(page);
    await page.click("button:has-text('Graph')");
    const raw = page.locator('#graph-mermaid');
    await expect(raw).toBeVisible();
    await page.waitForFunction(() => {
      const el = document.getElementById('graph-mermaid');
      if (!el) return false;
      const txt = el.textContent || '';
      return (txt.includes('graph ') || txt.includes('flowchart ')) && !txt.includes('(loading');
    }, { timeout: 15000 });
    // Extract and normalize the mermaid source to reduce ordering volatility
    const normalized = await page.evaluate(() => {
      const el = document.getElementById('graph-mermaid');
      if (!el) return '';
      const lines = (el.textContent || '')
        .split('\n')
        .map(l => l.trim())
        .filter(l => !!l && !l.startsWith('%%'));// drop blank & comment lines
      if (!lines.length) return '';
      const header = lines[0];
      const rest = lines.slice(1);
      // Sort remaining lines so node/edge ordering becomes deterministic
      rest.sort((a, b) => a.localeCompare(b));
      return [header, ...rest].join('\n');
    });
    test.info().annotations.push({ type: 'perf', description: 'graph-mermaid-raw-text-snapshot' });
    // Use a textual snapshot (adds .txt) rather than visual PNG
  const platform = os.platform();
  expect(normalized).toMatchSnapshot(`graph-mermaid-raw-${browserName}-${platform}.txt`);
  });

  test('capture visual snapshot of graph mermaid (rendered diagram, best-effort)', async ({ page, browserName }) => {
    await page.goto('/admin');
    await page.click("button:has-text('Graph')");
    // Wait for initial raw load
    await page.waitForFunction(() => {
      const el = document.getElementById('graph-mermaid');
      if (!el) return false;
      const txt = el.textContent || '';
  return (txt.includes('graph ') || txt.includes('flowchart ')) && !txt.includes('(loading');
    }, { timeout: 15000 });
    // Attempt to wait for rendered SVG (external mermaid script). If not present, skip to avoid flake.
    await page.waitForFunction(() => {
      const rendered = document.getElementById('graph-mermaid-rendered');
      const svgHost = document.querySelector('#graph-mermaid-svg svg');
      return !!rendered && rendered.style.display !== 'none' && !!svgHost;
    }, { timeout: 15000 });
    const renderedWrapper = page.locator('#graph-mermaid-rendered');
    await expect(renderedWrapper).toBeVisible();
    const shot = await renderedWrapper.screenshot();
    test.info().annotations.push({ type: 'perf', description: 'graph-mermaid-rendered-screenshot' });
    expect(shot).toMatchSnapshot(snap('graph-mermaid-rendered', browserName), {
      maxDiffPixelRatio: MAX_DIFF_RATIO,
      maxDiffPixels: MAX_DIFF_PIXELS
    });
  });
});
