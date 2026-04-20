# Runtime Configuration Migration Map

> **Status**: Phase 1 complete (2026-04-10). All runtime `process.env` reads in application code have been consolidated behind `getRuntimeConfig()`. Legacy unprefixed env vars (`BUFFER_RING_*`, `GRAPH_*`, `INSTRUCTIONS_AUDIT_LOG`, `COVERAGE_*`, `FAST_COVERAGE`) have been replaced with `INDEX_SERVER_*` prefixed equivalents. Old unprefixed names are no longer supported.

This document captures the proposed shape for expanding `runtimeConfig` so the remaining `process.env` reads in runtime code can be consolidated behind a single typed surface. The intent is to provide a reference for both implementation and code reviews while the migration proceeds.

## Design principles

1. **Single source of truth** – all runtime code imports configuration through `getRuntimeConfig()` (or a typed helper) instead of touching `process.env` directly.
2. **Stable namespaces** – group related concerns (dashboard, Index, tracing, etc.) under nested objects so call sites stay expressive.
3. **Typed defaults** – each entry specifies type, default value, and whether the default mirrors current behavior.
4. **No legacy fallback** – only `INDEX_SERVER_*` prefixed environment variables are read. Old unprefixed names are not supported.
5. **Dynamic escape hatches** – for areas that intentionally need arbitrary environment reads (e.g., integrations), keep explicit allowlists and helper wrappers to avoid wholesale `process.env` access.

## Proposed `runtimeConfig` shape

```ts
export interface RuntimeConfig {
  // ...existing properties...
  dashboard: {
    http: {
      enable: boolean;
      port: number;
      host: string;
      maxPortTries: number;
      enableHttpMetrics: boolean;
      requestTimeoutMs: number;
      maxConnections: number;
      verboseLogging: boolean;
      mutationEnabled: boolean;
    };
    admin: {
      maxSessionHistory: number;
      backupsDir: string;
      instructionsDir: string;
    };
    sessionPersistence: {
      enabled: boolean;
      persistenceDir?: string;
      backupIntegration: boolean;
      retention: {
        maxHistoryEntries?: number;
        maxHistoryDays?: number;
        maxConnectionHistoryDays?: number;
      };
      persistenceIntervalMs?: number;
      deduplicationEnabled: boolean;
    };
  };
  server: {
    disableEarlyStdinBuffer: boolean;
    fatalExitDelayMs: number;
    idleKeepaliveMs: number;
    sharedSentinel?: string;
    bootstrap: {
      autoconfirm: boolean;
      tokenTtlSec: number;
      referenceMode: boolean;
    };
    IndexPolling: {
      enabled: boolean;
      proactive: boolean;
      intervalMs: number;
    };
    multicoreTrace: boolean;
  };
  logging: {
    fileTarget?: string | { path: string; sentinel: boolean };
    json: boolean;
    sync: boolean;
    diagnostics: boolean;
  };
  metrics: {
    resourceCapacity: number;
    sampleIntervalMs: number;
    toolcall: {
      chunkSize: number;
      flushMs: number;
      compactMs: number;
    };
    dir: string;
  };
  Index: {
    baseDir: string;
    reloadAlways: boolean;
    memoize: boolean;
    memoizeHash: boolean;
    normalizationLog?: string | boolean;
    fileTrace: boolean;
    eventSilent: boolean;
    readRetries: {
      attempts: number;
      backoffMs: number;
    };
    usageFlushMs: number;
    disableUsageClamp: boolean;
    govHash: {
      trailingNewline: boolean;
    };
  };
  instructions: {
    workspaceId?: string;
    agentId?: string;
    strictVisibility: boolean;
    strictCreate: boolean;
    strictRemove: boolean;
    requireCategory: boolean;
    traceQueryDiag: boolean;
    manifest: {
      writeEnabled: boolean;
      fastload: boolean;
      canonicalDisable: boolean;
    };
    canonicalDisable: boolean;
    mutationEnabledLegacy: boolean;
    ciContext: {
      inCI: boolean;
      githubActions: boolean;
      tfBuild: boolean;
    };
  };
  tracing: {
    level: 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'verbose';
    categories: Set<string>;
    buffer: {
      file?: string;
      sizeBytes: number;
      dumpOnExit: boolean;
    };
    file?: string;
    persist: boolean;
    dir: string;
    fsync: boolean;
    maxFileSizeBytes: number;
    sessionId?: string;
    callsite: boolean;
  };
  mutation: {
    enabled: boolean;
    dispatcherTiming: boolean;
  };
  featureFlags: {
    file: string;
    envNamespace: Record<string, string | number | boolean>;
    indexFeatures: Set<string>;
  };
  feedback: {
    dir: string;
    maxEntries: number;
  };
  bootstrapSeed: {
    autoSeed: boolean;
    verbose: boolean;
  };
  bufferRing: {
    append: boolean;
    preload: boolean;
  };
  atomicFs: {
    retries: number;
    backoffMs: number;
  };
  preflight: {
    modules: string[];
    strict: boolean;
  };
  validation: {
    mode: 'zod' | 'ajv' | string;
  };
  dynamic: {
    /** Reserved spots for modules that accept runtime-provided env keys */
    dashboardConfig: Record<string, string>;
    apiIntegration: Record<string, string>;
  };
}
```

