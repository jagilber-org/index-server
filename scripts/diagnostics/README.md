# scripts/diagnostics

Adhoc probes, health checks, log analysis, and inspection tools. Scripts here are
for manual debugging sessions — they are **never** referenced by CI or `package.json`.
Prefix `adhoc-*` signals a one-off probe safe to run at any time and safe to
delete when no longer needed.

## Scripts

| Script | Purpose |
|--------|---------|
| `adhoc-disk-state-monitor.mjs` | Poll disk instruction files and report changes |
| `adhoc-mutation-integrity.mjs` | Verify add/update/remove round-trips leave no ghost state |
| `analyze-server-logs.ps1` | Parse structured server logs and summarize error/warn counts |
| `analyze-traces.mjs` | Parse OpenTelemetry trace files and report slow spans |
| `crawl-logs.mjs` | Stream-search log files for a pattern; handles large log sets |
| `crudProbe.mjs` | Legacy inline CRUD probe (see `scripts/dev/integrity/crud-probe.mjs` for current version) |
| `diagnostics-pack.mjs` | Bundle key diagnostic artifacts (logs, metrics, env) into a zip |
| `diagram-viewer.html` | Browser-based viewer for server graph/trace diagrams |
| `health-check.mjs` | Invoke `/healthz` and print structured result |
| `inspect-metrics.js` | Load and pretty-print the metrics JSON snapshot |
| `memory-inspector.js` | Dump Node.js heap summary for a running server |
| `metrics-check.js` | Assert metric values are within expected thresholds |
| `monitor-memory.ps1` | Poll RSS memory of a running server process over time |
| `README-monitoring.md` | Monitoring runbook (server health monitoring setup) |
| `repro-add-get.js` | Minimal reproducer: add an instruction then get it back |
| `run-feedback-repro-with-trace.ps1` | Run feedback API calls with trace logging enabled |
| `sqlite-validate.ps1` | Validate SQLite DB integrity (`PRAGMA integrity_check`) |

## Usage pattern

```pwsh
# Health check against a local server
node scripts/diagnostics/health-check.mjs

# Diagnostics bundle for a bug report
node scripts/diagnostics/diagnostics-pack.mjs --out diagnostics-$(Get-Date -f yyyyMMdd).zip
```
