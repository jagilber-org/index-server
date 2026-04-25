# Index Server

**Governed knowledge base for AI agents via the Model Context Protocol (MCP).**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/github/v/tag/jagilber-org/index-server?label=GitHub%20Packages)](https://github.com/jagilber-org/index-server/packages)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22%20LTS-brightgreen)](package.json)
[![codecov](https://codecov.io/gh/jagilber-org/index-server/graph/badge.svg)](https://codecov.io/gh/jagilber-org/index-server)

---

> **🚀 [Quick Start Guide](docs/quickstart.md)** — Get running in 5 minutes with HTTPS and semantic search
>
> **📖 [Use Case Scenarios](docs/use-cases.md)** — Real-world examples for support engineers, dev teams, and knowledge management

## What Is Index Server?

Index Server is a central knowledge base that AI agents connect to via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io). Agents search, read, and contribute knowledge that persists across sessions and repositories — building a governed catalog with versioning, audit trails, and approval workflows. An optional admin dashboard provides real-time monitoring of catalog health, usage analytics, and drift detection.

---

## Quick Start Options

### Option A: MCP-native via `npx` (recommended)

Run the latest published package without cloning the repo. Choose this when you want the fastest local start and already have Node.js installed.

Start with the setup wizard so it can generate the right MCP client config for VS Code, Copilot CLI, or Claude Desktop:

```bash
npx -y @jagilber-org/index-server@latest --setup
```

To launch the server directly without the wizard:

```bash
npx -y @jagilber-org/index-server@latest --dashboard
```

### Option B: VS Code MCP configuration

Use VS Code's built-in MCP support with `.vscode/mcp.json` or your global `mcp.json`. You can add the server entry manually or run `npx -y @jagilber-org/index-server@latest --setup` to generate the config for you.

### Option C: Docker

Run the server in a container. Choose this when you want isolated runtime dependencies or you are preparing a container-based deployment.

```bash
docker compose up        # HTTP on :8787
docker compose up tls    # HTTPS on :8787 with self-signed certs
```

See [Docker Deployment Guide](docs/docker_deployment.md) for volumes, environment variables, and production configuration.

### Option D: From source

Clone and build the repository yourself. Choose this when you want to modify the server, run tests locally, or work from the latest source.

```bash
git clone https://github.com/jagilber-org/index-server.git
cd index-server
npm install
npm run build
```

## Configure Your MCP Client

> **Best practice:** set `INDEX_SERVER_DIR` to a well-known data folder such as `C:/mcp/index-data/instructions` or `~/.index-server/instructions`. Keep it outside VS Code and MCP client config paths so backups and reinstalls do not move or overwrite your catalog.

<details>
<summary>VS Code (`.vscode/mcp.json`)</summary>

```jsonc
{
  "servers": {
    "index-server": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@jagilber-org/index-server@latest",
        "--dashboard"
      ],
      "env": {
        "INDEX_SERVER_DIR": "C:/mcp/index-data/instructions",
        "INDEX_SERVER_LOG_LEVEL": "info"
      }
    }
  }
}
```

</details>

<details>
<summary>Copilot CLI (`~/.copilot/mcp-config.json`)</summary>

```json
{
  "mcpServers": {
    "index-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@jagilber-org/index-server@latest", "--dashboard"],
      "env": {
        "INDEX_SERVER_DIR": "C:/mcp/index-data/instructions",
        "INDEX_SERVER_LOG_LEVEL": "info"
      },
      "tools": ["*"]
    }
  }
}
```

</details>

<details>
<summary>Claude Desktop (`claude_desktop_config.json`)</summary>

```json
{
  "mcpServers": {
    "index-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@jagilber-org/index-server@latest", "--dashboard"],
      "env": {
        "INDEX_SERVER_DIR": "C:/mcp/index-data/instructions",
        "INDEX_SERVER_LOG_LEVEL": "info"
      },
      "tools": ["*"]
    }
  }
}
```

</details>

See [MCP Configuration Guide](docs/mcp_configuration.md) for advanced patterns, environment variables, and TLS setup.

### Verify

- Server appears in your MCP client's server list
- Run `tools/list` to see 40+ available tools
- Dashboard (if enabled) at `http://localhost:8787`

### Enable Semantic Search (optional)

Add one env variable to any MCP config above to get embedding-based similarity search:

```jsonc
"env": {
  "INDEX_SERVER_SEMANTIC_ENABLED": "1"
}
```

First search downloads a ~90MB model (one-time). After that, all searches automatically use semantic mode — no code changes needed. See [Quick Start Guide](docs/quickstart.md#4-enable-semantic-search-optional) for GPU acceleration and offline options.

---

## Teach Your Agents

Copy-paste these instructions so your AI agents discover and use the shared knowledge base automatically.

### Global instructions (`~/.github/copilot-instructions.md`)

```markdown
## Index Server
- If index-server MCP tools are available, use them as a shared knowledge base for validated cross-repo patterns and standards.
- Search before creating: use `index_search` with 2-5 keywords, then `index_dispatch` with action="get" for details.
- After learning something reusable, add it with `index_add` or promote from a repo with `promote_from_repo`.
- Index entries are promoted snapshots — always prefer current repo files over index content.
```

### Per-repo instructions (`.github/copilot-instructions.md`)

```markdown
## Index Server Integration
- Search order: repo files → .instructions/ → index-server → external docs
- **Search before add/promote**: Always search for existing guidance before creating new instructions. Use `index_search` with relevant keywords and inspect top results.
- To retrieve: `index_search` → `index_dispatch` with action="get" and the instruction ID
- To contribute: validate locally in `.instructions/` first, then promote with `promote_from_repo`
- To maintain: use `index_dispatch` with action="groom" to clean duplicates, `index_governanceUpdate` to deprecate stale content
- Current repo state always wins over promoted index snapshots
```

---

## Dashboard

The optional admin dashboard provides a Grafana-dark themed interface for monitoring and catalog management:

![Overview](docs/screenshots/panel-overview.png)

| Panel | Description |
|-------|-------------|
| **Overview** | Server health, uptime, system status |
| **Instructions** | Catalog browser with usage counts and governance status |
| **Monitoring** | Performance metrics and error rates |
| **Maintenance** | Backup, repair, and catalog operations |
| **Graph** | Mermaid dependency graph of instructions |

See [dashboard.md](docs/dashboard.md) for full details. REST client scripts (`scripts/index-server-client.ps1` and `scripts/index-server-client.sh`) provide full CRUD access for CI pipelines and subagents without MCP — see [tools.md](docs/tools.md#rest-client-scripts-agent-access-without-mcp).

---

## Key Features

- **MCP protocol compliance** — Full JSON-RPC 2.0 over stdio with schema validation
- **40+ tools** for search, CRUD, governance, analytics, messaging, and feedback
- **Semantic search** — Optional embedding-based similarity search (HuggingFace models)
- **Bootstrap security** — Mutations gated until human confirmation on fresh installs
- **Cross-repo knowledge promotion** — Validate locally, then promote proven patterns to the shared catalog
- **Governance workflows** — Ownership, versioning, approval status, and deterministic governance hashing
- **REST client scripts** — PowerShell and Bash scripts for CI/agents without MCP

---

## Documentation

| Document | Purpose |
|----------|---------|
| [Quick Start](docs/quickstart.md) | Get running in 5 minutes |
| [Use Cases](docs/use-cases.md) | Real-world scenarios and workflows |
| [API Reference](docs/tools.md) | Complete MCP tool documentation |
| [MCP Configuration](docs/mcp_configuration.md) | Setup patterns for all environments |
| [Server Configuration](docs/configuration.md) | Environment variables and CLI options |
| [Architecture](docs/architecture.md) | System design and component overview |
| [Admin Dashboard](docs/dashboard.md) | UI features, drift monitoring, maintenance |
| [Content Guidance](docs/content_guidance.md) | Local vs. central instruction guidance |
| [Network Privacy](docs/network-privacy.md) | Network transparency and offline deployment |
| [Documentation Index](docs/docs_index.md) | Full documentation map |

---

## Security

Index Server makes **zero telemetry calls** and sends **no data to external services** during normal operation. The dashboard binds to **localhost only** by default. Mutations are audit-logged, can be forced read-only with `INDEX_SERVER_MUTATION=0`, and fresh installations gate writes until human confirmation via the bootstrap workflow.

See [SECURITY.md](SECURITY.md) for vulnerability reporting and [Network Privacy Guide](docs/network-privacy.md) for offline deployment and verification.

---

## Development

```bash
npm install          # Install dependencies
npm run build        # Build TypeScript
npm test             # Run the fast default suite
npm run test:slow    # Run heavy integration/perf tests
npm run test:all     # Run the full Vitest suite
npm run typecheck    # Type checking
npm run lint         # Linting
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow, code standards, and testing requirements.

---

## License

MIT License — see [LICENSE](LICENSE) file for details.

---

Built with [Model Context Protocol (MCP)](https://modelcontextprotocol.io), TypeScript, Node.js, Vitest, and AJV.
