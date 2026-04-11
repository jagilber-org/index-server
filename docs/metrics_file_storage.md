# MetricsCollector File Storage Configuration

The MetricsCollector now supports file-based storage to prevent memory accumulation while preserving historical data.

## Configuration

### Environment Variables

- `INDEX_SERVER_METRICS_FILE_STORAGE=true` - Enable file storage (default: false for backward compatibility)
- `INDEX_SERVER_METRICS_DIR=./metrics` - Directory for metrics files (default: `./metrics`)
- `INDEX_SERVER_METRICS_MAX_FILES=720` - Maximum files to keep (default: 720 = 12 hours)
- `INDEX_SERVER_METRICS_RETENTION_MINUTES=60` - File retention period (default: 60 minutes)

### Memory vs File Storage

**Memory Only (Default)**:
- Fast access for real-time queries
- Limited to ~60 snapshots to prevent memory leaks
- All historical data lost on restart

**File Storage (Recommended)**:
- Unlimited historical data retention
- Persistent across restarts
- Real-time queries still use in-memory cache
- Historical analysis available via async methods

## Usage

### Enable File Storage
```bash
export INDEX_SERVER_METRICS_FILE_STORAGE=true
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

**Before**: Up to 720 snapshots × ~2KB each = ~1.4MB growing continuously
**After**: Only 60 snapshots × ~2KB each = ~120KB stable

Historical data stored in individual JSON files:
```
metrics/
├── metrics-1693123456789.json
├── metrics-1693123516789.json
└── ...
```

## Migration

Existing deployments continue to work unchanged. To enable file storage:

1. Set `INDEX_SERVER_METRICS_FILE_STORAGE=true`
2. Optionally configure storage directory
3. Restart MCP server

Historical data will begin accumulating in files, while real-time performance remains unaffected.