> **Note:** The interface above illustrates the target namespace. We do not need to implement everything up front; the migration can proceed incrementally, populating each group as the associated module is refactored.

## Variable-by-module mapping

| Module | Environment variables | Proposed config path | Type / default | Notes |
| --- | --- | --- | --- | --- |
| `dashboard/server/AdminPanel.ts` | `INDEX_SERVER_ADMIN_MAX_SESSION_HISTORY`, `INDEX_SERVER_BACKUPS_DIR`, `INDEX_SERVER_DIR`, `INDEX_SERVER_MAX_CONNECTIONS`, `INDEX_SERVER_REQUEST_TIMEOUT`, `INDEX_SERVER_VERBOSE_LOGGING`, `INDEX_SERVER_MUTATION`, `INDEX_SERVER_MUTATION` | `dashboard.admin.maxSessionHistory`, `dashboard.admin.backupsDir`, `Index.baseDir`, `dashboard.http.maxConnections`, `dashboard.http.requestTimeoutMs`, `dashboard.http.verboseLogging`, `instructions.mutationEnabledLegacy` | numbers / booleans / strings with existing fallbacks | Ensure mutation toggle mirrors overall mutation enablement in `mutation.enabled`. |
| `dashboard/server/ApiRoutes.ts` | `INDEX_SERVER_HTTP_METRICS`, `INDEX_SERVER_HEALTH_MEMORY_THRESHOLD`, `INDEX_SERVER_HEALTH_ERROR_THRESHOLD`, `INDEX_SERVER_HEALTH_MIN_UPTIME`, `INDEX_SERVER_DIR`, `INDEX_SERVER_LOG_FILE`, `INDEX_SERVER_DEBUG` | `dashboard.http.enableHttpMetrics`, `metrics.health.memoryThreshold`, `metrics.health.errorThreshold`, `metrics.health.minUptimeMs`, `Index.baseDir`, `logging.fileTarget`, `logging.verbose` | types align with existing parse usage | Introduce new health-specific sub-object under `metrics` for clarity. |
| `dashboard/server/MetricsCollector.ts` | `INDEX_SERVER_RESOURCE_CAPACITY`, `INDEX_SERVER_RESOURCE_SAMPLE_INTERVAL_MS`, `INDEX_SERVER_METRICS_DIR`, `INDEX_SERVER_TOOLCALL_CHUNK_SIZE`, `INDEX_SERVER_TOOLCALL_FLUSH_MS`, `INDEX_SERVER_TOOLCALL_COMPACT_MS` | `metrics.resourceCapacity`, `metrics.sampleIntervalMs`, `metrics.dir`, `metrics.toolcall.chunkSize`, `metrics.toolcall.flushMs`, `metrics.toolcall.compactMs` | integers | Defaults continue to mirror hard-coded values. |
| `dashboard/server/SessionPersistenceManager.ts` | computed enum keys (e.g., `SESSION_PERSISTENCE_*`) | `dashboard.sessionPersistence.*` | boolean/number/string | Add helper to resolve keys from config rather than indexing into `process.env`. |
| `dashboard/server/WebSocketManager.ts` | `INDEX_SERVER_DEBUG`, `INDEX_SERVER_VERBOSE_LOGGING` | `logging.verbose` | boolean | Share with other verbose logging checks. |
| `server/index-server.ts` | `INDEX_SERVER_DISABLE_EARLY_STDIN_BUFFER`, `INDEX_SERVER_FATAL_EXIT_DELAY_MS`, `INDEX_SERVER_DASHBOARD`, `INDEX_SERVER_DASHBOARD_PORT`, `INDEX_SERVER_DASHBOARD_HOST`, `INDEX_SERVER_DASHBOARD_TRIES`, `INDEX_SERVER_MUTATION`, `INDEX_SERVER_MUTATION`, `INDEX_SERVER_BOOTSTRAP_AUTOCONFIRM`, `INDEX_SERVER_ENABLE_INDEX_SERVER_POLLER`, `INDEX_SERVER_POLL_PROACTIVE`, `INDEX_SERVER_IDLE_KEEPALIVE_MS`, `INDEX_SERVER_LOG_FILE`, `INDEX_SERVER_SHARED_SERVER_SENTINEL`, `MULTICLIENT_TRACE` | `server.disableEarlyStdinBuffer`, `server.fatalExitDelayMs`, `dashboard.http.enable`, `dashboard.http.port`, `dashboard.http.host`, `dashboard.http.maxPortTries`, `mutation.enabled`, `mutation.legacyEnable`, `server.bootstrap.autoconfirm`, `server.IndexPolling.enabled`, `server.IndexPolling.proactive`, `server.idleKeepaliveMs`, `logging.fileTarget`, `server.sharedSentinel`, `server.multicoreTrace` | boolean/number/string | `mutation.legacyEnable` feeds deprecation warning; prefer `mutation.enabled`. |
| `server/sdkServer.ts` | handshake / diag toggles (`INDEX_SERVER_TRACE=handshake`, `INDEX_SERVER_TRACE=healthMixed`, etc.) | `tracing.handshake`, `tracing.healthMixedDiag`, `tracing.initFallbackAllow`, `tracing.initFrameDiag` | boolean | Extend `tracing` group with feature-specific flags. |
| `services/IndexContext.ts` | `INDEX_SERVER_DIR`, `INDEX_SERVER_POLL_MS`, `INDEX_SERVER_POLL_PROACTIVE`, `INDEX_SERVER_USAGE_FLUSH_MS`, `INDEX_SERVER_DISABLE_USAGE_CLAMP`, `GOV_HASH_TRAILING_NEWLINE` | `Index.baseDir`, `server.IndexPolling.intervalMs`, `server.IndexPolling.proactive`, `Index.usageFlushMs`, `Index.disableUsageClamp`, `Index.govHash.trailingNewline` | string/number/boolean | `Index.baseDir` will be shared with dashboard/admin. |
| `services/IndexLoader.ts` | `INDEX_SERVER_ALWAYS_RELOAD`, `INDEX_SERVER_MEMOIZE`, `INDEX_SERVER_MEMOIZE_HASH`, `INDEX_SERVER_NORMALIZATION_LOG`, `INDEX_SERVER_FILE_TRACE`, `INDEX_SERVER_EVENT_SILENT`, `INDEX_SERVER_READ_RETRIES`, `INDEX_SERVER_READ_BACKOFF_MS` | `Index.reloadAlways`, `Index.memoize`, `Index.memoizeHash`, `Index.normalizationLog`, `Index.fileTrace`, `Index.eventSilent`, `Index.readRetries.attempts`, `Index.readRetries.backoffMs` | boolean/string/number | Defaults align with status quo. |
| `services/featureFlags.ts` | `INDEX_SERVER_FLAGS_FILE` and generic `process.env` iteration | `featureFlags.file`, `featureFlags.envNamespace` | string / record | Provide filtered view of env for features rather than raw `process.env`. |
| `services/features.ts` | `INDEX_SERVER_FEATURES` | `featureFlags.indexFeatures` | `Set<string>` | Align with configuration collection. |
| `services/handlers.feedback.ts` | `INDEX_SERVER_FEEDBACK_DIR`, `INDEX_SERVER_FEEDBACK_MAX_ENTRIES` | `feedback.dir`, `feedback.maxEntries` | string/number | ✅ DONE — Uses `getRuntimeConfig().feedback.*`. |
| `services/handlers.graph.ts` | ~~`GRAPH_INCLUDE_PRIMARY_EDGES`~~, ~~`GRAPH_LARGE_CATEGORY_CAP`~~ → `INDEX_SERVER_GRAPH_INCLUDE_PRIMARY_EDGES`, `INDEX_SERVER_GRAPH_LARGE_CATEGORY_CAP`, dynamic lookups | `graph.includePrimaryEdges`, `graph.largeCategoryCap`, `dynamic.dashboardConfig` | boolean/number | ✅ DONE — Config parser reads new prefixed names only. |
| `services/handlers.instructions.ts` | `INDEX_SERVER_AGENT_ID`, `WORKSPACE_ID`, `INDEX_SERVER_WORKSPACE`, `INDEX_SERVER_CANONICAL_DISABLE`, `INDEX_SERVER_REQUIRE_CATEGORY`, `INDEX_SERVER_STRICT_*`, `INDEX_SERVER_TEST_STRICT_VISIBILITY`, `INDEX_SERVER_TRACE_QUERY_DIAG`, `INDEX_SERVER_MANIFEST_WRITE`, `CI`, `GITHUB_ACTIONS`, `TF_BUILD`, `INDEX_SERVER_MUTATION`, `INDEX_SERVER_MUTATION` | `instructions.agentId`, `instructions.workspaceId`, `instructions.canonicalDisable`, `instructions.requireCategory`, `instructions.strictCreate`, `instructions.strictRemove`, `instructions.strictVisibility`, `instructions.traceQueryDiag`, `instructions.manifest.writeEnabled`, `instructions.ciContext`, `mutation.enabled` | boolean/string | Provide aggregated `ciContext` structure and reuse `mutation.enabled`. |
| `services/instructions.dispatcher.ts` | `INDEX_SERVER_MUTATION`, `INDEX_SERVER_ADD_TIMING`, `INDEX_SERVER_VERBOSE_LOGGING`, `INDEX_SERVER_TRACE=dispatchDiag`, `npm_package_version` | `mutation.enabled`, `mutation.dispatcherTiming`, `logging.verbose`, `tracing.dispatchDiag`, `app.version` | boolean/string | `app.version` can come from package metadata once in config. |
| `services/logger.ts` | `INDEX_SERVER_LOG_FILE`, `INDEX_SERVER_LOG_JSON`, `INDEX_SERVER_LOG_SYNC` | `logging.fileTarget`, `logging.json`, `logging.sync` | string/boolean | Consolidated logging group shared across modules. |
| `services/manifestManager.ts` | `INDEX_SERVER_MANIFEST_WRITE`, `INDEX_SERVER_MANIFEST_FASTLOAD` | `instructions.manifest.writeEnabled`, `instructions.manifest.fastload` | boolean | ✅ DONE — Uses `getRuntimeConfig().instructions.manifest.*`. |
| `services/preflight.ts` | `INDEX_SERVER_PREFLIGHT_MODULES`, `INDEX_SERVER_PREFLIGHT_STRICT` | `preflight.modules`, `preflight.strict` | string[]/boolean | Modules produced by splitting the comma list. |
| `services/seedBootstrap.ts` | `INDEX_SERVER_AUTO_SEED`, `INDEX_SERVER_SEED_VERBOSE` | `bootstrapSeed.autoSeed`, `bootstrapSeed.verbose` | boolean | ✅ DONE — Uses `getRuntimeConfig().bootstrapSeed.*`. |
| `services/atomicFs.ts` | `INDEX_SERVER_ATOMIC_WRITE_RETRIES`, `INDEX_SERVER_ATOMIC_WRITE_BACKOFF_MS` | `atomicFs.retries`, `atomicFs.backoffMs` | number | Used by atomic write helper. |
| `services/tracing.ts` | `INDEX_SERVER_TRACE_*`, `INDEX_SERVER_TRACE_DIR`, `INDEX_SERVER_TRACE_FILE`, `INDEX_SERVER_TRACE_BUFFER_*`, `INDEX_SERVER_TRACE_LEVEL`, `INDEX_SERVER_TRACE_MAX_FILE_SIZE`, `INDEX_SERVER_TRACE_SESSION`, `INDEX_SERVER_TRACE_SESSION`, `INDEX_SERVER_TRACE_CALLSITE`, `INDEX_SERVER_TRACE_PERSIST`, `INDEX_SERVER_TRACE_FSYNC` | `tracing.*` | mixed | Entire tracing subsystem collapses under the `tracing` object. |
| `utils/BufferRing.ts` | ~~`BUFFER_RING_APPEND`~~, ~~`BUFFER_RING_APPEND_PRELOAD`~~ → `INDEX_SERVER_BUFFER_RING_APPEND`, `INDEX_SERVER_BUFFER_RING_PRELOAD` | `bufferRing.append`, `bufferRing.preload` | boolean | ✅ DONE — Uses `getRuntimeConfig().bufferRing.*`. |
| `utils/memoryMonitor.ts` | `INDEX_SERVER_DEBUG`, `INDEX_SERVER_VERBOSE_LOGGING` | `logging.verbose` | boolean | Maintain parity with other logging consumers. |
| `utils/envUtils.ts`, `dashboard/integration/APIIntegration.ts`, `handlers.dashboardConfig.ts` | dynamic string lookups | `dynamic.dashboardConfig`, `dynamic.apiIntegration` (string-to-string map) | object | Provide controlled map populated from explicit allowlists to retain flexibility without raw env access. |

