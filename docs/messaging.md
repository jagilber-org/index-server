# Messaging System

Inter-agent messaging for the MCP Index Server. Messages are **short-term and ephemeral** — they are NOT stored in the instruction index but persist across instances/sessions via JSONL files on disk.

## Architecture

```
MCP Tools (11) ←→  AgentMailbox  ←→  JSONL (<STATE_ROOT>/data/messaging/messages.jsonl)
REST API (11)  ←→  AgentMailbox  ←→  Version-token lazy reload (cross-process sync)
Dashboard UI   ←→  REST API      ←→  WebSocket (live updates)
```

### Cross-process synchronization

Each `AgentMailbox` instance (one per standalone process, e.g. one per VS Code
window) keeps its own in-memory `Map`, but stays in sync with other processes
sharing the same messaging directory via a `.messages-version` token file:

- Every successful write (`appendMessage`/`rewriteMessages`) touches
  `.messages-version` with a monotonically increasing token
  (`${Date.now()}-${random}`), mirroring the proven `.index-version` pattern
  already used for the instruction index (`src/services/indexContext.ts`).
- `ensureLoaded()` runs a cheap `(mtime, token)` comparison on every call; it
  only re-reads `messages.jsonl` from disk when the token has actually
  changed, avoiding unnecessary disk I/O and the reload-storm class of bug
  documented in `indexContext.ts`'s 2026-05-01 RCA.
- Reloads **merge** disk-only messages into the in-memory store by message
  ID — they never blind-overwrite it. This guarantees a process's own
  in-flight writes are never clobbered by a reload racing against another
  process's write.
- **Known limitation:** the merge is additive only. Deletions, purges, and
  TTL sweeps performed in one process are not currently propagated to
  another already-loaded process's in-memory view (only new messages sync
  cross-process). This preserves the no-data-loss guarantee above but means
  a stale process may still show already-purged messages until it restarts
  or otherwise reloads. Tracked as a follow-up if cross-process delete
  propagation becomes a requirement.

## Data Model

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | ✓ | Auto-generated: `msg-{counter}-{timestamp}` |
| `channel` | string | ✓ | Topic/channel name |
| `sender` | string | ✓ | Agent/instance identifier |
| `recipients` | string[] | ✓ | `['*']` for broadcast, or specific IDs |
| `body` | string | ✓ | Message text (max 100KB) |
| `createdAt` | string | ✓ | ISO 8601 timestamp |
| `ttlSeconds` | number | ✓ | Stored: 0–86400. **On send the lower bound is 1**, not 0 (`messagingTypes.ts:41` vs `:60`) — `ttlSeconds: 0` is rejected by the create schema. Default 3600 = 1h |
| `persistent` | boolean | | If true, survives TTL sweep |
| `readBy` | string[] | | Readers who acknowledged |
| `payload` | object | | Structured JSON data |
| `priority` | enum | | `low`, `normal`, `high`, `critical` |
| `parentId` | string | | Parent message ID (threading) |
| `requiresAck` | boolean | | Whether ack is required |
| `ackBySeconds` | number | | ACK deadline from creation |
| `tags` | string[] | | Categorization tags |
| `origin` | string | | `PID@instance` identifier |

## MCP Tools

