# Playwright UI Drift Baseline (Full Suite)

## Purpose

Comprehensive structural + multi-browser visual regression guard for the admin dashboard. Detects layout, content, and cross-engine rendering regressions (e.g., missing System Health, lost semantic summaries, inconsistent list rendering).

## Test Tags

Tests containing `@baseline` tag participate in drift detection commands:

- `npm run pw:baseline` – update snapshots (golden refresh)
- `npm run pw:drift` – compare against existing snapshots (CI usage)

## Snapshot Policy

- High-signal regions: system health card, instruction list, instruction editor, log tail panel, graph (mermaid) visualization
- Graph policy: capture BOTH raw mermaid source (stable textual topology) and rendered SVG (best-effort; test skips if CDN render unavailable) for early detection of relationship/topology regressions.
- Cross-browser naming pattern: `<region>-<browser>-<platform>.png`
- Dynamic variance reduced with small settle delay (≈1.5s); graph raw snapshot avoids external layout timing noise.
- Thresholds configurable: `DRIFT_MAX_DIFF_RATIO` (default 0.002), `DRIFT_MAX_DIFF_PIXELS` (default 250)

## Workflow

1. Install browsers (first run): `npm run pw:init`
2. Refresh baseline (all browsers): `npm run pw:baseline`
3. Drift check locally (all configured browsers): `npm run pw:drift`
4. Generate drift report (JSON + markdown): `npm run pw:drift:report`
5. CI optimized run (chromium + firefox + report): `npm run pw:drift:ci`

## Environment Overrides

- `DASHBOARD_PORT` – target non-default port
- `PLAYWRIGHT_BASE_URL` – override full base URL
- `DRIFT_BROWSERS` – comma list subset of browsers (e.g. `chromium,firefox`)
- `DRIFT_MAX_DIFF_RATIO` – snapshot diff tolerance ratio
- `DRIFT_MAX_DIFF_PIXELS` – absolute pixel diff ceiling

## Adding New Regions

1. Identify stable DOM container (#id or data-test attr).
2. Add test with: small settle wait, region screenshot, `toMatchSnapshot` using browserName + platform naming.
3. For dynamic/remote assets (e.g. CDN-rendered diagrams) include a raw/text fallback snapshot OR guard with `test.skip` on timeout.
4. Justify region (signal > noise) in commit message.
5. Run `npm run pw:baseline` to produce new golden images.

## Maintenance Triggers

Refresh snapshots when intentionally modifying:

- Instruction list row structure / CSS classes
- System Health card layout or chart styles
- Semantic summary rendering logic
- Graph export topology (node/edge categories) or mermaid formatting
- Graph dashboard UI controls (enrichment, categories, usage toggles) affecting visual output

Investigate before updating if diff cause is unclear (avoid normalizing accidental regressions).

## Drift Report Artifacts

`scripts/generate-drift-report.mjs` emits:

- `playwright-report/drift-report.json` – machine summary
- `playwright-report/drift-report.md` – human-readable list & perf annotations

Integrate into CI by uploading both plus the standard Playwright HTML report.
