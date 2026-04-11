# Multi-Instance Design: Standalone & Leader/Follower Modes

> **Status: EXPERIMENTAL** — Leader/follower mode is under active development. Standalone mode is the production default.

## Overview

the index supports two operational modes for multi-instance environments where many VS Code windows, Copilot Chat sessions, or Squad agents each spawn their own Index process.

| Mode | Description | Maturity |
|------|-------------|----------|
| **Standalone** | Each instance is independent — full Index, full I/O, full memory. Default. | Production |
| **Leader/Follower** | One leader owns Index + disk I/O; followers proxy via HTTP. | Experimental |

## Mode Selection

```
INDEX_SERVER_MODE=standalone   →  Independent instance (default, production)
INDEX_SERVER_MODE=auto         →  Attempt leader election; fallback to follower
INDEX_SERVER_MODE=leader       →  Force leader role (error if port taken)
INDEX_SERVER_MODE=follower     →  Force follower role (requires running leader)
```

---

## Standalone Mode (Production)

### Architecture

```mermaid
---
config:
    layout: elk
---
graph TD
    subgraph "VS Code Window 1"
        Host1[MCP Host<br/>VS Code / Copilot] -->|stdio| MCP1[Index<br/>PID 1001]
    end
    subgraph "VS Code Window 2"
        Host2[MCP Host<br/>VS Code / Copilot] -->|stdio| MCP2[Index<br/>PID 1002]
    end
    subgraph "VS Code Window 3"
        Host3[MCP Host<br/>VS Code / Copilot] -->|stdio| MCP3[Index<br/>PID 1003]
    end

    MCP1 -->|read/write| Disk[(Shared Disk<br/>instructions/<br/>usage-snapshot.json<br/>.index-version)]
    MCP2 -->|read/write| Disk
    MCP3 -->|read/write| Disk

    style Host1 fill:#607d8b,stroke:#37474f,stroke-width:2px,color:#fff
    style Host2 fill:#607d8b,stroke:#37474f,stroke-width:2px,color:#fff
    style Host3 fill:#607d8b,stroke:#37474f,stroke-width:2px,color:#fff
    style MCP1 fill:#2196f3,stroke:#0d47a1,stroke-width:2px,color:#fff
    style MCP2 fill:#2196f3,stroke:#0d47a1,stroke-width:2px,color:#fff
    style MCP3 fill:#2196f3,stroke:#0d47a1,stroke-width:2px,color:#fff
    style Disk fill:#4caf50,stroke:#2e7d32,stroke-width:3px,color:#fff
```

### Startup Flow

```mermaid
---
config:
    layout: elk
---
flowchart TD
    Start([Process Start]) --> ParseConfig[Parse env & CLI args]
    ParseConfig --> LoadIndex[Load Index from disk<br/>validate + classify + migrate]
    LoadIndex --> StartDash{Dashboard<br/>enabled?}
    StartDash -->|yes| Dashboard[Start Express on<br/>INDEX_SERVER_DASHBOARD_PORT]
    StartDash -->|no| SkipDash[Skip dashboard]
    Dashboard --> StartMCP[Start MCP stdio transport]
    SkipDash --> StartMCP
    StartMCP --> Ready([Serving MCP tools])

    style Start fill:#66bb6a,stroke:#2e7d32,stroke-width:2px,color:#fff
    style ParseConfig fill:#42a5f5,stroke:#1565c0,stroke-width:2px,color:#fff
    style LoadIndex fill:#ff9800,stroke:#e65100,stroke-width:2px,color:#fff
    style Dashboard fill:#00bcd4,stroke:#006064,stroke-width:2px,color:#fff
    style StartMCP fill:#ab47bc,stroke:#6a1b9a,stroke-width:2px,color:#fff
    style Ready fill:#66bb6a,stroke:#2e7d32,stroke-width:2px,color:#fff
```

### Data Flow — Read Path

