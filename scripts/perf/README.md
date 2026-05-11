# scripts/perf

Performance baselines, trend tracking, benchmarks, and stress tests. Results are
stored in `data/performance-baseline-*.json` and compared across runs to detect
regressions.

## Scripts

| Script | Purpose |
|--------|---------|
| `perf-baseline.mjs` | Capture a new performance baseline snapshot |
| `perf-compare.mjs` | Compare the current run against the last baseline; fail on regression |
| `perf-summary-md.mjs` | Render baseline data as a Markdown summary table |
| `perf-trend.mjs` | Plot performance trend across all stored baselines |
| `benchmark-search.ps1` | PowerShell benchmark: search throughput at varying corpus sizes |
| `adhoc-concurrent-integrity.mjs` | Concurrent mutation probe: N parallel add/remove cycles with integrity check |
| `stress-test.ps1` | Full stress test: sustained CRUD load over configurable duration |
| `stress-test-crud.ps1` | CRUD-focused stress: rapid sequential add/update/remove cycles |
| `stress-test-backup.ps1` | Backup-focused stress: repeated backup/restore under live load |

## Quick start

```pwsh
# Capture today's baseline
node scripts/perf/perf-baseline.mjs

# Compare to last baseline (exits non-zero on regression)
node scripts/perf/perf-compare.mjs

# 60-second concurrent stress test
node scripts/perf/adhoc-concurrent-integrity.mjs --duration 60
```

> Baseline files live in `data/performance-baseline-<date>.json`.
> See `docs/stress-testing.md` for the full stress-test runbook.
