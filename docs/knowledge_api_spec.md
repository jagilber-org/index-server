# Knowledge Store REST API — Implementation Spec

**Requested by:** mcp-agent-manager IndexClient  
**Date:** 2026-02-09  
**Priority:** Medium  
**Effort:** Small (1 new file, 1 edit, 1 test file)

## Summary

Add three REST endpoints to the dashboard API so mcp-agent-manager can store/retrieve cross-repo agent performance insights. The mcp-agent-manager IndexClient already calls these endpoints with circuit breaker + 404-graceful-degradation. Currently they return 404; implementing them enables cross-repo knowledge sharing.

## Files to Create

### 1. `src/dashboard/server/KnowledgeStore.ts` (NEW)

In-memory + file-backed key-value store. Persists to `{dataDir}/knowledge-store.json`.

```typescript
import fs from 'fs';
import path from 'path';
import { getRuntimeConfig } from '../../config/runtimeConfig';

export interface KnowledgeEntry {
  key: string;           // e.g. "agent-performance:agent-1"
  content: string;       // human-readable summary text
  metadata: Record<string, unknown>;
  createdAt: string;     // ISO timestamp
  updatedAt: string;     // ISO timestamp
}

class KnowledgeStore {
  private entries: Map<string, KnowledgeEntry> = new Map();
  private filePath: string;

  constructor() {
    const dataDir = getRuntimeConfig().Index?.baseDir || path.join(process.cwd(), 'data');
    this.filePath = path.join(dataDir, 'knowledge-store.json');
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        if (Array.isArray(raw)) {
          for (const entry of raw) {
            if (entry.key) this.entries.set(entry.key, entry);
          }
        }
      }
    } catch { /* ignore */ }
  }

  private saveToDisk(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(Array.from(this.entries.values()), null, 2));
    } catch { /* ignore */ }
  }

  upsert(key: string, content: string, metadata: Record<string, unknown> = {}): KnowledgeEntry {
    const now = new Date().toISOString();
    const existing = this.entries.get(key);
    const entry: KnowledgeEntry = {
      key,
      content,
      metadata: { ...metadata },
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    this.entries.set(key, entry);
    this.saveToDisk();
    return entry;
  }

  get(key: string): KnowledgeEntry | undefined {
    return this.entries.get(key);
  }

  search(query: string, options?: { category?: string; limit?: number }): KnowledgeEntry[] {
    const q = query.toLowerCase();
    const limit = options?.limit || 20;
    const results: KnowledgeEntry[] = [];

    for (const entry of this.entries.values()) {
      if (results.length >= limit) break;
      if (options?.category && entry.metadata?.category !== options.category) continue;

      const searchable = [entry.key, entry.content, ...Object.values(entry.metadata).map(v => String(v))].join(' ').toLowerCase();
      if (searchable.includes(q)) results.push(entry);
    }
    return results;
  }

  delete(key: string): boolean {
    const existed = this.entries.delete(key);
    if (existed) this.saveToDisk();
    return existed;
  }

  count(): number {
    return this.entries.size;
  }
}

let instance: KnowledgeStore | null = null;
export function getKnowledgeStore(): KnowledgeStore {
  if (!instance) instance = new KnowledgeStore();
  return instance;
}
```

## Files to Edit

### 2. `src/dashboard/server/ApiRoutes.ts` (EDIT)

**Add import** at top with other imports:
```typescript
import { getKnowledgeStore } from './KnowledgeStore.js';
```

**Add routes** inside `createApiRoutes()`, after the Instruction Management Routes section. Add a comment header:

```typescript
// ===== Knowledge Store Routes =====
```

**IMPORTANT:** Register `/knowledge/search` BEFORE `/knowledge/:key` so Express doesn't interpret "search" as a `:key` parameter.

#### Endpoint 1: POST /api/knowledge

```typescript
/**
 * POST /api/knowledge - Store or update a knowledge entry
 * Body: { key: string, content: string, metadata?: Record<string, unknown> }
 */
router.post('/knowledge', (req: Request, res: Response) => {
  try {
    const { key, content, metadata } = req.body;
    if (!key || typeof key !== 'string') {
      return res.status(400).json({ success: false, error: 'Missing required field: key (string)' });
    }
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ success: false, error: 'Missing required field: content (string)' });
    }
    const store = getKnowledgeStore();
    const entry = store.upsert(key, content, metadata || {});
    res.json({ success: true, entry, timestamp: Date.now() });
  } catch (error) {
    console.error('[API] Knowledge store error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to store knowledge entry',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
```

