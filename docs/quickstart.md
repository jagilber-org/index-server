# Quick Start Guide

Get Index Server running with HTTPS and semantic search in 5 minutes.

## Prerequisites

- **Node.js** >= 22 LTS
- **npm** (included with Node.js)
- An MCP client — VS Code with Copilot, Claude Desktop, or similar

## 1. Install

### Recommended: use the published package and setup wizard

```bash
npm install -g @jagilber-org/index-server
index-server --setup
```

This generates MCP client configuration for VS Code, Copilot CLI, or Claude Desktop and keeps the install flow MCP-native from the start.

> No-install alternative: `npx -y @jagilber-org/index-server@latest --setup` (resolves from npmjs.org; GitHub Packages requires authentication).

### Alternative: install or build locally

```bash
npm install -g @jagilber-org/index-server
index-server --setup        # generate .env + MCP client config
```

Or build from source:

```bash
git clone https://github.com/jagilber-org/index-server.git
cd index-server
npm install
npm run build
npm run setup               # interactive configuration wizard
```

## 2. Configure MCP Client

If you used `--setup`, it can generate this for you. Otherwise add this to your VS Code `.vscode/mcp.json`:

```jsonc
{
  "servers": {
    "index-server": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@jagilber-org/index-server@latest",
        "--dashboard",
        "--dashboard-port=8787"
      ],
      "env": {
        "INDEX_SERVER_LOG_LEVEL": "info",
        "INDEX_SERVER_DIR": "C:/mcp/index-data/instructions"
      }
    }
  }
}
```

Replace `C:/mcp/index-data/instructions` with your preferred persistent data directory.

> **Best practice:** keep `INDEX_SERVER_DIR` in a stable data location outside VS Code and MCP client config paths so backups and reinstalls do not disturb your instruction catalog.

## 3. Enable HTTPS (Optional)

```bash
# Interactive (arrow-key menus)
npm run setup

# Non-interactive
node scripts/setup-wizard.mjs --non-interactive --tls --port 8787

# Or, one-shot CLI bootstrap (requires openssl on PATH):
index-server --init-cert --start --dashboard
```

This generates self-signed certificates in `.certs/` and configures the dashboard for HTTPS.

The `--init-cert` switch is the lightweight CLI alternative: it generates a
self-signed cert+key under `~/.index-server/certs/` and (with `--start`)
auto-wires `--dashboard-tls` so no extra flags are needed. See
[`docs/cert_init.md`](cert_init.md) for the full reference.

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
3. Open `http://localhost:8787` (or `https://`) for the dashboard
4. Run a health check — ask your agent: _"use health_check to verify index-server is running"_
5. Verify bootstrap status: _"use bootstrap to check initialization status"_
6. If your client supports MCP prompts, run `prompts/list` and confirm `setup_index_server`, `configure_index_server`, and `verify_index_server` appear
7. If your client supports MCP resources, run `resources/list` and read `index://guides/quickstart`

> **Tip:** On a fresh install, bootstrap may report `gated` status until the bootstrapper instruction is loaded.
> This is normal — index_add and other mutation tools are available immediately.

### Read-only setup guidance surface

Index Server now exposes a minimal Stage 2 MCP-native guidance surface for clients that support prompts/resources:

- **Prompts**: `setup_index_server`, `configure_index_server`, `verify_index_server`
- **Resources**: `index://guides/quickstart`, `index://guides/client-config`, `index://guides/verification`

Use these read-only surfaces for installation help, config review, and troubleshooting. If your client does not surface prompts/resources yet, continue with the standard `tools/list` + `health_check` flow above.

## 6. Add Your First Instruction

Ask your agent:

```
Use index_add to create an instruction with id "my-first-guide",
title "Getting Started Guide", and body with your team's onboarding steps.
```

Or via the dashboard: navigate to **Instructions** → **+ New**.

Verify it was created:

```
Use index_search with keywords "getting started" to find your new instruction.
```

## How to Invoke Tools

Different MCP clients discover tools differently:

| Client | How to invoke tools |
|--------|-------------------|
| **VS Code** | Type `#index-server` in Copilot Chat to attach tools, then ask naturally |
| **Copilot CLI** | Tools are auto-discovered from `~/.copilot/mcp-config.json` — just ask |
| **Claude Desktop** | Tools are auto-discovered from `claude_desktop_config.json` — just ask |
| **Dashboard** | Navigate to the Tools panel and invoke directly |

> **VS Code tip:** You can also invoke tools without `#index-server` if the server is in your
> `.vscode/mcp.json` — Copilot will auto-discover available MCP tools.

## Upgrading and Uninstalling

### Upgrade to the latest release

```powershell
npm install -g @jagilber-org/index-server@latest
index-server --version
```

### Clean uninstall (and how to recover from a stale install)

If `index-server --setup` fails with errors like `env contains unsupported INDEX_SERVER key: …` or `Cannot find module …\node_modules\@jagilber-org\index-server\dist\server\index-server.js`, you almost certainly have a stale non-global install shadowing the upgraded global one. Wipe everything and reinstall:

```powershell
# 1. Remove the global install
npm uninstall -g @jagilber-org/index-server

# 2. Clear the npm cache (forces a fresh download)
npm cache clean --force

# 3. Remove any stray non-global install in your home directory
#    (left behind by an earlier `npm install` without -g)
Remove-Item "$env:USERPROFILE\node_modules\@jagilber-org" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$env:USERPROFILE\index-server.ps1","$env:USERPROFILE\index-server.cmd","$env:USERPROFILE\index-server" -Force -ErrorAction SilentlyContinue

# 4. Reinstall fresh
npm install -g @jagilber-org/index-server@latest

# 5. Verify the resolution points at your npm global prefix
Get-Command index-server -All | Format-Table Source
node -e "console.log(require('@jagilber-org/index-server/package.json').version)"
```

On macOS / Linux replace step 3 with `rm -rf ~/node_modules/@jagilber-org ~/.local/bin/index-server`.

> Why this happens: a previous `npm install @jagilber-org/index-server` (without `-g`) creates `~/node_modules/@jagilber-org/index-server`. Node's CommonJS resolver walks parent directories from the cwd and finds that copy *before* the global prefix, so future global upgrades appear to "not take effect". `npm uninstall -g` does not touch the home-directory copy.

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
