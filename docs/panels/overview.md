# Overview Panel

The Overview panel is the first operational readout for the Index Server admin dashboard. It answers three questions quickly: is the server alive, is the instruction index loaded as expected, and are tool calls behaving normally?

Use this page for fast triage before moving into Monitoring, Maintenance, Instructions, Configuration, or SQLite. The panel is read-only; it reports runtime state and does not mutate instruction data.

![Overview Panel](/api/screenshots/panel-overview.png)

## Data Sources

The browser refreshes the Overview panel from several admin endpoints.

- **`GET /api/admin/stats`**: feeds System Statistics, Performance, and Individual Tool Call Metrics. This is the primary source for request counters, index counts, connection counts, memory values, and per-tool metrics.
- **`GET /api/system/health`**: feeds System Health. The client normalizes modern and older health response shapes before rendering status, checks, issues, recommendations, and trend data.
- **`GET /api/system/resources`**: feeds the Performance card's resource sparklines and the Catalog History chart. The response includes a `catalogHistory` array of samples collected every 5 minutes by the server-side `CatalogSampler`.
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

The Performance card combines a compact throughput and latency summary with a Catalog History line chart. The stat rows give current-value answers; the chart shows how catalog health has changed over time.

### Stat rows

- **Total Connections**: total observed dashboard/client connections since process start. Use it to spot connection churn.
- **Error Rate**: aggregate request error rate, repeated here so performance and reliability can be read together.
- **Response Time**: average tracked response time in milliseconds. Watch for sudden increases after imports, restores, or search-heavy workflows.
- **Window**: recent resource-trend sampling window. This describes how much history the CPU/heap sparkline represents and operates on a separate, faster cadence (seconds) from the Catalog History chart.
- **Memory Usage**: current heap used compared with heap limit or heap reservation. This is useful after bulk operations or long-running sessions.

### Catalog History chart

Below the stat rows, the Catalog History chart shows the **composition of the index over time** as two stacked-area panels sharing one x-axis.

**Panel 1 — index composition.** The total height *is* the instruction count, split into three mutually exclusive bands:

- **never used**: never retrieved and never signalled.
- **retrieved**: retrieved or applied at least once, but carrying no signal.
- **signalled**: carrying any feedback signal.

Because the three bands sum to the entry count, the signal count and the instruction count share a single axis. There is no second scale and no ratio to misread — the signalled band's height against the full stack *is* the coverage.

**Panel 2 — signals by type.** The signalled band decomposed into `applied`, `helpful`, `not-relevant`, and `outdated`, on its own axis. Colours run from positive (blue) through negative (red), so a growing red band means the catalog is going stale.

Both panels carry numeric y-axis ticks. Hovering draws one crosshair across both panels and prints every band's value for that sample; "Show data table" prints the same numbers as text, for keyboard readers and anyone who cannot separate the bands by colour.

**Counts are index-scoped.** Every band is computed by walking the live index, not the usage snapshot. The snapshot retains records for entries that have since been removed, so counting its keys could report more signalled entries than exist.

**The history is persistent.** `CatalogSampler` takes one sample every 5 minutes and writes it to SQLite (`metrics/activity.db` by default, `INDEX_SERVER_ACTIVITY_DB` to relocate). History survives restarts and is pruned by age (`INDEX_SERVER_ACTIVITY_RETENTION_DAYS`, default 90). The in-process ring buffer still holds the most recent 72 samples and is used only as a fallback when the store is unavailable — in that case the chart shows history since the last restart rather than nothing.

The 5-minute catalog cadence is separate from the resource-trend "Window" row above, which tracks CPU and heap on a faster cadence. Two different sampling windows appear on the same card — the "Window" row describes the resource sparkline, not the catalog chart.

Before the first sample exists, the chart area displays "No sampled history yet."

### Catalog Activity chart

Where Catalog History is a *stock* view (what the index looks like), Catalog Activity is a *flow* view (what happened). It draws stacked bars per time bucket — `added`, `modified`, `signalled`, `archived`, `removed` — with selectable bucket width (hourly to weekly) and time range.

Bars rather than lines: these are counts of discrete events, and a line between two buckets would draw values that were never observed, rendering a quiet day as a smooth slope rather than as nothing happening.

Below the chart, **By instance** breaks the same window down per server process (`<pid>@<cwd>`), including a per-signal breakdown. Use it to answer "which instance wrote this" when several are running against one catalog.

Activity is recorded from the audit choke point that every committed mutation already passes through, so it captures adds, patches, archives, restores, and purges without per-handler wiring. Signals are recorded separately at `usage_track`, carrying the previous signal value — the usage snapshot keeps only a last-write-wins `lastSignal` with no timestamp, so a `helpful` later changed to `applied` would otherwise leave no trace.

Set `INDEX_SERVER_ACTIVITY_LOG=0` to disable activity recording; both charts then fall back to whatever history already exists.

For percentiles, event streams, synthetic activity, and live log tailing, switch to the Monitoring panel. Overview is optimized for quick triage, not exhaustive profiling.

## Index Growth

Cumulative catalog size over time, drawn as a filled area from `GET /api/usage/growth`.

