## Set Up SQLite Storage (Experimental Profile)

The Experimental profile replaces the default JSON file storage with SQLite, adding FTS5 full-text search and WAL-mode concurrency.

### Prerequisites

- **Node.js ≥ 22.5.0** — uses the built-in `node:sqlite` API (zero third-party deps)
- Verify: `node -e "require('node:sqlite');"` should exit silently

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `INDEX_SERVER_STORAGE_BACKEND` | `json` | Set to `sqlite` |
| `INDEX_SERVER_SQLITE_PATH` | `data/index.db` | Database file path |
| `INDEX_SERVER_SQLITE_WAL` | `true` | WAL mode for concurrent reads |
| `INDEX_SERVER_SQLITE_MIGRATE_ON_START` | `true` | Auto-migrate JSON → SQLite on first start |

### Migration

On first start with `STORAGE_BACKEND=sqlite`, the server automatically migrates existing JSON instructions into SQLite. The migration is **lossless and bidirectional** — you can switch back to `json` without data loss.

### What You Get

- **FTS5 full-text search** with BM25 ranking
- **WAL mode** for concurrent read/write without blocking
- **Indexed columns** for fast filtering by tags, classification, and status
- **Atomic transactions** for mutation operations

### Verify

1. Start the server with `INDEX_SERVER_STORAGE_BACKEND=sqlite`
2. Check logs for: `[info] SQLite storage initialized at data/index.db`
3. Run **Index Server: Show Status** — storage backend should show `sqlite`

### Reverting

To switch back to JSON storage:

```
INDEX_SERVER_STORAGE_BACKEND=json
```

The JSON files are preserved alongside the SQLite database.

> **⚠️ Experimental:** SQLite storage is functional but not yet recommended for production workloads.

---

[Show Status](command:index.showStatus) · [Re-generate Config](command:index.configure) · [Open Settings](command:workbench.action.openSettings?%22index%22)