## Handling dynamic access patterns

Some modules (notably `APIIntegration`, `SessionPersistenceManager`, and `handlers.dashboardConfig`) rely on dynamic environment variable keys determined at runtime.

To manage these safely:

- **Define allowlists**: Introduce arrays of supported keys within each module and populate the `dynamic.*` map during config loading. If a key is missing, the module receives `undefined` instead of querying `process.env` directly.
- **Expose helper getters**: Add utility functions such as `getDashboardEnv(key)` that read from `runtimeConfig.dynamic.dashboardConfig` so the guard script can exempt these access patterns.
- **Document extension points**: Update README/operations docs to clarify how operators can extend the allowlists when new dynamic keys are required.

## TODOs for implementation

1. Extend `RuntimeConfig` and its loader to include the proposed groups. Start with the highest-impact areas (dashboard + server core) to unblock the guard.
2. For each module, replace direct `process.env` reads with config consumption.
3. Create shims (e.g., `getTracingConfig()`, `getIndexConfig()`) in heavily used domains to keep call sites concise and typed.
4. Update tests to configure behavior via helper factories or temporary environment overrides that rebuild the config (using `reloadRuntimeConfig()` when needed).
5. Once migration is complete, tighten the guard allowlist again and document the supported configuration surface in `README.md` / `DEPLOYMENT.md`.

