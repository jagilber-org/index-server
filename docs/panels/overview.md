# Overview Panel

The Overview panel is the first operational readout for the Index Server admin dashboard. It answers three questions quickly: is the server alive, is the instruction index loaded as expected, and are tool calls behaving normally?

Use this page for fast triage before moving into Monitoring, Maintenance, Instructions, Configuration, or SQLite. The panel is read-only; it reports runtime state and does not mutate instruction data.

![Overview Panel](/api/screenshots/panel-overview.png)

## Data Sources

The browser refreshes the Overview panel from several admin endpoints.

- **`GET /api/admin/stats`**: feeds System Statistics, Performance, and Individual Tool Call Metrics. This is the primary source for request counters, index counts, connection counts, memory values, and per-tool metrics.
- **`GET /api/system/health`**: feeds System Health. The client normalizes modern and older health response shapes before rendering status, checks, issues, recommendations, and trend data.
- **`GET /api/admin/maintenance`**: loads maintenance state alongside the overview request so maintenance status can be surfaced where the UI supports it.
- **`GET /api/usage/snapshot`**: feeds Usage Signals, including instruction usage counts, latest qualitative signals, and top signaled instructions.

If one endpoint is temporarily unavailable, the panel tries to degrade only the affected card. For example, missing stats show as `Stats unavailable`, and health can move toward `UNKNOWN` instead of creating a false critical alarm.

## System Statistics

System Statistics combines server process counters with instruction-index inventory. Treat it as the quickest way to confirm that the dashboard is connected to the expected running server and that the index loader accepted the expected files.

- **Uptime**: how long the current server process has been running. A sudden low value can indicate a restart, deployment, crash recovery, or intentional process recycle.
- **Active Connections (WS)**: current dashboard WebSocket connections. This is usually small; higher values often mean several operators or browser tabs are open.
- **Admin Sessions**: authenticated dashboard sessions tracked by the admin layer. Use this to confirm whether multiple operators are connected.
- **Total Requests**: cumulative requests handled since process start. This resets when the process restarts, so compare it with uptime before interpreting volume.
- **Error Rate**: percent of handled requests that failed. Sustained non-zero values should be investigated in Monitoring and logs.
- **Avg Response Time**: mean tracked response time. Averages can hide tail latency, so use Monitoring for deeper timing analysis.
- **index Accepted**: instruction entries accepted after load and validation. This is the authoritative loaded-entry count for MCP tools and dashboard views.
- **index Files**: raw `*.json` files discovered on disk before validation. This can be higher than accepted when files are skipped, rejected, or not instruction entries.
- **index Skipped**: entries rejected or skipped during validation or normalization. Unexpected non-zero values deserve a log review.
- **index Version**: runtime package/index version reported by stats. This helps confirm the running build after deployment.
- **Schema Version**: instruction schema version in use. This matters when diagnosing migrations or mixed-version instruction files.
- **Last Updated**: last index update timestamp. Use it to confirm whether reload, restore, import, or mutation operations refreshed the live index.

## Reading Index Counts

The three index counts are intentionally separate.

- **index Files** is disk discovery: what the loader found before validation.
- **index Accepted** is runtime truth: what entered the live index and is usable by MCP tools.
- **index Skipped** is validation or normalization fallout: what did not enter the live index.

A healthy repository often has `Files == Accepted` and `Skipped == 0`. If `Files > Accepted`, check whether the extra files are expected support files, rejected instruction drafts, or migration leftovers.

## System Health

System Health renders the normalized payload returned by `/api/system/health`. The card is intentionally conservative: it calls out missing data and resource pressure without treating every transient scrape issue as an outage.

- **Overall Status**: top-level normalized server health. Normal operation usually reads `HEALTHY` or `OK`, depending on payload shape.
- **Checks**: boolean checks such as `cpu` and `memory`. Each listed check should show `ok` during normal operation.
- **CPU Trend**: direction of CPU usage when trend data is available. Stable or low usage is expected.
- **Memory Trend**: direction and growth rate of heap usage when available. Stable or bounded growth is expected.
- **Issues**: explicit health issues from the server or derived resource checks. This should be empty during normal operation.
- **Recommendations**: follow-up guidance emitted by the health model. These are useful hints when resource pressure or abnormal trends are detected.
- **Resource Trend**: lightweight CPU and heap sparklines. Flat or bounded lines are normal; steady climbs deserve investigation.

The client can derive CPU and memory checks from the latest resource cache or stats when the health endpoint does not provide explicit checks. CPU usage around 85 percent or higher is treated as a failed CPU check. Heap usage near the configured V8 heap limit is treated as memory pressure.

## Performance

The Performance card is a compact throughput and latency summary. It is smaller than the Monitoring panel on purpose; use it to decide whether deeper investigation is needed.

- **Total Connections**: total observed dashboard/client connections since process start. Use it to spot connection churn.
- **Error Rate**: aggregate request error rate, repeated here so performance and reliability can be read together.
- **Response Time**: average tracked response time in milliseconds. Watch for sudden increases after imports, restores, or search-heavy workflows.
- **Window**: recent resource-trend sampling window when available. This explains how much history the sparkline represents.
- **Memory Usage**: current heap used compared with heap limit or heap reservation. This is useful after bulk operations or long-running sessions.

For percentiles, event streams, synthetic activity, and live log tailing, switch to the Monitoring panel. Overview is optimized for quick triage, not exhaustive profiling.

