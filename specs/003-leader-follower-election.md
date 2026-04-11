# Index: Leader/Follower Architecture Spec

> **Status: EXPERIMENTAL** — This feature is under active development. APIs, configuration, and behavior may change without notice. Use `INDEX_SERVER_MODE=standalone` (default) for production workloads.

## Problem Statement

A single user running 10+ VS Code Insiders instances, each configured with Index, spawns 10+ independent Node.js processes. Squad sub-agents further multiply this — easily 20+ Index stdio instances running simultaneously. Every instance:

- Allocates ~40-60 MB V8 heap (total: 800 MB - 1.2 GB)
- Loads a full copy of the same instruction Index into memory
- Maintains independent usage tracking maps
- Performs concurrent directory scans against the same `INDEX_SERVER_DIR`
- Writes to the same `usage-snapshot.json` without file locks (last-writer-wins data loss)
- Races on `.Index-version` token writes

## Design: Symmetric Leader Election via Port Binding

Every Index instance is identical. On startup, each instance attempts to become the leader. There is no separate binary, no follower-specific entry point, no external orchestrator.

### Startup Sequence

```
1. Parse env / CLI args as normal
2. Attempt to bind leader port (default: INDEX_SERVER_LEADER_PORT ?? 8399)
   ├─ listen() succeeds → LEADER MODE
   │   ├─ Load Index from disk (full startup as today)
   │   ├─ Start HTTP API for follower RPCs
   │   ├─ Start stdio MCP transport (serve the spawning client)
   │   └─ Write leader port file: <INDEX_SERVER_STATE_DIR>/leader-<pid>.json
   │
   └─ listen() fails (EADDRINUSE) → FOLLOWER MODE
       ├─ Connect to leader HTTP API
       ├─ Health-check the leader (GET /leader/health)
       │   ├─ Healthy → run as follower (thin proxy)
       │   └─ Unhealthy/unreachable → retry election (go to step 2)
       ├─ Start stdio MCP transport (serve the spawning client)
       └─ Proxy all tool calls to leader via HTTP
```

### Leader Responsibilities

- Owns all disk I/O (Index load, mutations, usage snapshots, backups)
- Serves the MCP stdio protocol to its own spawning client (VS Code / Copilot)
- Exposes HTTP API on `INDEX_SERVER_LEADER_PORT` for follower RPCs
- Maintains single-writer semantics for all state
- Broadcasts Index version changes to connected followers (optional optimization)

### Follower Responsibilities

- Speaks MCP stdio protocol to its spawning client (identical tool surface)
- Proxies every tool call to leader via HTTP POST `/leader/tools/call`
- No Index in memory, no disk access, no usage maps
- Monitors leader health via periodic heartbeat (every 2s)
- On leader loss: attempts re-election (see Failover)

### Leader HTTP API (internal, localhost-only)

```
POST /leader/tools/call
  Body: { "name": "instructions_search", "arguments": {...} }
  Response: { "content": [...] }  (standard MCP tool result)

GET  /leader/health
  Response: { "status": "ok", "pid": 1234, "uptime": 3600, "index_version": "abc123" }

GET  /leader/info
  Response: { "pid": 1234, "port": 8399, "follower_count": 5, "index_entries": 150 }
```

This is intentionally minimal. The leader's existing tool registry handles dispatch — the HTTP layer is just a transport shim over `getHandler(name)(args)`.

### Leader Port File

Written to `<INDEX_SERVER_STATE_DIR>/leader-<pid>.json`:
```json
{
  "pid": 1234,
  "port": 8399,
  "startedAt": "2026-03-13T15:00:00.000Z"
}
```

Used by followers for fast leader discovery (avoids blind port probing). Cleaned up on graceful shutdown. Stale files detected via signal-0 PID check.

## Failover: Follower Self-Promotion

### Trigger

A follower detects leader loss when:
1. **Tool call fails**: HTTP request to leader returns `ECONNREFUSED` / `ECONNRESET` / timeout
2. **Heartbeat fails**: 3 consecutive heartbeat misses (~6s)

### Sequence

```
Follower detects leader gone
  │
  ├─ 1. Delete stale leader port file (if PID is dead, signal-0 check)
  ├─ 2. Attempt listen() on INDEX_SERVER_LEADER_PORT
  │     ├─ Succeeds → PROMOTE TO LEADER
  │     │   ├─ Load Index from disk (~200-300ms)
  │     │   ├─ Write new leader port file
  │     │   ├─ Start serving follower RPCs
  │     │   └─ Resume serving own stdio client (queued calls retry)
  │     │
  │     └─ Fails (EADDRINUSE) → ANOTHER FOLLOWER WON
  │         └─ Reconnect to new leader (read port file or probe port)
  │
  └─ 3. Retry in-flight tool calls against new leader (up to 3 attempts, 100ms backoff)
```

