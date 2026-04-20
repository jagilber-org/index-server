# Sessions Panel

The Sessions panel monitors active connections and session history.

## Active Admin Sessions

Lists all currently authenticated admin dashboard sessions:

- **Session ID** — unique identifier
- **Connected At** — when the session was established
- **Last Activity** — most recent interaction timestamp
- **IP Address** — client origin

## Active WebSocket Connections

Shows real-time WebSocket connections to the dashboard:

- **Connection ID** — WebSocket identifier
- **Type** — connection purpose (metrics, logs, events)
- **Connected** — connection duration
- **Messages** — count of messages sent/received

WebSocket connections provide live updates for monitoring, log tailing, and event streaming.

## Session History

A paginated log of past admin sessions with:

- **Start / End** — session time range
- **Duration** — how long the session lasted
- **Actions** — number of operations performed
- **Status** — how the session ended (closed, timeout, error)

### Controls

- **Limit** — number of history entries to display (25–250)
- **Refresh** — reload session history from the server
- **Page Size** — entries per page for pagination

---

**Related env vars:** `INDEX_SERVER_DASHBOARD_PORT`, `INDEX_SERVER_DASHBOARD_HOST`, `INDEX_SERVER_DASHBOARD_TLS`
