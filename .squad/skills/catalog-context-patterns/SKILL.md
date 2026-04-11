---
name: "Index-context-patterns"
description: "How to use IndexContext — the single source of truth for the instruction Index"
domain: "backend-implementation"
confidence: "high"
source: "codebase"
---

## Context
`IndexContext` (A-3) is the singleton managing all Index read/write state. Every handler that
reads or writes Index entries must go through it. Direct file I/O is forbidden outside of
IndexContext.

## Patterns

### Getting IndexContext
```typescript
import { getIndexContext } from '../services/IndexContext.js';

const ctx = await getIndexContext();
await ctx.ensureLoaded();
```

### Reading Entries
```typescript
const entries = ctx.getAll();          // all entries
const entry = ctx.getById('some-id'); // single entry or undefined
```

### Writing Entries (requires mutation gating)
```typescript
await ctx.writeEntry(entry);    // upsert a single entry
await ctx.invalidate();         // force reload from disk on next access
```

### Batch Operations
```typescript
const entries = ctx.getAll();
// filter/map, then write individually
for (const e of modified) {
  await ctx.writeEntry(e);
}
```

### Schema Validation Before Write
Always validate against the instruction schema before writing:
```typescript
import { validateInstruction } from '../services/schemaValidator.js';
const errors = validateInstruction(entry);
if (errors.length > 0) throw new Error(`Invalid: ${errors.join(', ')}`);
```

## Key Files
- `src/services/IndexContext.ts` — IndexContext class
- `src/services/schemaValidator.ts` — ajv-based validator
- `schemas/instruction.schema.json` — JSON Schema for entries

## Anti-Patterns
- Never read/write `.json` Index files directly with `fs` — always via IndexContext
- Never cache `ctx` across async boundaries — always call `getIndexContext()` fresh
- Never skip `ensureLoaded()` before reading — Index may not be initialized
- Never bypass schema validation on writes — corrupt entries break the whole Index
