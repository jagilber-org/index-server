## Configure

Choose a profile and generate your `mcp.json` configuration.

[Configure MCP Client](command:index.configure)

### Profiles

| Profile | Description |
|---------|-------------|
| **Default** | HTTP standalone — local JSON storage, minimal config |
| **Enhanced** | Semantic search + HTTPS — TLS, embeddings, file logging, mutation, metrics |
| **Experimental** | SQLite + debug — all enhanced features plus SQLite storage backend |

The extension uses `npx @jagilber-org/index-server` by default — zero config needed.

Optionally set `index.serverPath` to use a local checkout.

---

[Show Status](command:index.showStatus) · [Open Dashboard](command:index.openDashboard) · [Open Settings](command:workbench.action.openSettings?%22index%22)