## Rollout plan

### Phase 0 – groundwork (1 PR)

- Add typed namespaces in `RuntimeConfig` and rework `loadRuntimeConfig()` to populate **read-only** structures without touching call sites yet.
- Introduce domain helpers (`getDashboardConfig()`, `getTracingConfig()`, etc.) that wrap `getRuntimeConfig()` so downstream files can migrate incrementally.
- Update guard allowlist to permit the new helper modules.
- Regression: `npm run build:verify` (guards still fail due to existing env reads – expected during this phase).

### Phase 1 – server + logging core (1–2 PRs)

- Refactor `src/server/index-server.ts`, `src/server/registry.ts`, `src/server/sdkServer.ts`, `src/server/transport.ts`, and `src/services/logger.ts` to consume the new helpers.
- Remove direct `process.env` reads in the server bootstrap path; reload config when mutation toggles flip.
- Adjust related unit tests (`serverIndex.p1`, `sdkServer.handshake`) to set config via environment setup + `reloadRuntimeConfig()`.
- Validate with `npm run build:verify`; guard count should drop significantly.

### Phase 2 – dashboard surface (1 PR)

- Migrate `dashboard/server/*` modules to the dashboard helper, including session persistence and admin panels.
- Replace dynamic env keys by explicit allowlists in `SessionPersistenceManager` and `dashboardConfig` handler, wiring through `runtimeConfig.dynamic.dashboardConfig`.
- Add targeted Vitest coverage for admin settings mutations.
- Run `npm run build:verify` and `npm run test -- dashboard/server` (subset) to confirm behavior.