```mermaid
---
config:
    layout: elk
---
sequenceDiagram
    participant Client as MCP Client<br/>(VS Code)
    participant Server as Index
    participant Index as IndexContext
    participant Disk as Disk

    Client->>Server: tools/call index_search
    Server->>Index: ensureLoaded()
    Index->>Index: Check .index-version mtime
    alt Cache valid
        Index-->>Server: Return cached entries
    else Cache stale
        Index->>Disk: Read instructions/*.json
        Disk-->>Index: JSON entries
        Index->>Index: Validate + classify + index
        Index-->>Server: Return fresh entries
    end
    Server->>Server: Filter + score results
    Server-->>Client: Search results
```

### Data Flow — Mutation Path

```mermaid
---
config:
    layout: elk
---
sequenceDiagram
    participant Client as MCP Client
    participant Handler as Tool Handler
    participant Index as IndexContext
    participant Audit as AuditLog
    participant Disk as Disk

    Client->>Handler: tools/call index_add
    Handler->>Handler: Validate schema + body size
    Handler->>Index: writeEntry(entry)
    Index->>Disk: Atomic write {id}.json
    Index->>Disk: Touch .index-version
    Index->>Index: Materialize in-memory
    Index-->>Handler: Success
    Handler->>Audit: logAudit(add, id)
    Handler-->>Client: Result
```

### Characteristics

| Property | Behavior |
|----------|----------|
| Memory | Full Index in every instance (~60-70 MB RSS each) |
| CPU | Full classification + indexing per instance on load |
| Disk I/O | All instances read/write concurrently |
| File locking | None — last-writer-wins on concurrent mutations |
| Consistency | `.index-version` file + mtime polling for cross-process invalidation |
| Isolation | Complete — each instance independent |
| Failure mode | One crash has no effect on others |

### When to Use

- **Default for all deployments** — proven, simple, no coordination overhead
- 1-5 concurrent instances (typical workload)
- When file locking risk is acceptable (rare concurrent mutations)
- When ~300-400 MB total RSS for 5 instances is acceptable

---

## Leader/Follower Mode (Experimental)

### Architecture

```mermaid
---
config:
    layout: elk
---
graph TD
    subgraph "VS Code Window 1"
        Host1[MCP Host] -->|stdio| Leader[Index<br/>LEADER PID 2001]
    end
    subgraph "VS Code Window 2"
        Host2[MCP Host] -->|stdio| Follower1[Index<br/>FOLLOWER PID 2002]
    end
    subgraph "VS Code Window 3"
        Host3[MCP Host] -->|stdio| Follower2[Index<br/>FOLLOWER PID 2003]
    end
    subgraph "Squad Sub-Agent"
        Host4[MCP Host] -->|stdio| ThinClient[thin-client<br/>PID 2004]
    end

    Leader -->|read/write| Disk[(Shared Disk<br/>instructions/<br/>usage-snapshot.json)]
    Follower1 -->|HTTP JSON-RPC| Leader
    Follower2 -->|HTTP JSON-RPC| Leader
    ThinClient -->|HTTP JSON-RPC| Leader

    Leader -->|heartbeat file| StateDir[(data/state/<br/>leader.lock)]

    style Host1 fill:#607d8b,stroke:#37474f,stroke-width:2px,color:#fff
    style Host2 fill:#607d8b,stroke:#37474f,stroke-width:2px,color:#fff
    style Host3 fill:#607d8b,stroke:#37474f,stroke-width:2px,color:#fff
    style Host4 fill:#607d8b,stroke:#37474f,stroke-width:2px,color:#fff
    style Leader fill:#ff9800,stroke:#e65100,stroke-width:3px,color:#fff
    style Follower1 fill:#42a5f5,stroke:#1565c0,stroke-width:2px,color:#fff
    style Follower2 fill:#42a5f5,stroke:#1565c0,stroke-width:2px,color:#fff
    style ThinClient fill:#78909c,stroke:#37474f,stroke-width:2px,color:#fff
    style Disk fill:#4caf50,stroke:#2e7d32,stroke-width:3px,color:#fff
    style StateDir fill:#4caf50,stroke:#2e7d32,stroke-width:2px,color:#fff
```

### Election Flow

