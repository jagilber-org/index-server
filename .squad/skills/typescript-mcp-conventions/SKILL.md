---
name: "typescript-mcp-conventions"
description: "TypeScript strict mode, module conventions, and MCP SDK usage for this repo"
domain: "project-conventions"
confidence: "high"
source: "codebase"
---

## Context
This repo uses TypeScript in strict mode with CommonJS output (`tsc`). The MCP SDK
(`@modelcontextprotocol/sdk`) handles protocol framing. All runtime config comes from
`src/config/runtimeConfig.ts`. Node.js ≥20.

## Patterns

### Module Imports
Always use `.js` extension in imports (CommonJS output with ESM-style resolution):
```typescript
import { registerHandler } from '../server/registry.js';
import { runtimeConfig } from '../config/runtimeConfig.js';
```
Never use `.ts` extensions or bare module names for local imports.

### Runtime Config
Never hardcode paths, ports, or feature flags. Always use `runtimeConfig`:
```typescript
import { runtimeConfig } from '../config/runtimeConfig.js';

const dataDir = runtimeConfig.dataDir;
const port = runtimeConfig.port;
const mutationEnabled = runtimeConfig.enableMutation;
```

### Zod Validation
All tool inputs validated at runtime with Zod. Schema in `toolRegistry.zod.ts`:
```typescript
import { z } from 'zod';

export const MyToolSchema = z.object({
  id: z.string().min(1),
  body: z.string().optional(),
});
type MyToolParams = z.infer<typeof MyToolSchema>;
```

### Error Handling
Throw `Error` with descriptive messages — the handler registry converts to MCP error format:
```typescript
if (!entry) throw new Error(`Instruction not found: ${id}`);
```
Do NOT return error objects — throw.

### Build Commands
```bash
npm run build       # tsc + copy assets
npm run typecheck   # tsc --noEmit (no output, just type-check)
npm run lint        # ESLint
```
Always run `typecheck` before committing.

### Conventional Commits (G-3)
```
feat: add new tool handler
fix: correct Index write race condition
test: add conformance test for new handler
refactor: extract schema validator
docs: update TOOLS.md with new tool
chore: bump dependencies
```

### Versioning (G-1, G-2)
- Semver: breaking=major, new feature=minor, fix=patch
- Every version bump requires CHANGELOG.md entry
- Never auto-push — human approves all pushes

## Key Files
- `tsconfig.json` — strict mode, CommonJS target, paths
- `src/config/runtimeConfig.ts` — all env config (S-4)
- `package.json` — scripts: build, typecheck, lint, test, coverage

## Anti-Patterns
- Never use `any` type — strict mode, use `unknown` then narrow
- Never hardcode `process.env` directly — always via `runtimeConfig.ts`
- Never use `require()` — use `import` (TypeScript handles the CJS output)
- Never commit without `npm run typecheck` passing
- Never auto-push — G-4 requires human approval
