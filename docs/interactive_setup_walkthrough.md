# Index Server — Interactive Setup Walkthrough

End-to-end walkthrough of the bundled configuration wizard, from `npx` launch through dashboard verification. The wizard prompts are reproduced inline as terminal facsimiles (no screenshots) so they stay in sync with the actual code.

```powershell
npx -y @jagilber-org/index-server@latest --setup
```

The wizard is **idempotent** — re-run it any time to change storage, transport, ports, or regenerate MCP client configs. The `--configure` flag is an alias for `--setup`. To remove an install, see the companion [`--uninstall` wizard](quickstart.md#wizard-driven-uninstall-recommended).

> Since v1.28.23 the wizard asks **9 flat questions** instead of a profile picker. Profile is now an internal-only concept derived from your answers (`sqlite → experimental`, `json + semantic → enhanced`, `json + no semantic → default`).

---

## 1. Launch

`npx` resolves the package, runs the server's startup preflight (logger, metrics, seed bootstrap), then renders the wizard banner.

```
╔════════════════════════════════════════════════════════════════╗
║             Index Server — Configuration Wizard               ║
║      MCP instruction indexing for AI governance               ║
╚════════════════════════════════════════════════════════════════╝
```

---

## 2. Storage backend

Choose how instructions are persisted:

- **`json`** — one file per instruction under `<base>/instructions/` (default; portable, easy to inspect/diff).
- **`sqlite`** — single `<base>/data/index.db` with FTS5 (faster cold-start and search on large catalogs).

This selection also drives the derived internal profile (`sqlite → experimental`).

```
? Storage backend (Use arrow keys)
❯ json — file-per-instruction (default, stable)
  sqlite — single database file, WAL mode (experimental)
```

---

## 3. Dashboard transport

- **`http`** — plain HTTP on the dashboard port (default; localhost-only is safe).
- **`https`** — HTTPS; the wizard will offer to generate a self-signed cert chain via OpenSSL in step 11.

```
? Dashboard transport (Use arrow keys)
❯ http — plain HTTP (localhost only)
  https — TLS with self-signed certs (auto-generated)
```

---

## 4. Semantic search

Defaults to **yes**. Enables embedding-based search; the first semantic query downloads the ~90 MB MiniLM model into `<base>/data/models/`.

```
? Enable semantic search? (downloads ~90MB MiniLM model on first run) (Y/n)
```

---

## 5. Base directory

Single root under which every data path (instructions, embeddings, SQLite db, TLS certs, metrics, logs) is resolved. Press `Enter` to accept the platform default — `%LocalAppData%\index-server` on Windows, `~/.local/share/index-server` on Linux/macOS.

```
? Base directory (all data paths resolve under this root)
  (C:\Users\<you>\AppData\Local\index-server)
```

---

## 6. Backup directory

Where pre-mutation zip backups land. Defaults to `<base>/backups`.

> ⚠️ **Strongly recommended:** place backups on a **different drive or path** than the base directory. Same-disk backups will not protect against drive failure, encryption, or volume loss. The wizard prints this warning inline before the prompt.

```
  ⚠️  Strongly recommended: place backups on a DIFFERENT drive or path than the base directory.
     Same-disk backups will not protect against drive failure, encryption, or volume loss.

? Backup directory (defaults to <base>/backups; enter a path to override)
  (C:/Users/<you>/AppData/Local/index-server/backups)
```

This is the only field that sets `INDEX_SERVER_BACKUPS_DIR` as **active** in the generated `mcp.json` (the env var is omitted when you accept the in-base default, so backups follow `<base>` automatically).

---

## 7. Dashboard port

Port for the admin/dashboard HTTP(S) listener. Default **8787**.

```
? Dashboard port (8787)
```

---

## 8. Dashboard host

Bind address. Localhost-only (`127.0.0.1`) is recommended unless you intentionally want remote access (`0.0.0.0`).

```
? Dashboard host (Use arrow keys)
❯ 127.0.0.1 — localhost only (recommended)
  0.0.0.0 — all network interfaces
```

---

## 9. MCP client targets

Multi-select — pick every MCP client you want a config written for. `space` toggles, `a` selects all, `i` inverts, `↵` submits.

```
? Which MCP client configs should be generated?
  (Press <space> to select, <a> to toggle all, <i> to invert)
❯◉ VS Code (.vscode/mcp.json)
 ◯ Copilot CLI (~/.copilot/mcp-config.json)
 ◯ Claude Desktop (claude_desktop_config.json)
```

---

## 10. Configuration scope

Per-target choice (only shown when VS Code is one of the targets): write to the **user-global** location (default), or to the workspace/repo (`.vscode/mcp.json`).

```
? Configuration scope (Use arrow keys)
❯ Global — user-level config (applies to all workspaces)
  Workspace/repo — .vscode/mcp.json in current directory
```

---

## 11. TLS certs (only if transport = `https`)

When step 3 selected HTTPS, the wizard offers to generate a localhost self-signed cert chain via OpenSSL.

```
? Generate self-signed TLS certificates now? (Y/n)
```

---

## 12. Index locations & configuration preview

The wizard prints all resolved data paths and the exact JSON it is about to write to each target, so you can review before any file is touched.

```
Index locations:
  base               C:\Users\<you>\AppData\Local\index-server
  instructions       <base>\instructions
  data               <base>\data
  backups            <base>\backups
  logs               <base>\logs
  metrics            <base>\metrics
  certs              <base>\certs

Preview — vscode (global):
{
  "servers": {
    "index-server": {
      "command": "npx",
      "args": ["-y", "@jagilber-org/index-server"],
      "env": {
        "INDEX_SERVER_PROFILE": "enhanced",
        "INDEX_SERVER_BASE": "...",
        "DASHBOARD_HOST": "127.0.0.1",
        "DASHBOARD_PORT": "8787",
        "INDEX_SERVER_TLS": "1",
        "...": "..."
      }
    }
  }
}
```

The generated `mcp.json` (user-global, VS Code) sets the standard `INDEX_SERVER_*` env vars on the `index-server` entry — derived profile, dashboard host/port, TLS cert paths under the chosen base directory, semantic search, storage backend, log level, mutation, metrics-file storage, and (only when customized) `INDEX_SERVER_BACKUPS_DIR`.

---

## 13. TLS generation, config write, runtime confirmation

Final wizard output: the cert chain (CA + server pair) is generated, the MCP client config is written (existing files are timestamp-backed-up), and the deployed runtime version is confirmed.

```
✓ Generated TLS chain: <base>\certs\{ca.pem, server.pem, server.key}
✓ Backed up existing config → mcp.json.<timestamp>.bak
✓ Wrote vscode (global) → <user-config>\mcp.json
✓ Deployed runtime confirmed: @jagilber-org/index-server@<version>

Next Steps:
  1. Restart your MCP client to load the new config.
  2. Open the dashboard at https://127.0.0.1:8787/admin
  3. Re-run `index-server --setup` any time to reconfigure.
```

---

## 14. Enable the tools in VS Code

Open VS Code, then **Configure Tools** (chat picker). Check the `index-server` group to expose all of its tools to your AI agent.

---

## 15. Open the dashboard

Browse to **https://localhost:8787/admin** (or `http://…` if you chose HTTP) and accept the self-signed certificate (Edge / Chrome will show "Not secure" — expected for the local CA generated in Step 11).

---

## Recap (9 flat questions)

| # | Step | Walkthrough selection |
|---|------|-------------------------------|
| 1 | Launch | `npx -y @jagilber-org/index-server@latest --setup` |
| 2 | Storage backend | `sqlite` |
| 3 | Dashboard transport | `https` |
| 4 | Semantic search | `yes` (default) |
| 5 | Base directory | platform default accepted |
| 6 | Backup directory | **off-disk path** (recommended) |
| 7 | Dashboard port | `8787` |
| 8 | Dashboard host | `127.0.0.1` (localhost only) |
| 9 | MCP client targets | VS Code |
| 10 | Configuration scope | **Global** (user-level) |
| 11 | Generate TLS certs | **Yes** (HTTPS path) |
| 12 | Paths + JSON preview | OK |
| 13 | Cert generation + write | OK (existing `mcp.json` backed up) |
| 14 | Enable tools in VS Code | `Configure Tools` → check **index-server** |
| 15 | Open dashboard | https://localhost:8787/admin |

After restarting the MCP client, the `index-server` tools become available to your AI agent. The first semantic query downloads the ~90 MB MiniLM model into the `data/models` cache.

To re-run this wizard later (idempotent):

```powershell
npx -y @jagilber-org/index-server@latest --setup    # works without a global install
index-server --setup                                # if installed globally
```

To uninstall (also wizard-driven):

```powershell
index-server --uninstall                            # interactive checkbox cleanup
index-server --uninstall --non-interactive --all    # wipe everything
```
