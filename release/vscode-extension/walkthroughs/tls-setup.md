## Set Up TLS (Enhanced Profile)

The Enhanced profile enables HTTPS for the admin dashboard. You need a TLS certificate and key.

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
2. Run **Index Server: Open Dashboard**
3. The dashboard should load over `https://localhost:8787`

> **Note:** Browsers will warn about self-signed certs. Add an exception or import the CA cert (`certs/ca.crt`) into your trust store.

See [MCP Configuration Guide](https://github.com/jagilber-dev/index-server/blob/main/docs/mcp_configuration.md) for production TLS patterns.
