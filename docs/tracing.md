# Tracing & Diagnostics Guide

Enhanced tracing provides deterministic, low‑overhead insight into Index CRUD, handshake, and test cross‑validation flows. This document describes the unified environment flag matrix and usage patterns introduced in v1.1.0+.

## NDJSON Structured Logging

All server log output uses **strict NDJSON** (newline-delimited JSON) — one JSON object per line on stderr and optional log files. This format is machine-parseable while remaining human-readable.

### Log Record Schema

```json
{"ts":"2026-04-03T18:52:12.000Z","level":"ERROR","msg":"[rpc] readSession failed","detail":"Error: ENOENT\n    at readSession (server/rpc.ts:42:9)","pid":12345}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ts` | string | ✓ | ISO 8601 timestamp |
| `level` | string | ✓ | Uppercase severity: `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `msg` | string | ✓ | Human-readable message. Prefix with `[module]` for source-file heatmap matching |
| `detail` | string | | Stack trace or serialized data. Auto-populated on WARN/ERROR via V8 `Error.captureStackTrace` |
| `tool` | string | | Tool identifier (populated for tool lifecycle events) |
| `ms` | number | | Duration in milliseconds |
| `pid` | number | | Process ID |
| `port` | string | | Server port |
| `correlationId` | string | | 16-hex request correlation ID (from `newCorrelationId()`) |

### Log Levels

Priority (lower = more verbose): TRACE (0) < DEBUG (1) < INFO (2) < WARN (3) < ERROR (4).

Configured via `INDEX_SERVER_LOG_LEVEL` (default: `info`). Records below the configured level are suppressed.

Level escalation shortcuts:

* `INDEX_SERVER_DEBUG=1` or `INDEX_SERVER_VERBOSE_LOGGING=1` → elevates to DEBUG
* `INDEX_SERVER_TRACE=verbose` → elevates to TRACE

### Logging API

```typescript
import { logTrace, logDebug, logInfo, logWarn, logError, log, newCorrelationId } from './services/logger';

