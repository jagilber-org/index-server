import { chromium } from 'playwright';

const tabs = [
  { name: 'panel-overview', btn: 'Overview' },
  { name: 'panel-config', btn: 'Configuration' },
  { name: 'panel-sessions', btn: 'Sessions' },
  { name: 'panel-maintenance', btn: 'Maintenance' },
  { name: 'panel-monitoring', btn: 'Monitoring' },
  { name: 'panel-instructions', btn: 'Instructions' },
  { name: 'panel-graph', btn: 'Graph' },
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:9500/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

for (const tab of tabs) {
  await page.click(`button.nav-btn:has-text("${tab.btn}")`);
  await page.waitForTimeout(1500);
  if (tab.btn === 'Graph') {
    await page.waitForTimeout(6000); // extra time for mermaid render
  }
  await page.screenshot({ path: `docs/screenshots/${tab.name}.png`, fullPage: false });
  console.log('Captured: ' + tab.name);
}

await browser.close();
console.log('Done - all 7 screenshots saved to docs/screenshots/');
