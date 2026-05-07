## VS Code MCP Integration

Configure Index Server as an MCP server in VS Code using native MCP support.

Configure a custom MCP server in VS Code (or compatible client) by adding an entry like:

```jsonc
{
  "servers": {
    "instructionIndex": {
      "command": "npx",
      "args": ["-y", "@jagilber-org/index-server@latest", "--dashboard"],
      "transport": "stdio",
      "env": {
        "INDEX_SERVER_DIR": "C:/mcp/index-data/instructions"
      }
    }
  }
}
```

### Which Config File?

| Client | File | Root Key |
|--------|------|----------|
| **VS Code** (workspace) | `.vscode/mcp.json` | `servers` |
| **VS Code** (global) | `%APPDATA%/Code/User/mcp.json` | `servers` |
| **VS Code Insiders** (global) | `%APPDATA%/Code - Insiders/User/mcp.json` | `servers` |
| **Copilot CLI** (global) | `~/.copilot/mcp-config.json` | `mcpServers` |

VS Code uses the `servers` key. Copilot CLI and Claude Desktop use the `mcpServers` key with additional fields (`cwd`, `tools`).

VS Code can auto-discover Copilot CLI servers when `chat.mcp.discovery.enabled` is set to `true`.

Use `index-server --setup` (after `npm install -g @jagilber-org/index-server`) to generate the correct format for your target client.

See [MCP Configuration Guide](mcp_configuration.md#config-file-formats) for full format comparison and detailed examples.

### Notes

- Transport is stdio (newline-delimited JSON-RPC 2.0).
- The server emits a `server/ready` notification with `{ version }`.
- Dashboard (optional) is read-only and lists tool methods at `/tools.json`.
- Use `meta_tools` method for programmatic tool discovery.

Flags (pass in `args`):

| Flag | Description |
|------|-------------|
| `--dashboard` | Enable HTML dashboard + tools JSON endpoint |
| `--dashboard-port=PORT` | Preferred port (auto-increments if busy) |
| `--dashboard-host=HOST` | Bind address (default 127.0.0.1) |
| `--dashboard-tries=N` | Number of successive ports to attempt |
| `--no-dashboard` | Disable dashboard even if earlier flag provided |
| `--help` | Print help (stderr) and exit |

### Security Considerations

- Dashboard is local-only by default (bind changes via `--dashboard-host`).
- Mutation tools are enabled by default, but bootstrap confirmation still gates fresh installs.
- Set `INDEX_SERVER_MUTATION=0` when you want an explicit read-only runtime in shared or tightly controlled environments.

### Environment Flags Example

```jsonc
{
  "servers": {
    "instructionIndex": {
      "command": "npx",
      "args": ["-y", "@jagilber-org/index-server@latest", "--dashboard"],
      "transport": "stdio",
      "env": {
        "INDEX_SERVER_DIR": "C:/mcp/index-data/instructions",
        "INDEX_SERVER_VERBOSE_LOGGING": "1"
      }
    }
  }
}
```

### SQLite with Vector Embeddings Example

```jsonc
{
  "servers": {
    "instructionIndex": {
      "command": "npx",
      "args": ["-y", "@jagilber-org/index-server@latest", "--dashboard"],
      "transport": "stdio",
      "env": {
        "INDEX_SERVER_DIR": "C:/mcp/index-data/instructions",
        "INDEX_SERVER_STORAGE_BACKEND": "sqlite",
        "INDEX_SERVER_SQLITE_VEC_ENABLED": "1",
        "INDEX_SERVER_SEMANTIC_ENABLED": "1"
      }
    }
  }
}
```

> **Note:** sqlite-vec requires Node.js ≥ 22.13.0. If the native binary cannot load, embeddings fall back to JSON storage automatically.

Use a stable `INDEX_SERVER_DIR` outside VS Code config/install paths so your catalog is easy to back up and survives reinstalls.

### Troubleshooting

- Run `index-server --setup` (after `npm install -g @jagilber-org/index-server`) if you want the CLI to generate `mcp.json` for you.
- Set `INDEX_SERVER_VERBOSE_LOGGING=1` for detailed stderr diagnostics.
- Port conflicts: server auto-increments; check stderr for chosen port.

### Troubleshooting from a local checkout

- Ensure the repo is built before launching from source: run `npm run build`.
- Use a relative entrypoint path such as `dist/server/index-server.js`, not `/dist/server/index-server.js`.

Generated schemas are in `src/schemas/index.ts`; enforce via `npm run test:contracts`.
