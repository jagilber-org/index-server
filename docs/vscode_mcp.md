## VS Code MCP Integration

Configure a custom MCP server in VS Code (or compatible client) by adding an entry like:

```jsonc
{
  "servers": {
    "instructionIndex": {
      "command": "node",
      "args": ["dist/server/index-server.js", "--dashboard"],
      "transport": "stdio"
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

Use the VS Code extension's **Index Server: Configure MCP Client** command to generate the correct format for your target client.

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
- Mutation tools are gated; enable with `INDEX_SERVER_MUTATION=1` only in trusted contexts.
- Prefer leaving gating off in multi-tenant or shared environments.

### Environment Flags Example

```jsonc
{
  "servers": {
    "instructionIndex": {
      "command": "node",
      "args": ["dist/server/index-server.js", "--dashboard"],
      "transport": "stdio",
      "env": {
        "INDEX_SERVER_MUTATION": "1",
        "INDEX_SERVER_VERBOSE_LOGGING": "1"
      }
    }
  }
}
```

Omit the `env` block for read-only default.

### Troubleshooting

- Ensure build: run `npm run build` before launching.
- Remove any leading slash in the entrypoint path (`dist/server/index-server.js`, not `/dist/server/index-server.js`).
- Set `INDEX_SERVER_VERBOSE_LOGGING=1` for detailed stderr diagnostics.
- Port conflicts: server auto-increments; check stderr for chosen port.

Generated schemas are in `src/schemas/index.ts`; enforce via `npm run test:contracts`.