```mermaid
---
config:
    layout: elk
---
flowchart TD
    Start([Process Start]) --> ParseConfig[Parse env & CLI args]
    ParseConfig --> CheckMode{INDEX_SERVER_MODE?}

    CheckMode -->|standalone| Standalone([Standalone path<br/>full startup])
    CheckMode -->|auto / leader| TryBind[Attempt bind<br/>INDEX_SERVER_LEADER_PORT]

    TryBind -->|listen() OK| BecomeLeader[LEADER ROLE<br/>Write leader.lock]
    TryBind -->|EADDRINUSE| HealthCheck[Health check<br/>existing leader]

    HealthCheck -->|healthy| BecomeFollower[FOLLOWER ROLE<br/>Proxy to leader]
    HealthCheck -->|unhealthy| RetryElection[Wait + retry<br/>election]
    RetryElection --> TryBind

    BecomeLeader --> LoadIndex[Load Index<br/>Start HTTP transport<br/>Start dashboard]
    BecomeLeader --> StartStdio1[Start stdio transport<br/>WITH real handlers]

    BecomeFollower --> StartStdio2[Start stdio transport<br/>WITH proxy handlers]
    BecomeFollower --> Heartbeat[Start heartbeat<br/>monitor]

    CheckMode -->|follower| DiscoverLeader[Read leader.lock<br/>Connect to leader]
    DiscoverLeader -->|found| BecomeFollower
    DiscoverLeader -->|not found| WaitLeader[Wait for leader<br/>with backoff]
    WaitLeader --> DiscoverLeader

    LoadIndex --> Serving([Serving])
    StartStdio1 --> Serving
    StartStdio2 --> ServingProxy([Serving via proxy])
    Heartbeat --> ServingProxy

    style Start fill:#66bb6a,stroke:#2e7d32,stroke-width:2px,color:#fff
    style Standalone fill:#78909c,stroke:#37474f,stroke-width:2px,color:#fff
    style BecomeLeader fill:#ff9800,stroke:#e65100,stroke-width:3px,color:#fff
    style BecomeFollower fill:#42a5f5,stroke:#1565c0,stroke-width:2px,color:#fff
    style LoadIndex fill:#ff9800,stroke:#e65100,stroke-width:2px,color:#fff
    style Serving fill:#66bb6a,stroke:#2e7d32,stroke-width:2px,color:#fff
    style ServingProxy fill:#66bb6a,stroke:#2e7d32,stroke-width:2px,color:#fff
    style Heartbeat fill:#ef5350,stroke:#c62828,stroke-width:2px,color:#fff
```

### Tool Call Flow — Follower Proxy

```mermaid
---
config:
    layout: elk
---
sequenceDiagram
    participant Client as MCP Client<br/>(VS Code)
    participant Follower as Follower<br/>(stdio)
    participant Leader as Leader<br/>(HTTP)
    participant Index as IndexContext
    participant Disk as Disk

    Client->>Follower: tools/call index_search
    Follower->>Leader: POST /mcp/rpc<br/>{"method":"index_search", "params":{...}}
    Leader->>Index: ensureLoaded() + search
    Index->>Disk: Read if stale
    Index-->>Leader: Results
    Leader-->>Follower: HTTP 200 JSON-RPC response
    Follower-->>Client: MCP tool result

    Note over Follower,Leader: Follower has NO Index in memory.<br/>All state lives on the leader.
```

### Mutation Flow — Single Writer

```mermaid
---
config:
    layout: elk
---
sequenceDiagram
    participant F1 as Follower A
    participant F2 as Follower B
    participant Leader as Leader
    participant Index as IndexContext
    participant Disk as Disk

    par Concurrent mutations
        F1->>Leader: POST /mcp/rpc index_add (entry A)
        F2->>Leader: POST /mcp/rpc index_add (entry B)
    end

    Leader->>Index: writeEntry(A)
    Index->>Disk: Atomic write A.json
    Index->>Disk: Touch .index-version
    Leader-->>F1: Success

    Leader->>Index: writeEntry(B)
    Index->>Disk: Atomic write B.json
    Index->>Disk: Touch .index-version
    Leader-->>F2: Success

    Note over Leader,Disk: Leader serializes all disk writes.<br/>No concurrent file access. No locking needed.
```

### Failover Flow