logInfo('Server started');                              // simple message
logError('Request failed', new Error('timeout'));       // auto-captures stack
logDebug('[handler] cache miss', { key: 'abc' });      // module-prefixed with detail
log('INFO', 'custom', { tool: 'index_search', ms: 42 }); // low-level with extra fields
```

### Function Call Tracing Convention

At TRACE level, use arrow prefixes for call-graph support:

```
→ IndexContext.ensureLoaded    (entry)
← IndexContext.ensureLoaded    (exit)
```

### Example NDJSON Output

```jsonl
{"ts":"2026-04-03T18:52:12.000Z","level":"INFO","msg":"[server] listening","port":"3000","pid":12345}
{"ts":"2026-04-03T18:52:12.100Z","level":"DEBUG","msg":"[handler] index_search invoked","tool":"index_search","correlationId":"a1b2c3d4e5f6a7b8","pid":12345}  # pragma: allowlist secret
{"ts":"2026-04-03T18:52:12.142Z","level":"INFO","msg":"[handler] index_search complete","tool":"index_search","ms":42,"pid":12345}
{"ts":"2026-04-03T18:52:13.000Z","level":"ERROR","msg":"[rpc] readSession failed","detail":"Error: ENOENT\n    at readSession (server/rpc.ts:42:9)","pid":12345}
```

### Logging Environment Variables

| Flag | Default | Description |
|------|---------|-------------|
| `INDEX_SERVER_LOG_LEVEL` | `info` | Minimum level: `trace`, `debug`, `info`, `warn`, `error` |
| `INDEX_SERVER_LOG_FILE` | (none) | File path for log output (`1` → default `logs/mcp-server.log`) |
| `INDEX_SERVER_LOG_SYNC` | off | fsync after each write (deterministic for tests) |
| `INDEX_SERVER_LOG_DIAG` | off | Include runtime diagnostics |
| `INDEX_SERVER_LOG_PROTOCOL` | off | Log protocol-level messages |
| `INDEX_SERVER_VERBOSE_LOGGING` | off | Elevate to DEBUG |
| `INDEX_SERVER_DEBUG` | off | Elevate to DEBUG |

---

## Quick Start

Set minimal core tracing:

```powershell
$env:INDEX_SERVER_TRACE_LEVEL='core'
```

Enable persistent JSONL trace with rotation:

```powershell
$env:INDEX_SERVER_TRACE_PERSIST='1'
$env:INDEX_SERVER_TRACE_DIR='C:\logs\mcp-trace'
$env:INDEX_SERVER_TRACE_MAX_FILE_SIZE='5000000' # ~5 MB per segment
```

Filter to specific categories (comma/space/semicolon delimited):

```powershell
$env:INDEX_SERVER_TRACE_CATEGORIES='ensureLoaded,list,get,add,test'
```

Assign a stable session id:

```powershell
$env:INDEX_SERVER_TRACE_SESSION='sessionA'
```

## Trace Levels

Hierarchy (superset accumulation):

* off (0) – disabled
* core (1) – high‑level Index + ensureLoaded events
* perf (2) – performance envelopes (load durations)
* files (3) – per‑file index load + disk scan entries
* verbose (4) – callsites (if INDEX_SERVER_TRACE_CALLSITE=1) and maximal detail

Explicit level via INDEX_SERVER_TRACE_LEVEL overrides convenience flags. Convenience boosting flags (applied if set):

* INDEX_SERVER_VISIBILITY_DIAG=1 -> at least core
* INDEX_SERVER_FILE_TRACE=1 -> at least files
* INDEX_SERVER_TRACE_ALL=1 -> verbose

## New Environment Flags

| Flag | Purpose | Example |
|------|---------|---------|
| INDEX_SERVER_TRACE_LEVEL | Explicit base level (off/core/perf/files/verbose) | core |
| INDEX_SERVER_TRACE_PERSIST | Enable JSONL persistent file logging (1 = on) | 1 |
| INDEX_SERVER_TRACE_DIR | Directory for trace files (default logs/trace) | C:\logs\mcp |
| INDEX_SERVER_TRACE_FILE | Explicit file path override | C:\logs\trace.jsonl |
| INDEX_SERVER_TRACE_MAX_FILE_SIZE | Rotate after N bytes (0=off) | 5000000 |
| INDEX_SERVER_TRACE_FSYNC | fsync after each write (1 = on) | 1 |
| INDEX_SERVER_TRACE_SESSION / INDEX_SERVER_TRACE_SESSION | Stable session id | repro123 |
| INDEX_SERVER_TRACE_CATEGORIES | Inclusive filter tokens | list,get,add |
| INDEX_SERVER_TRACE_CALLSITE | Capture function name (1 = on) | 1 |

## Categories

Category inference derives from the label bracket content e.g. `[trace:ensureLoaded:cache-hit]` yields tokens: `trace`, `ensureLoaded`, `cache-hit`. Filtering matches any token (excluding the literal `trace` helper prefix). Example: `INDEX_SERVER_TRACE_CATEGORIES='ensureLoaded add'`.

## Rotation Strategy

When INDEX_SERVER_TRACE_MAX_FILE_SIZE > 0 the initial file (trace-TIMESTAMP.jsonl) rotates to suffix `.1`, `.2`, ... once size threshold reached. Each rotation resets byte counter; session id remains constant.

## Record Schema

```json
{
  "ts": "2025-08-31T15:22:00.000Z",
  "t": 1693495320000,
  "lvl": 2,
  "label": "[trace:ensureLoaded:cache-hit]",
  "data": {"listCount": 23, "diskCount": 23},
  "func": "ensureLoaded",
  "pid": 12345,
  "session": "repro123"
}
```

## Startup Summary

With INDEX_SERVER_VERBOSE_LOGGING=1 server stderr now includes a `[startup] trace ...` line summarizing: level, session, file, categories, maxFileSize, rotationIndex.

## Test Instrumentation

`LIST_GET_CROSS_VALIDATION` emits `[trace:test:list_get_cross_validation:summary]` with metrics: totalIds, validated, sampled, concurrency, durationMs, stressMode.

## Reproducing Multi‑Client CRUD Anomalies

1. Enable persistent tracing & categories:

```powershell
$env:INDEX_SERVER_TRACE_PERSIST='1'
$env:INDEX_SERVER_TRACE_CATEGORIES='ensureLoaded list get add test'
```

1. Run multi‑client suites (e.g., feedbackReproduction.multiClient.spec.ts)
2. Correlate events by `session` and wall clock order.

## Performance Guidance

* Prefer category filters + core/perf levels for baseline.
* Escalate to files/verbose only for short targeted repro runs.
* Use rotation + session id in CI to isolate parallel job traces.

## Future Enhancements (Backlog)

* Structured tool to aggregate JSONL traces into summarized flake analysis.
* Optional gzip post‑rotation.
* Trace ingestion endpoint for centralized diagnostics.

---
Document generated alongside tracing enhancements (v1.1.0+). NDJSON logging section added for unified log format reference.
