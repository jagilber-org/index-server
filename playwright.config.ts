import { defineConfig, devices } from '@playwright/test';

/**
 * Comprehensive Playwright configuration for UI drift + visual regression detection.
 * Features:
 *  - Multi-browser projects (chromium, firefox, webkit) with env filtering (DRIFT_BROWSERS=chromium,firefox)
 *  - Retry & artifact tuning for CI (traces/videos on first retry only)
 *  - Configurable snapshot diff tolerances via env (DRIFT_MAX_DIFF_RATIO / DRIFT_MAX_DIFF_PIXELS)
 *  - HTML + list reporters (CI) and local list for fast feedback
 *  - Metadata embedding for downstream drift manifest generation
 */

const DASHBOARD_PORT = process.env.DASHBOARD_PORT || '8787';
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${DASHBOARD_PORT}`;

// Allow dynamic filtering of browser projects (e.g. DRIFT_BROWSERS=chromium,firefox)
const allProjects = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  { name: 'webkit', use: { ...devices['Desktop Safari'] } }
];
let projects = allProjects;
if (process.env.DRIFT_BROWSERS) {
  const wanted = new Set(process.env.DRIFT_BROWSERS.split(',').map(s => s.trim()).filter(Boolean));
  projects = allProjects.filter(p => wanted.has(p.name));
}

// Expose diff thresholds (playwright test code will read these envs when calling toMatchSnapshot)
process.env.DRIFT_MAX_DIFF_RATIO = process.env.DRIFT_MAX_DIFF_RATIO || '0.002'; // 0.2% default
process.env.DRIFT_MAX_DIFF_PIXELS = process.env.DRIFT_MAX_DIFF_PIXELS || '250'; // fallback absolute cap

export default defineConfig({
  testDir: 'tests/playwright',
  globalSetup: require.resolve('./tests/playwright/global-setup'),
  timeout: 45_000,
  fullyParallel: true,
  expect: { timeout: 7_500 },
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [
        ['list'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }]
      ]
    : [['list']],
  use: {
    baseURL,
    // Capture screenshots & traces only when valuable; videos only on retry to reduce churn
    screenshot: 'only-on-failure',
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
    video: process.env.CI ? 'on-first-retry' : 'off'
  },
  projects,
  metadata: {
    purpose: 'ui-drift-detection',
    baseURL,
    maxDiffRatio: process.env.DRIFT_MAX_DIFF_RATIO,
    maxDiffPixels: process.env.DRIFT_MAX_DIFF_PIXELS
  }
});