```mermaid
---
config:
    layout: elk
---
sequenceDiagram
    participant F1 as Follower 1
    participant F2 as Follower 2
    participant Leader as Leader
    participant Disk as Disk

    Note over Leader: Leader crashes (SIGKILL / OOM)
    F1->>Leader: Heartbeat
    Leader--xF1: Connection refused
    F1->>F1: Miss count: 1/3

    F1->>Leader: Heartbeat
    Leader--xF1: Connection refused
    F1->>F1: Miss count: 2/3

    F1->>Leader: Heartbeat
    Leader--xF1: Connection refused
    F1->>F1: Miss count: 3/3 → FAILOVER

    F1->>Disk: Check leader.lock PID (signal-0)
    Disk-->>F1: PID dead → delete stale lock

    F1->>F1: Attempt listen() on INDEX_SERVER_LEADER_PORT
    Note over F1: listen() succeeds → PROMOTED TO LEADER

    F1->>Disk: Load Index from disk (~300ms)
    F1->>Disk: Write new leader.lock

    F2->>F1: Heartbeat → discovers new leader
    F2->>F1: Resume proxying tool calls

    Note over F1,F2: Total failover window: 0.5–7 seconds
```

### Thin Client Architecture

```mermaid
---
config:
    layout: elk
---
graph LR
    subgraph "MCP Host Process"
        Host[VS Code / Copilot<br/>Agent]
    end

    subgraph "Thin Client Process (~25 MB)"
        TC[thin-client.ts<br/>stdin → HTTP → stdout]
    end

    subgraph "Leader Process (~85 MB)"
        HTTP[HTTP Transport<br/>/mcp/rpc]
        HTTP --> Registry[Handler Registry]
        Registry --> Index[IndexContext]
        Index --> Disk[(Disk)]
    end

    Host -->|stdio<br/>JSON-RPC frames| TC
    TC -->|HTTP POST<br/>localhost:9090/mcp/rpc| HTTP
    HTTP -->|HTTP response| TC
    TC -->|stdio<br/>JSON-RPC response| Host

    style Host fill:#607d8b,stroke:#37474f,stroke-width:2px,color:#fff
    style TC fill:#78909c,stroke:#37474f,stroke-width:2px,color:#fff
    style HTTP fill:#ff9800,stroke:#e65100,stroke-width:2px,color:#fff
    style Registry fill:#ab47bc,stroke:#6a1b9a,stroke-width:2px,color:#fff
    style Index fill:#ff9800,stroke:#e65100,stroke-width:2px,color:#fff
    style Disk fill:#4caf50,stroke:#2e7d32,stroke-width:3px,color:#fff
```

The thin client (`src/server/thin-client.ts`) is a separate entry point that skips index loading entirely. It reads JSON-RPC frames from stdin and forwards them to the leader's HTTP transport, writing responses back to stdout. This is the lightest-weight follower option.

### Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `INDEX_SERVER_MODE` | `standalone` | `standalone`, `auto`, `leader`, `follower` |
| `INDEX_SERVER_LEADER_PORT` | `9090` | TCP port for leader HTTP transport |
| `INDEX_SERVER_HEARTBEAT_MS` | `5000` | Leader heartbeat write interval |
| `INDEX_SERVER_STALE_THRESHOLD_MS` | `15000` | Threshold before follower considers leader dead |
| `INDEX_SERVER_STATE_DIR` | `data/state` | Location for leader.lock and instance state files |
| `INDEX_SERVER_LEADER_URL` | (discovered) | Explicit leader URL for thin client (overrides discovery) |

---

## Performance Comparison

Benchmark: 10 concurrent Index instances on Windows (32 CPUs, 64 GB RAM, Node v24.3.0).

### Resource Summary

