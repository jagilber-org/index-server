# Messaging System

Inter-agent messaging for the MCP Index Server. Messages are **short-term and ephemeral** — they are NOT stored in the instruction index but persist across instances/sessions via JSONL files on disk.

## Architecture

```
MCP Tools (8)  ←→  AgentMailbox  ←→  JSONL Persistence (data/messages.jsonl)
REST API (9)   ←→  AgentMailbox  ←→  File Watcher (cross-process sync)
Dashboard UI   ←→  REST API      ←→  WebSocket (live updates)
```

## Data Model

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | ✓ | Auto-generated: `msg-{counter}-{timestamp}` |
| `channel` | string | ✓ | Topic/channel name |
| `sender` | string | ✓ | Agent/instance identifier |
| `recipients` | string[] | ✓ | `['*']` for broadcast, or specific IDs |
| `body` | string | ✓ | Message text (max 100KB) |
| `createdAt` | string | ✓ | ISO 8601 timestamp |
| `ttlSeconds` | number | ✓ | 0–86400 (default: 3600 = 1h) |
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

## Configuration

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `INDEX_SERVER_MESSAGING_DIR` | `data/` | Messages directory |
| `INDEX_SERVER_MESSAGING_MAX` | `10000` | Max messages |
| `INDEX_SERVER_MESSAGING_SWEEP_MS` | `60000` | TTL sweep interval |

## Recipient Visibility

- **Broadcast** (`recipients: ['*']`): All readers see the message
- **Directed**: Only sender + listed recipients can read
- **Admin** (`reader: '*'`): Dashboard admin sees all messages

## TTL Lifecycle

1. Messages created with `ttlSeconds` (default 3600 = 1 hour)
2. Sweep timer runs every 60s, removing expired non-persistent messages
3. `persistent: true` messages are exempt from sweep (ttlSeconds=0)
4. Manual purge always works regardless of TTL
