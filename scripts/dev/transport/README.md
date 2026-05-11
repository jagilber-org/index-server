# scripts/dev/transport

Shared MCP stdio harness used by all dev-server probe scripts.

## Scripts

| Script | Purpose |
|--------|---------|
| `mcp-stdio.mjs` | Spawn `dist/server/index-server.js` with a caller-supplied env, drive the JSON-RPC handshake, and expose `callTool(name, args)` / `close()` |

## Usage

Import this module in any probe script:

```js
import { startMcp } from '../transport/mcp-stdio.mjs';

const mcp = await startMcp({ env, distServer, cwd: process.cwd() });
const result = await mcp.callTool('index_search', { keywords: ['foo'] });
await mcp.close();
```

All scripts in `../diagnostic/`, `../integrity/`, and `../util/` depend on this
module. It uses stdio transport so it never collides with a running dashboard
server's HTTP port.