```mermaid
---
config:
    layout: elk
---
graph LR
    subgraph "Standalone (10 instances)"
        S_Mem["RSS: 674 MB total<br/>67 MB avg/instance"]
        S_CPU["CPU: 4891 ms total<br/>489 ms avg/instance"]
        S_IO["Disk writers: 10<br/>File lock risk: HIGH"]
    end

    subgraph "Leader/Follower (1L + 9F)"
        LF_Mem["RSS: 645 MB total<br/>Leader: 85 MB | Follower: 62 MB avg"]
        LF_CPU["CPU: 1812 ms total<br/>Leader: 360 ms | Follower: 160 ms avg"]
        LF_IO["Disk writers: 1<br/>File lock risk: NONE"]
    end

    style S_Mem fill:#ef5350,stroke:#c62828,stroke-width:2px,color:#fff
    style S_CPU fill:#ef5350,stroke:#c62828,stroke-width:2px,color:#fff
    style S_IO fill:#ef5350,stroke:#c62828,stroke-width:2px,color:#fff
    style LF_Mem fill:#66bb6a,stroke:#2e7d32,stroke-width:2px,color:#fff
    style LF_CPU fill:#66bb6a,stroke:#2e7d32,stroke-width:2px,color:#fff
    style LF_IO fill:#66bb6a,stroke:#2e7d32,stroke-width:2px,color:#fff
```

### Measured Results

| Metric | Standalone (10) | Leader/Follower (1L+9F) | Delta |
|--------|----------------|------------------------|-------|
| **Total RSS** | 674 MB | 645 MB | **-4.2% (savings: 29 MB)** |
| Avg RSS per instance | 67 MB | 65 MB | |
| Leader RSS | n/a | 85 MB | |
| Avg follower RSS | n/a | 62 MB | -8% vs standalone |
| **Total CPU time** | 4,891 ms | 1,812 ms | **-63% (moderate improvement)** |
| Avg CPU per instance | 489 ms | 181 ms | |
| **Disk writers** | 10 concurrent | 1 (leader only) | **-90%** |
| **File lock risk** | High (10 writers) | None (single writer) | **Eliminated** |

### Key Findings

1. **Memory: Small improvement (4.2%)** — Followers still load the Node.js runtime (~25-30 MB base), so per-follower savings are ~5 MB. The V8 heap and module graph dominate. Larger Indexs would show proportionally greater savings since only the leader holds entries in memory.

2. **CPU: Moderate improvement (63%)** — Followers skip index loading, classification, and indexing. The leader does this work once; followers simply proxy. This matters most during startup burst when many instances launch simultaneously.

3. **File locking: Major improvement** — The single biggest benefit. In standalone mode, 10+ processes racing on `usage-snapshot.json`, `.index-version`, and instruction files risks data loss (last-writer-wins). Leader/follower eliminates this entirely — only the leader touches disk.

4. **Leader HTTP latency** — Sub-millisecond median for proxied calls. 1,800+ req/s throughput in burst. The HTTP proxy adds negligible overhead.

### Tradeoff Analysis

```mermaid
---
config:
    layout: elk
---
quadrantChart
    title Standalone vs Leader/Follower Tradeoffs
    x-axis "Low Complexity" --> "High Complexity"
    y-axis "Low Benefit" --> "High Benefit"
    quadrant-1 "Worth It"
    quadrant-2 "Future Value"
    quadrant-3 "Avoid"
    quadrant-4 "Diminishing Returns"
    "File Lock Safety": [0.3, 0.9]
    "CPU Savings": [0.4, 0.6]
    "Memory Savings": [0.4, 0.25]
    "Single Source of Truth": [0.35, 0.75]
    "Failover Complexity": [0.8, 0.3]
    "Debug Complexity": [0.7, 0.15]
```

---

## Module Structure

