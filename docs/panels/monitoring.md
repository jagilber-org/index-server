# Monitoring Panel

The Monitoring panel provides real-time observability into server operations.

## Real-time Monitoring

Live metrics updated via WebSocket connection:

- **Request Rate** — tool calls per second
- **Active Connections** — current WebSocket and stdio clients
- **Error Rate** — recent error percentage
- **Memory Trend** — heap usage over time
- **Event Stream** — live feed of server events (tool calls, errors, lifecycle events)

## Synthetic Activity

Generate artificial load to exercise the server and validate metrics collection.

### Controls

- **Iterations** — number of tool calls to execute (default 25)
- **Concurrency** — parallel workers (default 3)
- **Run** — starts the synthetic activity run

### Per-Call Trace

When synthetic activity completes, a detailed trace table shows:

| Column | Description |
| ------ | ----------- |
| # | Call sequence number |
| Tool | Which MCP tool was invoked |
| Success | Whether the call succeeded |
| Duration | Response time in milliseconds |
| Error | Error message if the call failed |

Synthetic activity only invokes safe read-only tools (health_check, index_dispatch list, index_search, etc.).

## Server Logs

Real-time log viewer with streaming support.

### Controls

- **Lines** — number of log lines to load (default 100)
- **Refresh** — load latest log entries
- **Start Tail** — stream new log entries in real-time via WebSocket
- **Clear** — clear the log display

### Log Configuration

Set `INDEX_SERVER_LOG_FILE=1` to enable file logging (auto-creates `logs/mcp-server.log`), or set it to a specific file path.

| Variable | Description |
| -------- | ----------- |
| INDEX_SERVER_LOG_LEVEL | Log verbosity (debug, info, warn, error) |
| INDEX_SERVER_VERBOSE_LOGGING | Enable verbose debug output |
| INDEX_SERVER_LOG_FILE | Log file path or '1' for auto |

---

**Related docs:** See `docs/tracing.md` for distributed tracing configuration.
