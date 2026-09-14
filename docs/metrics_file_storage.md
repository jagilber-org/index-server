# MetricsCollector File Storage Configuration

The MetricsCollector now supports file-based storage to prevent memory accumulation while preserving historical data.

## Configuration

### Environment Variables

Only two environment variables are read (#591):

- `INDEX_SERVER_METRICS_FILE_STORAGE` — enable file storage. Default off
  (`src/config/serverConfig.ts`), though the `enhanced` and `full` runtime
  profiles turn it on (`runtimeConfig.ts:462,468`).
- `INDEX_SERVER_METRICS_DIR` — directory for metrics files. **Default
  `<STATE_ROOT>/metrics`, not `./metrics`.** `STATE_ROOT` is the OS user-data
  directory — `%LOCALAPPDATA%\index-server` on Windows,
  `$XDG_STATE_HOME/index-server` elsewhere — overridable with
  `INDEX_SERVER_STATE_ROOT`. It has not been cwd-relative since #577; a
  cwd-relative default gave every MCP client its own private metrics directory.
  A relative value here is resolved against `STATE_ROOT`, not the working
  directory.

> **`INDEX_SERVER_METRICS_MAX_FILES` and `INDEX_SERVER_METRICS_RETENTION_MINUTES`
> do nothing.** This document previously listed both as configuration. Neither is
> read anywhere in `src/` or `scripts/` — `720` and `60` are constructor defaults
> on `MetricsCollector` (`src/dashboard/server/MetricsCollector.ts:156-157`),
> reachable only in code. `MAX_FILES` is additionally still advertised as
> `editable: true` in the dashboard Configuration panel, where setting it has no
> effect; that is tracked in #588.

### Memory vs File Storage

The retention behaviour is the **opposite** of what this document used to claim.

**Memory Only (Default)**:
- Fast access for real-time queries
- Keeps **720** snapshots (`options.maxSnapshots`), plus a time cutoff of
  `retentionMinutes` (60) — `MetricsCollector.ts:748-764`
- All historical data lost on restart

**The ~60-snapshot cap applies only when file storage is ON.** `MAX_MEMORY_SNAPSHOTS = 60`
(`MetricsCollector.ts:129`) is selected by `this.useFileStorage ? 60 : maxSnapshots`,
because with the files on disk there is no reason to hold an hour of history in
memory. Enabling file storage therefore *reduces* the in-memory window from 720
to 60 while making history durable.

**File Storage (Recommended)**:
- Unlimited historical data retention
- Persistent across restarts
- Real-time queries still use in-memory cache
- Historical analysis available via async methods

## Usage

### Enable File Storage
```bash
export INDEX_SERVER_METRICS_FILE_STORAGE=true
# Optional. Absolute, or relative to STATE_ROOT — never to the working directory.
export INDEX_SERVER_METRICS_DIR="/data/mcp-metrics"
```

### API Changes

**Existing methods** (unchanged - use in-memory cache):
- `getSnapshots(count)` - Recent snapshots for real-time dashboard
- `getCurrentSnapshot()` - Current state
- `getRealtimeMetrics()` - Real-time dashboard data

**New async methods** for historical data:
- `getHistoricalSnapshots(count)` - Load snapshots from files
- `getSnapshotsInRange(start, end)` - Time range queries
- `getStorageStats()` - File storage statistics
- `clearMetrics()` - Now async, clears both memory and files

### Memory Impact

**File storage off**: up to 720 snapshots × ~2KB each = ~1.4MB
**File storage on**: 60 snapshots × ~2KB each = ~120KB, with history on disk

### What is written to the metrics directory

Rotated per-snapshot JSON files:
```
<STATE_ROOT>/metrics/
├── metrics-1693123456789.json
├── metrics-1693123516789.json
└── ...
```

Plus three BufferRing persistence files written to the **same directory**, which
this document previously omitted (`MetricsCollector.ts:181-190`):

| File | Contents | Capacity |
|---|---|---|
| `historical-snapshots.json` | Time-series snapshots | `maxSnapshots` (720) |
| `tool-call-events.json` | Individual tool invocations | 10,000 |
| `performance-metrics.json` | Minute-by-minute performance | 1,440 (24h) |

`<STATE_ROOT>/metrics/` also holds `activity.db` (#571/#577). Point
`INDEX_SERVER_METRICS_DIR` somewhere expecting only metric snapshots and you
will find these too.

## Migration

Existing deployments continue to work unchanged. To enable file storage:

1. Set `INDEX_SERVER_METRICS_FILE_STORAGE=true`
2. Optionally configure storage directory
3. Restart MCP server

Historical data will begin accumulating in files, while real-time performance remains unaffected.