## Individual Tool Call Metrics

Individual Tool Call Metrics ranks MCP/admin tool activity by total call count. It helps identify which operations are hot, slow, or failing.

- **Total Calls**: number of invocations observed for that tool since process start or metrics reset.
- **Success Rate**: percent of calls that completed successfully. Values below 95 percent are visually warned.
- **Avg Response**: average response time for the tool, computed from total response time divided by calls.

Use this section to answer practical questions.

- Which tool is driving the current request volume?
- Did a recent operation introduce failures for one tool only?
- Are search, graph, backup, dispatch, or usage calls getting slower over time?

When a tool shows a low success rate, correlate it with Monitoring logs and the underlying MCP tool documentation before changing configuration.

## Usage Signals

Usage Signals summarizes instruction feedback captured through the usage snapshot. It is content-quality telemetry, not server-health telemetry.

- **Instructions with Usage**: number of instruction IDs with recorded usage activity.
- **Total Usage Count**: sum of usage counts across recorded instructions.
- **Instructions with Signals**: number of instructions that have a latest qualitative signal.
- **Signal Counts**: count by latest signal value, such as `helpful`, `applied`, `outdated`, or `not-relevant`.
- **Top Signaled Instructions**: up to ten active instructions with a latest signal, sorted by usage count.

Use this card to find instruction content that operators or agents are actually touching. `outdated` and `not-relevant` signals are good candidates for review. `helpful` and `applied` signals are evidence that guidance is being used successfully.

## Normal Triage Flow

- Start with System Statistics. If stats are unavailable, refresh once and then open Monitoring logs.
- Check Overall Status. If it is not healthy, read failed checks, issues, recommendations, and resource trends.
- Check Error Rate. If it is elevated, inspect Individual Tool Call Metrics to identify whether failures are global or tool-specific.
- Check index Accepted, index Files, and index Skipped. If counts are unexpected, move to Instructions or Maintenance.
- Check Performance for response time and memory pressure. If the card looks abnormal, use Monitoring for deeper timing and log context.
- Check Usage Signals last. Use it to prioritize instruction content review after runtime health is understood.

## Common Findings

- **`Stats unavailable`** usually means `/api/admin/stats` failed, auth expired, the server is restarting, or the dashboard script loaded before stats were ready. Refresh once, then check Monitoring logs and server stderr if it persists.
- **`Overall Status` is `UNKNOWN`** means health data exists but stats were unavailable or missing expected fields. Verify `/api/admin/stats` and `/api/system/health` through logs or the browser network view.
- **`index Skipped` is non-zero** means one or more instruction files failed validation or normalization. Check logs for validation details, then inspect Instructions and Maintenance.
- **`index Files` is higher than `index Accepted`** means raw file discovery found files that did not become accepted instructions. Confirm whether those files are support files, manifests, invalid drafts, or migration leftovers.
- **Tool success rate is below 95 percent** usually points to tool-specific failures, bad input shape, disabled mutation, or a backend dependency issue. Open Monitoring logs and reproduce the affected call with a focused request.
- **Memory sparkline climbs steadily** can indicate a long-running operation, cache growth, import/restore pressure, or a possible leak. Compare with Monitoring, then capture logs before restarting.
- **Many `outdated` Usage Signals** means instruction content may no longer match current repo or runtime behavior. Review the signaled instruction IDs and update or deprecate stale guidance.

## Related Panels

- **Monitoring**: use for live logs, request/event streams, synthetic activity, and deeper performance context.
- **Maintenance**: use for backup, restore, cache clear, reload, repair, and other operational actions.
- **Instructions**: use to inspect loaded instruction entries, metadata, validation state, and content quality.
- **Configuration**: use to confirm runtime flags, paths, feature toggles, and environment-derived behavior.
- **SQLite**: use to inspect experimental SQLite persistence and ingestion state.

## Related MCP Tools

- **`health_check`** reports current server health through the MCP surface.
- **`index_dispatch`** lists, retrieves, exports, and queries instruction entries.
- **`index_search`** searches instruction content and metadata.
- **`usage_hotset`** returns frequently used instruction entries.
- **`feedback_submit`** records structured operator or client feedback when feedback tooling is enabled.

## Related Environment Variables

- **`INDEX_SERVER_DASHBOARD`** enables the admin dashboard.
- **`INDEX_SERVER_DASHBOARD_PORT`** selects the dashboard listening port.
- **`INDEX_SERVER_DASHBOARD_TLS`** enables HTTPS for the dashboard when configured.
- **`INDEX_SERVER_LOG_LEVEL`** controls log verbosity.
- **`INDEX_SERVER_VERBOSE_LOGGING`** enables more detailed diagnostic output.
- **`INDEX_SERVER_LOG_FILE`** enables or selects file logging for operational investigation.
- **`INDEX_SERVER_HTTP_METRICS`** enables HTTP metrics where supported by the runtime.

## Operator Notes

- Overview values reset when the server process restarts unless they are backed by persisted state.
- Treat the Overview panel as a triage surface. Use panel-specific pages for root-cause work.
- Check index counts after backup restore, bulk import, cache clear, or schema migration.
- Keep browser tabs reasonable during diagnosis; each dashboard tab can add WebSocket/admin activity.
- When values conflict, prefer the authoritative source for the domain: index counts from stats, detailed operations from Monitoring logs, and content truth from the Instructions panel.
