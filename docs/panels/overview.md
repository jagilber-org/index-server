# Overview Panel

The Overview panel provides a real-time snapshot of server health and performance.

## System Statistics

Displays key metrics including:

- **Uptime** — how long the server has been running
- **Instruction Count** — total loaded instructions
- **index hash** — governance hash of the current Index state
- **Memory Usage** — Node.js heap and RSS memory consumption
- **Version** — current server version and schema version

## System Health

Shows the health status returned by `health_check`, including:

- Server status (ok / degraded / error)
- Index scan results (accepted vs skipped entries)
- Active instance information (leader/follower)

## Performance

Summarizes request throughput and latency:

- **Total Requests** — cumulative tool calls handled
- **Average Latency** — mean response time across all tools
- **P95 / P99 Latency** — tail latency percentiles
- **Error Rate** — percentage of failed requests

## Individual Tool Call Metrics

A detailed table of per-tool performance data:

| Column | Description |
| ------ | ----------- |
| Tool | MCP tool name |
| Calls | Total invocations |
| Avg (ms) | Average response time |
| P95 (ms) | 95th percentile latency |
| Errors | Failed call count |

Use this to identify slow or frequently-failing tools.

---

**Related env vars:** `INDEX_SERVER_VERBOSE_LOGGING`, `INDEX_SERVER_LOG_LEVEL`