```mermaid
---
config:
    layout: elk
---
graph TD
    subgraph "Entry Points"
        Main[src/server/index-server.ts<br/>Full server]
        Thin[src/server/thin-client.ts<br/>Lightweight follower]
    end

    subgraph "Multi-Instance [EXPERIMENTAL]"
        Election[LeaderElection.ts<br/>Port-based election]
        Transport[HttpTransport.ts<br/>Express JSON-RPC router]
        Client[ThinClient.ts<br/>Stdio↔HTTP bridge]
    end

    subgraph "Core (unchanged)"
        Registry[Handler Registry]
        Index[IndexContext]
        Handlers[Tool Handlers]
        Dashboard[Dashboard Server]
    end

    Main --> Election
    Main -->|leader| Transport
    Main -->|leader| Registry
    Main -->|leader| Dashboard
    Main -->|all modes| Registry

    Thin --> Client
    Client -->|HTTP| Transport

    Election -->|role=leader| Transport
    Election -->|role=follower| Client

    Transport --> Registry
    Registry --> Handlers
    Handlers --> Index

    style Main fill:#2196f3,stroke:#0d47a1,stroke-width:2px,color:#fff
    style Thin fill:#78909c,stroke:#37474f,stroke-width:2px,color:#fff
    style Election fill:#ff9800,stroke:#e65100,stroke-width:2px,color:#fff
    style Transport fill:#ff9800,stroke:#e65100,stroke-width:2px,color:#fff
    style Client fill:#ff9800,stroke:#e65100,stroke-width:2px,color:#fff
    style Registry fill:#ab47bc,stroke:#6a1b9a,stroke-width:2px,color:#fff
    style Index fill:#ab47bc,stroke:#6a1b9a,stroke-width:2px,color:#fff
    style Handlers fill:#ab47bc,stroke:#6a1b9a,stroke-width:2px,color:#fff
    style Dashboard fill:#00bcd4,stroke:#006064,stroke-width:2px,color:#fff
```

### File Summary

| File | Lines | Purpose |
|------|-------|---------|
| `src/dashboard/server/LeaderElection.ts` | ~260 | Lock file + PID election, heartbeat, stale detection |
| `src/dashboard/server/HttpTransport.ts` | ~90 | Express router: `/mcp/rpc`, `/mcp/health`, `/mcp/leader` |
| `src/dashboard/server/ThinClient.ts` | ~240 | Stdin JSON-RPC → HTTP POST → stdout bridge |
| `src/server/thin-client.ts` | ~30 | Thin client entry point (CLI) |
| `src/server/index-server.ts` | ~475 | Election integration in main startup |
| `src/config/runtimeConfig.ts` | ~4 | Config keys: `instanceMode`, `leaderPort`, `heartbeatIntervalMs`, `staleThresholdMs` |

---

## Decision Guide

```mermaid
---
config:
    layout: elk
---
flowchart TD
    Q1{How many MCP<br/>instances?}
    Q1 -->|1-3| UseStandalone([Use Standalone<br/>INDEX_SERVER_MODE=standalone])
    Q1 -->|4-10| Q2{Concurrent<br/>mutations?}
    Q1 -->|10+| UseLF([Consider Leader/Follower<br/>INDEX_SERVER_MODE=auto])

    Q2 -->|rare| UseStandalone
    Q2 -->|frequent| UseLF

    Q3{Squad agents<br/>spawning sub-processes?}
    Q1 -->|squad| Q3
    Q3 -->|yes| UseLF
    Q3 -->|no| UseStandalone

    style UseStandalone fill:#2196f3,stroke:#0d47a1,stroke-width:2px,color:#fff
    style UseLF fill:#ff9800,stroke:#e65100,stroke-width:2px,color:#fff
```

| Scenario | Recommendation |
|----------|---------------|
| Single developer, few VS Code windows | Standalone |
| Multiple windows, read-heavy workload | Standalone |
| 10+ windows with Squad agents | Leader/Follower |
| CI/CD or automated tooling | Standalone (ephemeral processes) |
| Shared team instruction index | Leader/Follower (single-writer safety) |

---

## Known Limitations (Experimental)

1. **No automatic follower-to-leader Index sync** — if a follower promotes, it cold-loads the index from disk (~300ms gap)
2. **Dashboard only on leader** — followers don't serve the admin UI
3. **No request queuing during failover** — in-flight calls to a dead leader fail and must be retried by the client
4. **Windows-specific socket behavior** — `SO_REUSEADDR` semantics differ; tested on Windows 10/11 only
5. **No TLS on the HTTP transport** — localhost-only by design, but lacks mTLS for defense-in-depth

## Related Documents

- [Architecture](architecture.md) — Overall system architecture
- [Leader/Follower Spec](mcp-index-leader-follower-spec.md) — Detailed specification
- [Performance Report](leader-follower-perf-report.txt) — Raw benchmark data
- [Configuration](configuration.md) — All environment variables