| Tool | Type | Description |
|------|------|-------------|
| `messaging_send` | MUTATION | Send a message to a channel |
| `messaging_read` | STABLE | Read messages with visibility filtering |
| `messaging_list_channels` | STABLE | List all active channels |
| `messaging_ack` | MUTATION | Acknowledge messages (mark read) |
| `messaging_stats` | STABLE | Get stats for a reader |
| `messaging_get` | STABLE | Get a single message by ID |
| `messaging_update` | MUTATION | Update mutable message fields |
| `messaging_purge` | MUTATION | Delete messages |
| `messaging_reply` | MUTATION | Reply with auto-populated channel and `parentId`; supports reply-all |
| `messaging_thread` | STABLE | Retrieve a full thread by root `parentId` |
| `messaging_manage` | MUTATION | Dispatcher mirroring the ten tools above 1:1 via `action=`. Recommended entry point (#373) |

## REST API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/messages` | Send a message |
| GET | `/api/messages/channels` | List channels |
| GET | `/api/messages/stats` | Reader stats |
| GET | `/api/messages/:channel` | Read from channel |
| POST | `/api/messages/ack` | Acknowledge messages |
| GET | `/api/messages/by-id/:id` | Get by ID |
| PUT | `/api/messages/by-id/:id` | Update message |
| DELETE | `/api/messages` | Purge messages |
| POST | `/api/messages/inbound` | Peer inbound |
| GET | `/api/messages/thread/:parentId` | Retrieve a thread by root id |
| POST | `/api/messages/reply` | Reply to a message |

## Configuration

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `INDEX_SERVER_MESSAGING_DIR` | `<STATE_ROOT>/data/messaging` | Messages directory. Shared by every client — see below. |
| `INDEX_SERVER_MESSAGING_MAX` | `10000` | Max messages |
| `INDEX_SERVER_MESSAGING_SWEEP_MS` | `60000` | TTL sweep interval |

### Storage location — why it is anchored to `STATE_ROOT`

Messaging is only useful if every client reads and writes **one** store. The
default is therefore `<STATE_ROOT>/data/messaging`
(`src/config/pathResolution.ts:177-201`):

```
%LOCALAPPDATA%\index-server\data\messaging      # Windows
$XDG_STATE_HOME/index-server/data/messaging     # Linux / macOS
```

`STATE_ROOT` is per-user and machine-wide, overridable with
`INDEX_SERVER_STATE_ROOT`. An explicit `INDEX_SERVER_MESSAGING_DIR` that is
relative is resolved against `STATE_ROOT` too, never against the working
directory.

> **This replaced a catalog-derived default of
> `<dirname(INDEX_SERVER_DIR)>/index-messaging`, which this document described
> until #591.** That earlier default was itself an improvement on a cwd-relative
> one, but kept a residual: with `INDEX_SERVER_DIR` unset,
> `resolveInstructionsDir()` falls back to `<cwd>/instructions`, so the store
> landed at `<cwd>/index-messaging` — per-client again, the exact split-brain the
> design exists to prevent. `STATE_ROOT` has no such fallback (#577).

It is **not** derived from the working directory. Each MCP client (VS Code,
Claude Code, Copilot CLI, Claude Desktop) launches the server from a different
cwd, so a cwd-relative default gives every client its own private store: a
broadcast sent from one client is invisible to the others, and **nothing reports
an error** — `messaging_list_channels` simply returns an empty list, because the
client is reading a store only it writes to. When debugging "my message never
arrived", compare the resolved directory across clients first.

Two rules follow:

- **`INDEX_SERVER_MESSAGING_DIR` is the highest-priority override.** Set it and
  it wins over the default. The setup wizard writes the same absolute path into
  every generated client config, so all clients agree.
- **The store must never live inside the instruction catalog.** The loader scans
  that directory for instruction JSON, so message files placed there are read
  back as malformed instructions and pollute the index. A messaging directory
  resolving inside `INDEX_SERVER_DIR` is rejected at startup with an explicit
  error rather than silently corrupting the catalog. Since the default moved to
  `STATE_ROOT` the default can no longer land there, but an **explicit**
  `INDEX_SERVER_MESSAGING_DIR` still can, which is why the guard remains.

### Diagnostics

- **The store is empty and you expected messages.** Compare the resolved
  directory across clients first. A client with a different
  `INDEX_SERVER_STATE_ROOT`, or an explicit `INDEX_SERVER_MESSAGING_DIR` set in
  only some configs, gets a private store and reports no error —
  `messaging_list_channels` simply returns an empty list.
- **A legacy `<cwd>/index-messaging` or `<cwd>/data/messaging` still holds
  files.** Nothing points at either after #577, so the TTL sweeper never runs on
  them: `persistent` messages there are invisible rather than expired. Both are
  leftovers from the two earlier defaults, not current locations.

If a message "never arrived", compare the resolved directory across clients first;
these warnings usually name the cause outright.

### Recovering from a bad `INDEX_SERVER_MESSAGING_DIR`

A store resolving inside the instruction catalog is fatal at startup, by design.
Two escape hatches exist so that this can never become a permanent lockout:

- `INDEX_SERVER_MESSAGING_ENABLED=0` skips the check entirely (nothing writes to
  the store while messaging is off, so the catalog stays safe).
- If the bad value came from the **dashboard override overlay**, the server ignores
  the overlay for that boot, says so on stderr, and starts anyway — so the dashboard
  comes back up and the override can be cleared from the UI that set it. The overlay
  file itself is never modified automatically.

A bad value set directly in the environment still fails closed: it is
operator-controlled and visible, so it is reported rather than worked around.

> **Upgrading:** the previous default was `<cwd>/data/messaging`. Nothing is
> migrated automatically, and the old directory is left untouched — but it will
> no longer be read.
>
> Most messages are TTL-bounded and expire on their own, so losing sight of them
> is harmless. **Messages sent with `persistent: true` are the exception:** they
> are exempt from the TTL sweep precisely so they survive indefinitely, so they
> will not age out of the old store and they will not appear in the new one. If
> any agent relies on persistent messages, copy the old directory's contents to
> the new location, or point `INDEX_SERVER_MESSAGING_DIR` at the old path,
> before assuming the queue is empty.
>
> Docker users: the store moved off the `index-data` volume onto its own
> `index-messaging` volume. Both are declared in `docker-compose.yml`; a stack
> created before this change keeps the old data in `index-data` under
> `data/messaging`.

## Recipient Visibility

- **Broadcast** (`recipients: ['*']`): All readers see the message
- **Directed**: Only sender + listed recipients can read
- **Admin** (`reader: '*'`): Dashboard admin sees all messages

## TTL Lifecycle

1. Messages created with `ttlSeconds` (default 3600 = 1 hour)
2. Sweep timer runs every 60s, removing expired non-persistent messages
3. `persistent: true` messages are exempt from sweep (ttlSeconds=0)
4. Manual purge always works regardless of TTL