**This chart reads no telemetry.** The two catalog charts above are both *measured*: Catalog History samples the index every 5 minutes, and Catalog Activity records events as they happen. Neither can describe anything that happened before telemetry was switched on, so on a freshly-upgraded server they show a flat line and a row of empty buckets while the catalog itself may be months old.

Index Growth is *derived* instead. Every instruction already carries `createdAt`, and archived entries carry `archivedAt`, so the server reconstructs the curve from the catalog as it stands right now — back to the oldest entry, with no accumulated history required. It is correct immediately after a fresh install, and it survives the activity database being lost, relocated, or reset.

A line rather than bars: cumulative size is a quantity that genuinely exists between observations, so interpolating across a quiet week is honest here in a way it would not be for the event counts above. The y-axis always starts at zero — a cumulative count auto-scaled to its own minimum would render a two-entry drift as a dramatic climb.

**It is a survivor curve, not a measured time series.** This is the one thing to understand before reading anything into it:

- Entries that exist today are placed on the day they were created.
- Entries that were **archived** are counted from their creation day and subtracted on their archive day — archives keep a row, so they are fully recoverable.
- Entries that were **permanently deleted** leave no row anywhere. They cannot appear, so the line understates the catalog's true size at any past moment when something has since been purged.

The caveat is rendered under the chart on every load for that reason, and the API response carries `derived: true`. Do not cite this curve as evidence of what the index contained on a given date; cite it for shape and growth pattern.

Entries whose `createdAt` is missing or unparseable are excluded rather than defaulted, and counted in the response's `undated` field (surfaced in the readout as "N undated entries excluded"). Defaulting them would place them at the Unix epoch and drag the curve's origin back by decades.

The **all time** range omits `since` and lets the server default it to the catalog's own first creation. The 30/90-day ranges fold everything older into a baseline, so a short window on an old catalog opens at the real count rather than at zero.

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
- Check Performance for response time, memory pressure, and catalog trends. If the stat rows look abnormal, use Monitoring for deeper timing and log context. If the Catalog History chart shows a sudden drop in index count, check whether a restart, reload, or validation failure occurred.
- Check Usage Signals last. Use it to prioritize instruction content review after runtime health is understood.

## Common Findings

- **`Stats unavailable`** usually means `/api/admin/stats` failed, auth expired, the server is restarting, or the dashboard script loaded before stats were ready. Refresh once, then check Monitoring logs and server stderr if it persists.
- **`Overall Status` is `UNKNOWN`** means health data exists but stats were unavailable or missing expected fields. Verify `/api/admin/stats` and `/api/system/health` through logs or the browser network view.
- **`index Skipped` is non-zero** means one or more instruction files failed validation or normalization. Check logs for validation details, then inspect Instructions and Maintenance.
- **`index Files` is higher than `index Accepted`** means raw file discovery found files that did not become accepted instructions. Confirm whether those files are support files, manifests, invalid drafts, or migration leftovers.
- **Tool success rate is below 95 percent** usually points to tool-specific failures, bad input shape, disabled mutation, or a backend dependency issue. Open Monitoring logs and reproduce the affected call with a focused request.
- **Memory sparkline climbs steadily** can indicate a long-running operation, cache growth, import/restore pressure, or a possible leak. Compare with Monitoring, then capture logs before restarting.
- **Many `outdated` Usage Signals** means instruction content may no longer match current repo or runtime behavior. Review the signaled instruction IDs and update or deprecate stale guidance.
- **Catalog History chart shows a single point or very short line** means the server started recently. The catalog sampler collects one sample every 5 minutes and holds up to 72 samples (6 hours). The chart fills in over time.
- **Catalog History chart is empty after a restart** is expected. History is in-memory only and resets when the server process restarts. This is not data loss — the stat rows and System Statistics still show current absolute values.

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
- **`INDEX_SERVER_ACTIVITY_LOG`** records catalog activity and periodic catalog samples for the Overview charts (on by default; set `0` to disable).
- **`INDEX_SERVER_ACTIVITY_DB`** relocates the activity/sample database (default `<cwd>/metrics/activity.db`). Independent of `INDEX_SERVER_STORAGE_BACKEND`, so chart history exists in both `json` and `sqlite` modes.
- **`INDEX_SERVER_ACTIVITY_RETENTION_DAYS`** sets the age at which activity events and catalog samples are pruned (default `90`).

## Operator Notes

- Overview values reset when the server process restarts unless they are backed by persisted state.
- The Catalog History chart is in-memory only. It resets on restart and grows from a single point — this is by design, not a bug. SQLite persistence for catalog history is a deferred follow-up.
- Catalog History axes are absolute and tick-labelled; bands within a panel share one scale and are directly comparable. Do not compare heights *across* the two panels — they have separate maxima, shown on their own axes.
- The "Window" row in the Performance stat rows describes the CPU/heap resource sparkline cadence, not the Catalog History chart cadence. The two sampling windows are independent.
- Treat the Overview panel as a triage surface. Use panel-specific pages for root-cause work.
- Check index counts after backup restore, bulk import, cache clear, or schema migration.
- Keep browser tabs reasonable during diagnosis; each dashboard tab can add WebSocket/admin activity.
- When values conflict, prefer the authoritative source for the domain: index counts from stats, detailed operations from Monitoring logs, and content truth from the Instructions panel.