#### Endpoint 2: GET /api/knowledge/search

```typescript
/**
 * GET /api/knowledge/search?q=query&category=cat&limit=20
 */
router.get('/knowledge/search', (req: Request, res: Response) => {
  try {
    const query = String(req.query.q || '').trim();
    if (!query) {
      return res.json({ success: true, query: '', results: [], count: 0, timestamp: Date.now() });
    }
    const category = req.query.category ? String(req.query.category) : undefined;
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
    const store = getKnowledgeStore();
    const results = store.search(query, { category, limit });
    res.json({
      success: true, query, category: category || null,
      results, count: results.length, totalEntries: store.count(), timestamp: Date.now(),
    });
  } catch (error) {
    console.error('[API] Knowledge search error:', error);
    res.status(500).json({ success: false, error: 'Failed to search knowledge',
      message: error instanceof Error ? error.message : 'Unknown error' });
  }
});
```

#### Endpoint 3: GET /api/knowledge/:key

```typescript
/**
 * GET /api/knowledge/:key - Get a specific knowledge entry
 */
router.get('/knowledge/:key', (req: Request, res: Response) => {
  try {
    const key = decodeURIComponent(req.params.key);
    const store = getKnowledgeStore();
    const entry = store.get(key);
    if (!entry) {
      return res.status(404).json({ success: false, error: `Knowledge entry not found: ${key}` });
    }
    res.json({ success: true, ...entry, timestamp: Date.now() });
  } catch (error) {
    console.error('[API] Knowledge get error:', error);
    res.status(500).json({ success: false, error: 'Failed to get knowledge entry',
      message: error instanceof Error ? error.message : 'Unknown error' });
  }
});
```

## Request/Response Contract

### POST /api/knowledge

**Request:**
```json
{
  "key": "agent-performance:agent-1",
  "content": "Agent agent-1 (copilot/gpt-4o): 15 tasks, 12 success, avg 1200ms",
  "metadata": {
    "category": "agent-performance",
    "agentId": "agent-1",
    "provider": "copilot",
    "source": "mcp-agent-manager",
    "updatedAt": "2026-02-09T21:00:00.000Z"
  }
}
```

**Response (200):**
```json
{
  "success": true,
  "entry": {
    "key": "agent-performance:agent-1",
    "content": "Agent agent-1...",
    "metadata": { "category": "agent-performance", ... },
    "createdAt": "2026-02-09T21:00:00.000Z",
    "updatedAt": "2026-02-09T21:05:00.000Z"
  },
  "timestamp": 1739135100000
}
```

### GET /api/knowledge/search?q=agent-performance&category=agent-performance&limit=10

**Response (200):**
```json
{
  "success": true,
  "query": "agent-performance",
  "category": "agent-performance",
  "results": [ { "key": "...", "content": "...", "metadata": {...}, "createdAt": "...", "updatedAt": "..." } ],
  "count": 1,
  "totalEntries": 5,
  "timestamp": 1739135100000
}
```

### GET /api/knowledge/agent-performance%3Aagent-1

**Response (200):**
```json
{
  "success": true,
  "key": "agent-performance:agent-1",
  "content": "...",
  "metadata": {...},
  "createdAt": "...",
  "updatedAt": "...",
  "timestamp": 1739135100000
}
```

**Response (404):**
```json
{ "success": false, "error": "Knowledge entry not found: missing-key" }
```

## Tests to Create

### `src/tests/knowledge-store.test.ts` (NEW)

Test cases:
1. `upsert` creates entry with `createdAt` and `updatedAt`
2. `upsert` updates existing entry — preserves `createdAt`, updates `updatedAt`
3. `search` matches substring in content
4. `search` filters by category in metadata
5. `search` respects limit parameter
6. `search` returns empty array for no matches
7. `get` returns entry by key
8. `get` returns `undefined` for missing key
9. `delete` removes entry and returns `true`
10. `delete` returns `false` for missing key
11. `count()` reflects current entry count
12. POST `/api/knowledge` returns 400 without `key`
13. POST `/api/knowledge` stores and returns entry with `success: true`
14. GET `/api/knowledge/search` returns matching entries
15. GET `/api/knowledge/:key` returns 404 for missing key

## No Breaking Changes

This is purely additive. No existing endpoints, data structures, or behavior are modified.
