# MCP Stdio Logging — Fixing `[warning] [server stderr]` in VS Code

## The Problem

VS Code's MCP host hardcodes **all stderr output** as `LogLevel.Warning` with the
prefix `[server stderr]`. The relevant code in `extHostMcpNode.ts`:

```typescript
child.stderr.pipe(new StreamSplitter('\n')).on('data', line =>
  this._proxy.$onDidPublishLog(id, LogLevel.Warning, `[server stderr] ${line}`)
)
```

There is no configuration, no level detection, and no opt-out. Every byte written
to stderr by an MCP stdio server appears as `[warning] [server stderr] ...` in the
VS Code output channel.

## Why Other MCP Servers Show `[info]`

They **never write to stderr**. Instead, they use the MCP protocol's
`notifications/message` notification via `server.sendLoggingMessage()`:

```typescript
server.sendLoggingMessage({
  level: 'info',    // 'debug' | 'info' | 'warning' | 'error' | ...
  logger: 'my-server',
  data: 'Server started successfully',
});
```

VS Code handles these through `translateMcpLogMessage()` which correctly maps
levels to `logger.info()`, `logger.debug()`, `logger.warn()`, etc.

## The Challenge

On stdio transport, `stdout` is the MCP protocol channel (JSON-RPC). You **cannot**
write log output to stdout or it corrupts the protocol stream. So all logging must
go to stderr — but stderr is the thing that gets tagged as `[warning]`.

Additionally, the MCP handshake must complete before `sendLoggingMessage()` is
available. Any logging during server startup (config loading, handler registration,
schema validation, etc.) has nowhere to go except stderr.

## The Solution: `McpStdioLogger`

`src/lib/mcpStdioLogging.ts` provides a self-contained, reusable class that:

1. **Intercepts** `process.stderr.write` at construction time (before any module logs)
2. **Buffers** pre-handshake lines in memory (nothing reaches real stderr)
3. **Replays** the buffer through `server.sendLoggingMessage()` after activation
4. **Routes** all subsequent stderr through the MCP protocol with correct levels
5. **Falls back** to real stderr on transport failure (graceful degradation)

### Integration Steps (Any MCP Stdio Server)

#### Step 1: Import First

The logger must be created **before** any module that writes to stderr:

```typescript
// entry-point.ts — FIRST import
import { McpStdioLogger } from './lib/mcpStdioLogging';
const logger = new McpStdioLogger({ serverName: 'my-server' });
```

#### Step 2: Declare Logging Capability

The MCP server must declare `logging: {}` in its capabilities so clients know to
accept `notifications/message`:

```typescript
const server = new Server(
  { name: 'my-server', version: '1.0.0' },
  { capabilities: { tools: {}, logging: {} } }  // <-- logging: {} is required
);
```

#### Step 3: Register Server

After creating the server (but before connecting), register it with the logger:

```typescript
logger.registerServer(server);
```

#### Step 4: Activate After Handshake

After the MCP handshake completes (initialize response sent), activate the bridge:

```typescript
// In your initialize handler or after the handshake:
logger.activate();
```

This replays all buffered startup lines through the protocol with inferred levels,
then continues routing all stderr through `sendLoggingMessage()`.

### Configuration Options

```typescript
const logger = new McpStdioLogger({
  // Name shown in the `logger` field of MCP notifications/message
  serverName: 'my-server',         // default: 'mcp-server'

  // Max lines to buffer before handshake (oldest are dropped)
  maxBufferSize: 500,              // default: 500

  // Custom level inference (default: NDJSON + keyword heuristics)
  inferLevel: (line) => {
    if (line.includes('CUSTOM_ERROR')) return 'error';
    return 'info';
  },

  // Defer stderr interception (false = call interceptStderr() manually)
  interceptImmediately: true,       // default: true
});
```

### Level Inference

The built-in `defaultInferLevel()` function determines severity from raw stderr content:

| Priority | Method | Example |
|----------|--------|---------|
| 1 | NDJSON `"level"` field | `{"level":"WARN","msg":"..."}` → `warning` |
| 2 | Keyword `ERROR`/`FATAL` | `ERROR: connection failed` → `error` |
| 3 | Keyword `WARN` | `WARN: deprecated` → `warning` |
| 4 | Keyword `DEBUG`/`trace` | `[trace:load] ...` → `debug` |
| 5 | Default | Everything else → `info` |

Override with the `inferLevel` option for custom log formats.

### API Reference

| Method | Description |
|--------|-------------|
| `new McpStdioLogger(options?)` | Create logger, optionally intercept stderr immediately |
| `interceptStderr()` | Start intercepting stderr (idempotent) |
| `registerServer(server)` | Register MCP server instance |
| `activate()` | Replay buffer and start routing through MCP protocol |
| `log(level, data)` | Send a log message through MCP (no-op if inactive) |
| `restore()` | Restore original stderr, deactivate, clear buffer |
| `isActive` | Whether the bridge is currently routing through MCP |
| `bufferSize` | Number of currently buffered pre-handshake lines |

### Error Handling

- **Transport failure during active routing**: Bridge deactivates, restores
  original stderr. Future output goes to real stderr (visible as warnings, but
  the server doesn't crash).
- **Transport failure during buffer replay**: Remaining buffer is dumped to
  real stderr as a fallback. Bridge deactivates.
- **Server never registered/activated**: Lines stay buffered up to `maxBufferSize`.
  On process exit they're lost (acceptable — the server likely failed to start).

## Index Server Integration

Index server uses a thin adapter in `src/services/mcpLogBridge.ts` that wraps
`McpStdioLogger` and preserves the existing API (`registerMcpServer`,
`activateMcpLogBridge`, `isMcpLogBridgeActive`, `sendMcpLog`, `_restoreStderr`).

The wiring:
- `index-server.ts` — imports `mcpLogBridge` first (triggers stderr interception)
- `sdkServer.ts` — calls `registerMcpServer(server)` after server creation
- `handshakeManager.ts` — calls `activateMcpLogBridge()` after handshake
- `logger.ts` — routes structured logs through `sendMcpLog()` when active

## Applying to Other Repos

Copy `src/lib/mcpStdioLogging.ts` to your project and follow the 4-step
integration above. The module has **zero dependencies** beyond Node.js built-ins
and the MCP SDK server's `sendLoggingMessage()` method.

For TypeScript projects using `@modelcontextprotocol/sdk`, the `McpLoggable`
interface is already compatible with the SDK's `Server` class.

For JavaScript projects, any object with a `sendLoggingMessage({ level, logger, data })`
method will work.