### Timing Budget

| Phase | Duration | Notes |
|-------|----------|-------|
| Leader death detection | 2-6s | Heartbeat miss × 3, or immediate on tool call failure |
| Stale PID cleanup | <10ms | signal-0 check + unlink |
| Port bind attempt | <5ms | OS-level, atomic |
| Index cold load | 200-300ms | Directory scan + JSON parse |
| Follower reconnection | 100-500ms | Port file read + health check |
| **Total failover window** | **~0.5-7s** | Depends on detection trigger |

During the failover window, follower tool calls queue and retry. No MCP client (VS Code / Copilot) would timeout — the MCP protocol has no sub-second timeout expectations for tool calls.

### Split-Brain Prevention

- Only one process can `listen()` on a port — OS-enforced mutex
- No consensus needed — first to bind wins
- If two followers try simultaneously, exactly one succeeds
- Port file is written _after_ successful bind (never stale on write)
- Followers always verify leader health before entering follower mode

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `INDEX_SERVER_LEADER_PORT` | `8399` | TCP port for leader HTTP API |
| `INDEX_SERVER_LEADER_HOST` | `127.0.0.1` | Bind address (always localhost) |
| `INDEX_SERVER_MODE` | `auto` | `auto` (election), `leader` (force), `follower` (force), `standalone` (today's behavior) |
| `INDEX_SERVER_FOLLOWER_HEARTBEAT_MS` | `2000` | Heartbeat interval |
| `INDEX_SERVER_FOLLOWER_HEARTBEAT_MISSES` | `3` | Missed heartbeats before failover |
| `INDEX_SERVER_FOLLOWER_RETRY_ATTEMPTS` | `3` | Tool call retry attempts on leader failure |
| `INDEX_SERVER_FOLLOWER_RETRY_BACKOFF_MS` | `100` | Base backoff between retries |
| `INDEX_SERVER_LEADER_REQUEST_TIMEOUT_MS` | `30000` | Timeout for proxied tool calls |

### Backward Compatibility

- `INDEX_SERVER_MODE=standalone` preserves today's behavior exactly (no election, no HTTP API)
- Default `INDEX_SERVER_MODE=auto` is the new behavior
- All existing env vars (`INDEX_SERVER_DIR`, `INDEX_SERVER_STATE_DIR`, etc.) work unchanged
- The MCP stdio protocol surface is identical — clients cannot tell leader from follower
- Dashboard (port 8787) continues to work on the leader only

## Resource Impact

| Scenario | Memory | Processes | Disk Writers |
|----------|--------|-----------|--------------|
| Today: 20 standalone instances | ~1 GB | 20 Node.js | 20 concurrent |
| Leader/follower: 1 leader + 19 followers | ~150 MB | 20 Node.js (19 thin) | 1 |
| Savings | **~85%** | same count | **single-writer** |

Follower process footprint: Node.js base (~25-30 MB) + HTTP client + stdio transport. No Index, no usage maps, no file watchers.

## Module Structure (in Index)

```
src/
├── server/
│   ├── index.ts              # Modified: add election logic at startup
│   ├── leaderServer.ts       # NEW: HTTP API server for follower RPCs
│   ├── followerProxy.ts      # NEW: HTTP client that proxies tool calls to leader
│   ├── election.ts           # NEW: port-bind election + failover + heartbeat
│   ├── leaderPortFile.ts     # NEW: leader port file read/write/cleanup
│   └── sdkServer.ts          # Unchanged: stdio MCP transport
├── services/
│   └── (unchanged)           # Index, handlers — only leader loads these
└── dashboard/
    └── (unchanged)           # Only runs on leader
```

## E2E Test Matrix

### Test Infrastructure

- **Framework**: Vitest (existing)
- **Pattern**: Spawn real server processes via `child_process.spawn`, communicate via stdio (MCP JSON-RPC) and HTTP (leader API)
- **Isolation**: Each test gets a unique `INDEX_SERVER_LEADER_PORT` (random high port) and temp `INDEX_SERVER_DIR`
- **Helpers**: Extend existing `mcpTestClient.js` with multi-instance orchestration

### Category 1: Election & Startup

| ID | Test | Steps | Assertion |
|----|------|-------|-----------|
| E1.1 | First instance becomes leader | Spawn 1 instance with `INDEX_SERVER_MODE=auto` | Instance binds leader port, writes port file, tools/list returns full tool set |
| E1.2 | Second instance becomes follower | Spawn 2 instances sequentially | First is leader (port file exists), second connects as follower, both return identical tools/list |
| E1.3 | Concurrent startup (5 instances) | Spawn 5 instances simultaneously | Exactly 1 leader (port file), 4 followers. All 5 respond to tools/list |
| E1.4 | Concurrent startup (20 instances) | Spawn 20 instances simultaneously | Exactly 1 leader, 19 followers. All respond to tools/list within 10s |
| E1.5 | Forced leader mode | Spawn with `INDEX_SERVER_MODE=leader` | Binds port, becomes leader. If port taken, exit with error (not fallback to follower) |
| E1.6 | Forced follower mode | Spawn with `INDEX_SERVER_MODE=follower`, no leader running | Retries connection, eventually errors (configurable timeout) |
| E1.7 | Standalone mode (backward compat) | Spawn with `INDEX_SERVER_MODE=standalone` | No election, no HTTP API, full standalone behavior identical to today |
| E1.8 | Custom leader port | Spawn with `INDEX_SERVER_LEADER_PORT=9999` | Leader binds 9999, follower connects to 9999 |
| E1.9 | Port file stale cleanup | Write port file with dead PID, spawn new instance | New instance detects stale PID (signal-0), deletes file, becomes leader |
| E1.10 | Leader port occupied by non-leader | External process on INDEX_SERVER_LEADER_PORT, spawn instance | Detects port in use but health check fails → retries after backoff, or falls back to standalone |

### Category 2: Tool Call Proxying (Reads)

| ID | Test | Steps | Assertion |
|----|------|-------|-----------|
| E2.1 | Follower search returns same results as leader | Add instruction via leader, search from both | Identical results from leader stdio and follower stdio |
| E2.2 | Follower instructions_dispatch list | Call `instructions_dispatch { action: "list" }` via follower | Returns same Index as leader |
| E2.3 | Follower instructions_dispatch get | Get specific instruction by ID via follower | Returns correct instruction with full body |
| E2.4 | Follower instructions_dispatch query | Full-text query via follower | Results match leader |
| E2.5 | Follower instructions_dispatch categories | Get categories via follower | Matches leader |
| E2.6 | Follower graph_export | Export graph via follower | Matches leader output |
| E2.7 | Follower usage_hotset | Get hot set via follower | Matches leader |
| E2.8 | Follower health_check | health_check tool via follower | Returns healthy status |
| E2.9 | Follower instructions_search (keyword) | Search by keywords via follower | Matches leader results |
| E2.10 | Follower instructions_dispatch diff | Diff with client hash via follower | Correct diff returned |
| E2.11 | All 51 tools callable via follower | Iterate every registered tool name | Each returns valid response (not "unknown tool") |

### Category 3: Tool Call Proxying (Mutations)

| ID | Test | Steps | Assertion |
|----|------|-------|-----------|
| E3.1 | Follower add instruction | Add via follower stdio → leader persists to disk | File appears in INDEX_SERVER_DIR, both leader and other followers see it |
| E3.2 | Follower remove instruction | Remove via follower | File deleted from disk, Index updated across all instances |
| E3.3 | Follower import (bulk) | Import 50 instructions via follower | All 50 persisted, all instances see them |
| E3.4 | Follower groom | Trigger groom via follower | Groom executes on leader, results returned to follower |
| E3.5 | Follower governance update | Update governance via follower | Persisted on leader, version bumped |
| E3.6 | Follower usage_track | Track usage via follower | Usage counter incremented on leader, visible in hotset |
| E3.7 | Follower promote_from_repo | Promote via follower | Promotion runs on leader, new entries visible |
| E3.8 | Concurrent mutations from 5 followers | 5 followers each add different instructions simultaneously | All 5 persisted, no data loss, Index consistent |
| E3.9 | Mutation during leader Index reload | Trigger reload + add simultaneously | Both complete without corruption |
| E3.10 | Follower normalize | Normalize via follower | Executes on leader, files updated on disk |

### Category 4: Failover — Leader Death & Re-Election

| ID | Test | Steps | Assertion |
|----|------|-------|-----------|
| E4.1 | Leader killed, single follower promotes | Start leader + 1 follower. Kill leader (SIGKILL). | Follower detects loss, promotes to leader within 7s, responds to tools/list |
| E4.2 | Leader killed, first of 5 followers promotes | Start leader + 5 followers. Kill leader. | Exactly 1 follower promotes, other 4 reconnect to it. All 5 respond to tools/list |
| E4.3 | Promoted leader has full Index | Leader has 50 instructions. Kill leader. Follower promotes. | New leader returns all 50 instructions on search |
| E4.4 | In-flight tool call survives failover | Follower sends slow tool call, leader dies mid-call | Follower retries against new leader, call eventually succeeds |
| E4.5 | Rapid leader cycling (kill 3 leaders) | Start 5 instances. Kill current leader 3 times. | Each time a new leader is elected. After 3 kills, 2 remaining instances both work |
| E4.6 | Follower mutation survives failover | Follower sends add, leader dies before response | Follower retries add against new leader. Instruction either persisted by old leader or re-added by new one. No duplicate (idempotent by ID) |
| E4.7 | Failover timing under load | 10 followers sending continuous reads. Kill leader. | Measure: time to first successful response from new leader. Assert < 10s |
| E4.8 | Graceful leader shutdown | Leader exits via SIGINT (not SIGKILL) | Port file cleaned up. Follower detects immediately (connection close), promotes faster |
| E4.9 | Leader crash (unhandled exception) | Inject fatal error in leader | Followers detect via heartbeat, promote. Port file left stale → cleaned by signal-0 |
| E4.10 | All instances killed, fresh start | Kill all 20 instances. Start 1 new instance. | New instance becomes leader (no stale port files after PID check), full Index available |

### Category 5: Consistency & Data Integrity

| ID | Test | Steps | Assertion |
|----|------|-------|-----------|
| E5.1 | Index consistency across instances | Add 100 instructions via leader. Query from 10 followers. | All 10 return identical results |
| E5.2 | Usage tracking aggregation | 5 followers each call usage_track on same instruction | Leader's usage count = 5 (not 1 or 25) |
| E5.3 | No stale reads after mutation | Add instruction via follower A. Immediately read from follower B. | Follower B sees the new instruction (leader is single source of truth) |
| E5.4 | Index hash consistency | Get governance hash from leader and all followers | All return identical hash |
| E5.5 | Post-failover data integrity | Add 50 instructions. Kill leader. New leader promotes. Add 50 more. | All 100 instructions present and intact |
| E5.6 | Usage snapshot survives failover | Track usage on 10 instructions. Kill leader. New leader loads snapshot. | Usage counts preserved (flushed to disk before death or on graceful shutdown) |
| E5.7 | No duplicate writes | 5 followers simultaneously add same instruction ID | Exactly 1 version on disk (last write wins or conflict error, not 5 files) |
| E5.8 | Standalone instances don't interfere | 1 leader + 2 followers + 1 standalone (`INDEX_SERVER_MODE=standalone`) | Standalone has own Index copy, leader/followers have theirs. No cross-contamination |

### Category 6: Performance & Resource Validation

| ID | Test | Steps | Assertion |
|----|------|-------|-----------|
| E6.1 | Follower memory footprint | Start 1 leader + 1 follower with 500-instruction Index | Follower RSS < 40 MB, leader RSS > follower RSS |
| E6.2 | Follower startup time | Measure time from spawn to first successful tool call (follower) | < 2s (no Index load) |
| E6.3 | Leader startup time | Measure time from spawn to first successful tool call (leader) | < 5s (includes Index load) |
| E6.4 | Proxied tool call latency | Measure round-trip: follower stdio → leader HTTP → response | < 100ms for reads, < 500ms for mutations |
| E6.5 | 20 concurrent followers throughput | 20 followers each send 10 search requests | All 200 requests complete within 30s, no errors |
| E6.6 | Leader CPU under follower load | 10 followers sending 1 request/second each | Leader CPU < 50% sustained |
| E6.7 | No file descriptor leaks | Run 100 tool calls through follower proxy | Leader fd count stable (±5) |
| E6.8 | Graceful degradation under overload | 50 followers (extreme), each sending requests | Leader returns 429 or queues; no crash, no OOM |

### Category 7: Edge Cases & Error Handling

| ID | Test | Steps | Assertion |
|----|------|-------|-----------|
| E7.1 | Leader port in use by foreign process | Start non-MCP process on INDEX_SERVER_LEADER_PORT, then start instance | Health check fails → instance retries or starts standalone. Clear error logged |
| E7.2 | Network interface unavailable | Start with INDEX_SERVER_LEADER_HOST pointing to non-existent interface | Clear error, falls back to standalone |
| E7.3 | Follower connects before leader is ready | Start follower, then leader 2s later | Follower retries connection, eventually connects |
| E7.4 | Leader disk full during mutation | Fill disk, attempt add via follower | Leader returns error to follower, follower relays to client. No crash |
| E7.5 | Corrupt leader port file | Write garbage to leader port file, start new instance | Instance ignores corrupt file, attempts election normally |
| E7.6 | Leader process frozen (not dead) | Suspend leader process (SIGSTOP equivalent) | Followers detect via heartbeat timeout, but cannot bind port (leader still holds it). Clear error state, retry loop |
| E7.7 | Clock skew between instances | Follower system clock 5 minutes ahead | No impact (timestamps are informational, not used for election) |
| E7.8 | Very large tool response (>1MB) | Search returning 1000 instructions via follower proxy | HTTP chunked transfer works, full response received |
| E7.9 | Follower disconnect and reconnect | Kill follower network briefly, restore | Follower reconnects to leader, resumes normal operation |
| E7.10 | INDEX_SERVER_DIR changes at runtime | Change env var and call instructions_reload via follower | Leader reloads from new directory, all followers see updated Index |

### Category 8: Configuration Combinations

| ID | Test | Steps | Assertion |
|----|------|-------|-----------|
| E8.1 | INDEX_SERVER_MODE=auto (default) | Start 3 instances, no explicit mode | 1 leader + 2 followers (auto-elected) |
| E8.2 | INDEX_SERVER_MODE=leader + INDEX_SERVER_MODE=follower | Start 1 explicit leader, 1 explicit follower | Leader binds port, follower connects. No election needed |
| E8.3 | INDEX_SERVER_MODE=leader + INDEX_SERVER_MODE=leader | Start 2 explicit leaders on same port | Second leader fails to bind, exits with error (not silent fallback) |
| E8.4 | INDEX_SERVER_MODE=standalone × 5 | Start 5 standalone instances | No election, no HTTP API, all independent (today's behavior) |
| E8.5 | Mixed: 1 leader + 2 auto + 2 standalone | Start 5 instances with mixed modes | Leader serves 2 auto-followers. 2 standalone are independent |
| E8.6 | Dashboard on leader only | Start leader + follower, both with INDEX_SERVER_DASHBOARD=1 | Only leader serves dashboard. Follower skips dashboard startup |
| E8.7 | Custom heartbeat timing | Set INDEX_SERVER_FOLLOWER_HEARTBEAT_MS=500, MISSES=2 | Failover detected in ~1s instead of ~6s |
| E8.8 | INDEX_SERVER_LEADER_REQUEST_TIMEOUT_MS | Set to 1000ms, trigger slow tool (>1s) | Follower receives timeout error, relays to client |

## Implementation Notes

### What changes in existing code

1. **`index.ts` (entry point)**: After config parsing, before `startSdkServer()`, insert election logic. If follower, skip Index load and wire tool handlers to proxy.

2. **`sdkServer.ts`**: No changes. Stdio transport works identically for both modes — the handler functions are what differ (real handlers vs proxy).

3. **`toolHandlers.ts` / `registry.ts`**: No changes to handler implementations. In follower mode, the registry is populated with proxy stubs instead of real handlers.

4. **`IndexContext.ts`**: No changes. Only loaded by leader.

5. **Dashboard**: No changes. Conditionally started only in leader mode (already optional).

### What's new

- `election.ts`: ~150 lines — port bind attempt, port file management, mode resolution
- `leaderServer.ts`: ~100 lines — Express app with `/leader/tools/call`, `/leader/health`
- `followerProxy.ts`: ~120 lines — HTTP client, heartbeat loop, retry logic, re-election trigger
- `leaderPortFile.ts`: ~50 lines — read/write/cleanup port file with PID validation

**Total new code: ~420 lines** plus tests.

### Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Port conflict with other software | Low | Configurable port + clear error message |
| Follower promotion during heavy writes | Low | Index load is read-only; writes queue on new leader |
| Windows-specific socket behavior | Medium | Test on Windows; `listen()` semantics are consistent across platforms |
| Antivirus blocking localhost connections | Low | Document; INDEX_SERVER_MODE=standalone as escape hatch |
| Process zombie prevents port reuse | Medium | Signal-0 PID check + `SO_REUSEADDR` on leader socket |
