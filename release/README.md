# Index — VS Code Extension

## Install

### Option 1 — VS Code Marketplace (Recommended)

Search for **"Index"** in the VS Code Extensions sidebar, or:

```bash
code --install-extension jagilber-org.Index
```

### Option 2 — Open VSX (VS Codium / Code OSS)

Search for **"Index"** in the Open VSX registry, or install from [open-vsx.org](https://open-vsx.org/extension/jagilber-org/index-server).

### Option 3 — Manual VSIX Install

Download the latest `.vsix` from [GitHub Releases](https://github.com/jagilber-org/index-server/releases), then:

### 2. Install in VS Code

**Option A — Command Line:**
```bash
code --install-extension Index-<version>.vsix
# For VS Code Insiders:
code-insiders --install-extension Index-<version>.vsix
```

**Option B — VS Code UI:**
1. Open VS Code
2. Press `Ctrl+Shift+P` → type **"Extensions: Install from VSIX..."**
3. Browse to and select the `.vsix` file
4. Reload VS Code when prompted

### 3. Configure the MCP Server

After installing the extension, you need to point it to a running Index Server.

**Option A — Use the built-in command:**
1. Press `Ctrl+Shift+P` → **"Index: Configure MCP Client"**
2. The extension generates the MCP client configuration
3. Copy it to your `mcp.json` (VS Code) or Claude Desktop config

**Option B — Manual configuration in VS Code `mcp.json`:**

Add to `~/.vscode/mcp.json` or `%APPDATA%/Code/User/mcp.json`:

```jsonc
{
  "servers": {
    "Index": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/path/to/index-server/dist/server/index-server.js"],
      "cwd": "C:/path/to/index-server",
      "env": {
        "INDEX_SERVER_LOG_LEVEL": "info",
        "INDEX_SERVER_MUTATION": "1",
        "INDEX_SERVER_DASHBOARD": "1",
        "INDEX_SERVER_DASHBOARD_PORT": "8787"
      }
    }
  }
}
```

### 4. Verify

- Press `Ctrl+Shift+P` → **"Index: Show Status"**
- Check the Output panel (`Index` channel) for status details

---

## Build from Source

### Prerequisites

- **Node.js** >= 20
- **npm** (included with Node.js)

### Build Steps

```powershell
# Navigate to the extension directory
cd release/vscode-extension

# Build the VSIX (lightweight — server not bundled)
pwsh build-vsix.ps1

# Build with bundled server (standalone — no separate server install needed)
pwsh build-vsix.ps1 -IncludeServer
```

### Manual Build (without PowerShell)

```bash
cd release/vscode-extension
npm install --ignore-scripts
npx tsc -p tsconfig.json
npx @vscode/vsce package --no-dependencies --allow-missing-repository
```

The `.vsix` file will be created in the `release/` directory.

---

## Extension Commands

| Command | Description |
|---------|-------------|
| `Index: Configure MCP Client` | Generate MCP client config for VS Code or Claude Desktop |
| `Index: Show Status` | Show server path, settings, and connection status |
| `Index: Open Dashboard` | Open the admin dashboard in your browser |

## Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `index.serverPath` | `""` | Path to `dist/server/index-server.js` |
| `index.instructionsDir` | `""` | Path to instructions directory |
| `index.dashboard.enabled` | `false` | Enable admin dashboard |
| `index.dashboard.port` | `8787` | Dashboard HTTP port |
| `index.logLevel` | `info` | Server log level |
| `index.mutation.enabled` | `false` | Enable mutation operations |

---

## MCP Tools Provided

When connected, Index exposes these tool categories:

| Category | Tools | Description |
|----------|-------|-------------|
| **Health** | `health_check` | Server health and diagnostics |
| **Instructions** | `Index_dispatch`, `Index_search`, `Index_add`, `Index_import`, `Index_remove`, `Index_reload`, `Index_groom`, `Index_enrich`, `Index_repair`, `Index_normalize`, `Index_schema`, `Index_diagnostics` | Full instruction index CRUD |
| **Governance** | `Index_governanceHash`, `Index_governanceUpdate`, `gates_evaluate` | Ownership, versioning, approval workflows |
| **Usage** | `usage_track`, `usage_hotset`, `usage_flush` | Usage analytics and tracking |
| **Metrics** | `metrics_snapshot` | Performance and operational metrics |
| **Graph** | `graph_export` | Instruction relationship visualization |
| **Feedback** | `feedback_submit`, `feedback_list`, `feedback_get`, `feedback_update`, `feedback_stats`, `feedback_health` | Issue tracking and feedback |
| **Manifest** | `manifest_status`, `manifest_refresh`, `manifest_repair` | Index manifest management |
| **Bootstrap** | `bootstrap_request`, `bootstrap_confirmFinalize`, `bootstrap_status` | Security confirmation gating |
| **Meta** | `meta_tools`, `meta_activation_guide`, `meta_check_activation` | Self-documentation and activation help |
| **Help** | `help_overview` | Onboarding and overview |
| **Integrity** | `integrity_verify` | Index integrity verification |
| **Prompt** | `prompt_review` | Prompt quality review |

---

## Deployment Options

### Option 1: Lightweight Extension + Separate Server

Install the VSIX extension and run Index separately:

```bash
# Clone and build the server
git clone https://github.com/jagilber-org/index-server.git
cd index-server
npm install
npm run build

# Install the extension
code --install-extension release/Index-1.6.4.vsix
```

Then configure the extension to point to your server via settings.

### Option 2: Standalone Extension (Server Bundled)

Build the VSIX with the server bundled:

```powershell
cd release/vscode-extension
pwsh build-vsix.ps1 -IncludeServer
```

This creates a self-contained VSIX that includes the server and instructions — no separate server installation needed.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Server entry point not found" | Set `index.serverPath` in VS Code settings |
| Extension doesn't activate | Check VS Code version >= 1.99.0 |
| Dashboard won't open | Enable `index.dashboard.enabled` and restart server |
| MCP tools not appearing | Verify `mcp.json` configuration and restart VS Code |
| Build fails | Ensure Node.js >= 20 and run `npm install` in the repo root |

---

## Uninstall

```bash
code --uninstall-extension jagilber-org.Index
# For VS Code Insiders:
code-insiders --uninstall-extension jagilber-org.Index
```

Or use VS Code UI: Extensions panel → Find "Index" → Uninstall.
