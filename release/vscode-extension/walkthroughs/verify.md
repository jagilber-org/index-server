## Verify Your Setup

Confirm the Index Server is running and connected.

### 1. Check Status

Run **Index Server: Show Status** from the Command Palette.

You should see:
- ✅ Server path resolved (local or npx)
- ✅ Instructions directory found
- ✅ Profile and feature flags

### 2. Test in Copilot Chat

Open Copilot Chat in **agent mode** and try:

```
Search the instruction index for getting started
```

Copilot should call `index_search` and return matching instructions.

### 3. Check the Dashboard (if enabled)

If you enabled the dashboard (`index.dashboard.enabled: true`):

1. Run **Index Server: Open Dashboard**
2. Verify it loads at `http://localhost:8787` (or your configured port)
3. Check the **Health** panel for green status

### Troubleshooting

| Problem | Fix |
|---------|-----|
| "Command not found" | Restart VS Code — the extension activates on startup |
| Server not starting | Check Output panel → "Index Server" for error logs |
| No search results | Verify `INDEX_SERVER_DIR` points to a folder with `.json` instruction files |
| Dashboard won't open | Ensure `index.dashboard.enabled` is `true` in settings |
| MCP tools not appearing | Check that the MCP server shows as connected in VS Code's MCP panel |

### Next Steps

- Add your own instructions to the `INDEX_SERVER_DIR` folder
- Enable [mutation](command:index.configure) to add/edit instructions via MCP tools
- Explore the [full configuration guide](https://github.com/jagilber-dev/index-server/blob/main/docs/mcp_configuration.md)
