# Runtime Diagnostics & Global Error Handling

This document describes the unified runtime diagnostics guard added in version 1.1.4.

## Overview

A single guard installs process listeners exactly once to ensure consistent, structured logging for unexpected runtime conditions:

* Uncaught exceptions
* Unhandled promise rejections
* Node.js process warnings (deprecations, experimental flags, etc.)
* Termination signals (SIGINT, SIGTERM)

All log lines are written to stderr and prefixed so they never contaminate stdout JSON-RPC protocol frames.

## Log Line Format

```text
[diag] [<ISO8601>] [<category>] <details>
```

Categories currently emitted:

* `uncaught_exception`
* `unhandled_rejection`
* `process_warning`
* `signal`

Example:

```text
[diag] [2025-09-05T19:12:43.123Z] [uncaught_exception] Error: ENOENT stack=Error ENOENT ...
```

## Exit Behavior

Uncaught exceptions schedule a fail‑fast termination after a short delay (default 15ms) to allow the final diagnostic line to flush. Promise rejections do not terminate the process (consistent with previous behavior) but are logged with stack traces when available.

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `INDEX_SERVER_FATAL_EXIT_DELAY_MS` | `15` | Milliseconds to wait before exiting after an uncaught exception (gives stderr time to flush). |

## Rationale

Previously, multiple modules registered overlapping `uncaughtException` / `unhandledRejection` handlers causing duplicate lines and inconsistent formatting. The unified guard:

* Prevents duplicate handlers (name check: `mcpGlobalGuard`).
* Normalizes formatting for downstream log processors.
* Adds warning & signal visibility for proactive diagnostics.

## Extension Opportunities

The following enhancements can be layered without changing existing semantics:

1. Metrics counters for each category (e.g., `diagnostics.uncaughtExceptions`).
2. JSONL structured sink with rotation (`logs/diagnostics-*.jsonl`).
3. Dashboard /api/admin/diagnostics endpoint listing last N events.
4. WebSocket broadcast of critical diagnostics for live dashboards.
5. Health status degradation triggers (e.g., mark system `warning` after 1 unhandled rejection in last 5m).

## Safety Considerations

* Handler never throws (all writes wrapped in try/catch).
* Signal handlers exit cleanly with exit code 0 (graceful shutdown semantics for user‑initiated termination).
* Only minimal state captured; no PII or dynamic secrets logged.

## Testing Notes

Existing test suite already asserts no stdout contamination and tolerates stderr noise; unified formatting reduces variance. No tests rely on the previous `[fatal]` prefix.

---
Version: 1.1.4
