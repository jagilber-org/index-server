## Set Up TLS (Enhanced Profile)

The Enhanced profile enables HTTPS for the admin dashboard. You need a TLS certificate and key.

### Prerequisites

**OpenSSL** is required to generate certificates. You can get it from:
- **Git for Windows** (includes OpenSSL) — [git-scm.com/download/win](https://git-scm.com/download/win)
- **OpenSSL for Windows** — [slproweb.com/products/Win32OpenSSL.html](https://slproweb.com/products/Win32OpenSSL.html)
- **Linux / macOS** — `sudo apt install openssl` or `brew install openssl`

> The script automatically checks well-known paths like `C:\Program Files\Git\usr\bin` if `openssl` is not on your PATH.

### Generate a Self-Signed Certificate

From the server directory, run the built-in helper:

```bash
node scripts/generate-certs.mjs --hostname localhost --days 365
```

This creates `certs/server.crt` and `certs/server.key` in the current directory.

For a custom hostname or stronger key:

```bash
node scripts/generate-certs.mjs --hostname myserver.example.com --days 730 --key-size 4096
```

### Configure the Environment Variables

In your generated `mcp.json`, update these values:

| Variable | Value |
|----------|-------|
| `INDEX_SERVER_DASHBOARD_TLS` | `1` |
| `INDEX_SERVER_DASHBOARD_TLS_CERT` | Absolute path to `server.crt` |
| `INDEX_SERVER_DASHBOARD_TLS_KEY` | Absolute path to `server.key` |

### Verify

1. Restart the MCP server
2. Open the dashboard — it should load over `https://localhost:8787`

[Open Dashboard](command:index.openDashboard) · [Show Status](command:index.showStatus)

> **Note:** Browsers will warn about self-signed certs. Add an exception or import the CA cert (`certs/ca.crt`) into your trust store.

---

[← Back to Configure](command:workbench.action.openWalkthrough?%22jagilber-org.index-server%23index.gettingStarted%22) · [Re-generate Config](command:index.configure)

See [MCP Configuration Guide](https://github.com/jagilber-org/index-server/blob/main/docs/mcp_configuration.md) for production TLS patterns.
