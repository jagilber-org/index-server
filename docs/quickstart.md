# Quick Start Guide

Get Index Server running with HTTPS and semantic search in 5 minutes.

## Prerequisites

- **Node.js** >= 22 LTS
- **npm** (included with Node.js)
- An MCP client — VS Code with Copilot, Claude Desktop, or similar

## 1. Install

```bash
git clone https://github.com/jagilber-org/index-server.git
cd index-server
npm install
npm run build
```

Or via npm:

```bash
npm install @jagilber-org/index-server
```

## 2. Configure MCP Client

Add to your VS Code `.vscode/mcp.json`:

```jsonc
{
  "servers": {
    "index-server": {
      "type": "stdio",
      "command": "node",
      "args": [
        "C:/path/to/index-server/dist/server/index-server.js",
        "--dashboard",
        "--dashboard-port=3210"
      ],
      "env": {
        "INDEX_SERVER_MUTATION": "1",
        "INDEX_SERVER_LOG_LEVEL": "info",
        "INDEX_SERVER_DIR": "C:/path/to/index-server/instructions"
      }
    }
  }
}
```

Replace `C:/path/to/index-server` with your actual install path.

## 3. Enable HTTPS (Optional)

```bash
node scripts/setup-wizard.mjs --non-interactive --tls --port 3210 --mutation
```

This generates self-signed certificates in `.certs/` and configures the dashboard for HTTPS.

Or manually:

```bash
# Set environment variables
INDEX_SERVER_TLS_CERT=.certs/server.crt
INDEX_SERVER_TLS_KEY=.certs/server.key
INDEX_SERVER_ALLOW_INSECURE_TLS=1   # For self-signed certs in local dev
```

## 4. Enable Semantic Search (Optional)

Add to your MCP env config:

```jsonc
{
  "env": {
    "INDEX_SERVER_SEMANTIC_ENABLED": "1"
  }
}
```

Only `INDEX_SERVER_SEMANTIC_ENABLED` is required — everything else has sensible defaults:

| Variable | Default | Description |
|---|---|---|
| `INDEX_SERVER_SEMANTIC_ENABLED` | `0` | Enable semantic (embedding-based) search |
| `INDEX_SERVER_SEMANTIC_MODEL` | `Xenova/all-MiniLM-L6-v2` | Hugging Face model for embeddings |
| `INDEX_SERVER_SEMANTIC_DEVICE` | `cpu` | Inference device: `cpu`, `dml` (DirectML/GPU on Windows), `cuda` |
| `INDEX_SERVER_SEMANTIC_CACHE_DIR` | `data/models/` | Directory for downloaded model files |
| `INDEX_SERVER_EMBEDDING_PATH` | `data/embeddings.json` | Persisted embedding cache |
| `INDEX_SERVER_SEMANTIC_LOCAL_ONLY` | `0` | Skip model download, use pre-cached model only |

**Example with GPU acceleration (Windows DirectML):**

```jsonc
{
  "env": {
    "INDEX_SERVER_SEMANTIC_ENABLED": "1",
    "INDEX_SERVER_SEMANTIC_DEVICE": "dml",
    "INDEX_SERVER_SEMANTIC_CACHE_DIR": "C:/path/to/shared/model-cache"
  }
}
```

On first search, the server downloads a ~90 MB embedding model from Hugging Face (one-time). After that, all searches default to semantic mode — no `mode` parameter needed. Set `INDEX_SERVER_SEMANTIC_LOCAL_ONLY=1` for air-gapped/offline environments (requires pre-cached model).

## 5. Verify

1. Restart VS Code / your MCP client
2. The server should appear in the MCP server list
3. Open `http://localhost:3210` (or `https://`) for the dashboard
4. Ask your agent: _"search index-server for getting started"_

## 6. Add Your First Instruction

Ask your agent:

```
Use index_add to create an instruction with id "my-first-guide",
title "Getting Started Guide", and body with your team's onboarding steps.
```

Or via the dashboard: navigate to **Instructions** → **+ New**.

## What's Next

- **[Use Case Scenarios](use-cases.md)** — Real-world examples
- **[MCP Configuration](mcp_configuration.md)** — Advanced patterns (profiles, multi-instance)
- **[Tools Reference](tools.md)** — Complete tool catalog
- **[Docker Deployment](docker_deployment.md)** — Container deployment with TLS
- **[Dashboard Guide](dashboard.md)** — Admin UI features

## Teach Your Agents

Add this to your global `copilot-instructions.md` (or repo-level) so agents know about Index Server:

```markdown
## Index Server

- Use index-server for validated cross-repo knowledge, not for reading current file contents.
- Start with `index_search` to find relevant instructions, then `index_dispatch get` for details.
- After learning something reusable, promote it with `index_add`.
- Prefer the local-first flow: repo files → .instructions/ → index-server → external docs.
```
