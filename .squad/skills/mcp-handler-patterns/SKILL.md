---
name: "mcp-handler-patterns"
description: "How to implement MCP tool handlers in this codebase"
domain: "backend-implementation"
confidence: "high"
source: "codebase"
---

## Context
All MCP tools are implemented as handlers registered via `registerHandler()`. New tools must follow
the A-1/A-2/Q-5 constitution patterns. This skill covers the exact registration flow for this repo.

## Patterns

### Handler Registration (A-1, Q-5)
Every handler lives in its own file under `src/handlers/` (or a subdirectory). It registers itself
via a side-effect import pattern:

```typescript
// src/handlers/myTool.ts
import { registerHandler } from '../server/registry.js';
import { z } from 'zod';

registerHandler('my_tool_name', async (params) => {
  // validate params, do work, return result
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});
```

```typescript
// src/services/toolHandlers.ts — add import at bottom (A-1)
import '../handlers/myTool.js';
```

### Tool Registry (A-2)
Every new tool must be registered in `src/services/toolRegistry.ts`:
- Add an entry to `INPUT_SCHEMAS` (JSON Schema object)
- Add to `STABLE` set (read-only tools) or `MUTATION` set (mutating tools)
- Assign a tier in `TOOL_TIERS` (`core` | `extended` | `admin`)
- Add Zod schema in `src/services/toolRegistry.zod.ts`

### Audit Logging (A-5)
All mutation handlers must call `logAudit()`:
```typescript
import { logAudit } from '../services/auditLog.js';
await logAudit({ action: 'my_tool_name', params, result });
```

### Mutation Gating (S-3)
Mutation tools must check `INDEX_SERVER_MUTATION` via `runtimeConfig.ts` before executing:
```typescript
import { runtimeConfig } from '../config/runtimeConfig.js';
if (!runtimeConfig.enableMutation) throw new Error('Mutations disabled');
```

### Return Shape
All handlers return MCP content format:
```typescript
return { content: [{ type: 'text', text: JSON.stringify(result) }] };
```
For errors, throw — the registry wraps in MCP error response automatically.

## Key Files
- `src/server/registry.ts` — `registerHandler()` implementation
- `src/services/toolHandlers.ts` — side-effect imports (add new handler here)
- `src/services/toolRegistry.ts` — INPUT_SCHEMAS, STABLE, MUTATION, TOOL_TIERS
- `src/services/toolRegistry.zod.ts` — Zod runtime schemas
- `src/services/auditLog.ts` — `logAudit()`
- `src/config/runtimeConfig.ts` — env config

## Anti-Patterns
- Never call `registerHandler` from `toolHandlers.ts` directly — keep in separate handler files
- Never hardcode paths or secrets — use `runtimeConfig.ts`
- Never skip `logAudit` on mutations — security requirement (S-3)
- Never add to STABLE and MUTATION sets simultaneously