### Phase 3 – Index & instructions services (2 PRs)

- Refactor `IndexContext.ts`, `IndexLoader.ts`, `handlers.instructions.ts`, `instructions.dispatcher.ts`, and `manifestManager.ts` to use Index/instructions namespaces.
- Implement structured `ciContext` detection to replace scattered `CI`/`TF_BUILD` checks.
- Update persistence/instructions tests (parked suites) to configure directories via config.
- Guards should be near-zero after this phase; any remaining direct env reads should be documented dynamic cases.

### Phase 4 – tracing, metrics, utilities (1 PR)

- Consolidate `services/tracing.ts`, `services/metricsCollector.ts`, `utils/BufferRing.ts`, and `utils/memoryMonitor.ts` onto the new config.
- Ensure tracing helpers use the canonical `INDEX_SERVER_*` prefixed variables.
- Add small smoke test covering trace buffer configuration.
- `npm run build:verify` expected to pass without guard failures.

### Phase 5 – cleanup and documentation (1 PR)

- Tighten `scripts/enforce-config-usage.ts` allowlist to remove temporary exemptions.
- Update `README.md`, `DEPLOYMENT.md`, and example configuration files to highlight the new config surface.
- Remove any unused env variables from CI workflows.
- Final run: `npm run build:verify`, `npm run test`, optional `npm run test:contracts`.

### Cross-cutting tasks

- Add a lightweight test helper to reset config between suites to avoid leakage.
- Provide migration guidance in `docs/DEPLOYMENT.md` for operators using the old environment flags.
- Monitor for performance regressions during each phase by comparing `npm run build:verify` durations and logs.

This mapping should give us a clear blueprint for the upcoming refactor work and provide traceability for reviewers verifying the guard passes.
