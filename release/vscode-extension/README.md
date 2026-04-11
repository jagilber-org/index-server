# Index Server

**Index Server for VS Code** -- providing governed, classified, and auditable instruction indexes with analytics and an optional admin dashboard.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/jagilber-org/index-server/blob/main/LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://github.com/jagilber-org/index-server)

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 📋 **Instruction Index Server** | Schema-validated, governed instruction management with CRUD operations |
| 🔍 **Full-Text & Semantic Search** | Keyword, regex, and embedding-based search across your Index Server |
| 📊 **Admin Dashboard** | Real-time monitoring UI with analytics, health checks, and session tracking |
| 🔒 **Governance** | Hash-verified instruction integrity, audit logging, and usage tracking |
| 🔄 **MCP Protocol** | Full MCP specification compliance — works with any MCP client |
| ⚡ **50+ Tools** | Comprehensive toolset for Index Server management, search, feedback, and more |

---

## 🚀 Getting Started

### 1. Install the Extension

Search for **"Index Server"** in the VS Code Extensions sidebar (`@mcp index-server`), or:

```
ext install jagilber-org.index-server
```

### 2. Configure the Server

After installation, the MCP server is automatically registered. You can configure it through VS Code settings:

1. Open Settings (`Ctrl+,` / `Cmd+,`)
2. Search for **"Index Server"**
3. Set the **Server Path** to your `dist/server/index-server.js`

Or use the command palette:

- `Ctrl+Shift+P` → **"Index Server: Configure MCP Client"**

### 3. Start Using Tools in Chat

Open Copilot Chat in agent mode and the Index Server tools are available automatically. Try:

```
Search the instruction Index Server for deployment guidelines
```

---

## ⚙️ Configuration

All settings are available under `Index Server.*` in VS Code Settings:

| Setting | Default | Description |
|---------|---------|-------------|
| `serverPath` | *(auto-detect)* | Path to `dist/server/index-server.js` |
| `instructionsDir` | *(bundled)* | Path to instruction JSON files |
| `dashboard.enabled` | `false` | Enable the admin dashboard |
| `dashboard.port` | `3210` | Dashboard HTTP port |
| `logLevel` | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `mutation.enabled` | `false` | Allow Index Server write operations |

---

## 📋 Commands

| Command | Description |
|---------|-------------|
| **Index Server: Configure MCP Client** | Generate MCP client configuration for `mcp.json` |
| **Index Server: Show Status** | Show server path, settings, and connection status |
| **Index Server: Open Dashboard** | Open the admin dashboard in your browser |

---

## 🛠️ Available MCP Tools

The server provides **50+ tools** organized by category:

### Index Server Management
- `Index Server_search` — Search by keyword, regex, or semantic similarity
- `Index Server_dispatch` — Query, list, get, add, import, remove instructions
- `Index Server_add` — Add a single instruction with validation
- `Index Server_import` — Bulk import instructions
- `Index Server_remove` — Delete instructions by ID

### Governance & Health
- `health_check` — Server health status and version
- `Index Server_governanceHash` — Deterministic Index Server hash for integrity verification
- `integrity_verify` — Verify instruction body hashes
- `usage_track` — Track instruction usage with qualitative signals
- `usage_hotset` — Most-used instructions (hot set)

### Feedback & Metrics
- `feedback_dispatch` — Submit, list, and manage feedback entries
- `metrics_snapshot` — Performance metrics for all methods
- `prompt_review` — Static analysis of prompts

### Knowledge Promotion
- `promote_from_repo` — Scan a Git repo and promote content into the Index Server

---

## 📊 Admin Dashboard

Enable the dashboard for real-time monitoring:

1. Set `index.dashboard.enabled` to `true`
2. Set your preferred port (default: `3210`)
3. Run **"Index Server: Open Dashboard"** from the command palette

The dashboard provides:
- 📈 Instruction analytics and usage patterns
- 🔍 Search and browse the full Index Server
- ⚡ Real-time health monitoring
- 📋 Session tracking and audit logs

---

## 🏗️ Standalone Server Setup

For advanced use cases, run the server independently:

```bash
# Clone and build
git clone https://github.com/jagilber-org/index-server.git
cd index-server
npm ci && npm run build

# Run
node dist/server/index-server.js
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `INDEX_SERVER_DIR` | `./instructions` | Path to instruction files |
| `INDEX_SERVER_DASHBOARD` | `0` | Enable admin dashboard (`1` to enable) |
| `INDEX_SERVER_MUTATION` | `0` | Allow write operations |
| `INDEX_SERVER_SEMANTIC_ENABLED` | `0` | Enable semantic/embedding search |
| `INDEX_SERVER_BODY_MAX_LENGTH` | `20000` | Max instruction body length |

See the [full documentation](https://github.com/jagilber-org/index-server#readme) for all configuration options.

---

## 📝 Manual MCP Configuration

If you prefer to configure the server manually in `mcp.json`:

```jsonc
{
  "servers": {
    "Index Server": {
      "type": "stdio",
      "command": "node",
      "args": ["<path-to>/index-server/dist/server/index-server.js"],
      "env": {
        "INDEX_SERVER_DIR": "<path-to>/instructions",
        "INDEX_SERVER_MUTATION": "1"
      }
    }
  }
}
```

---

## 🔗 Links

- [GitHub Repository](https://github.com/jagilber-org/index-server)
- [Documentation](https://github.com/jagilber-org/index-server#readme)
- [Issue Tracker](https://github.com/jagilber-org/index-server/issues)
- [Changelog](https://github.com/jagilber-org/index-server/blob/main/CHANGELOG.md)
- [MCP Specification](https://modelcontextprotocol.io)

---

## License

[MIT](https://github.com/jagilber-org/index-server/blob/main/LICENSE)
