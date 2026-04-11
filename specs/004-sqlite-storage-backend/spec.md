---
id: 004-sqlite-storage-backend
version: 0.1.0
status: experimental
priority: P2
category: performance
created: 2026-04-04
updated: 2026-04-07
author: system
lineage: none
summary: SQLite storage backend as experimental alternative to JSON file storage
---

# Feature: SQLite Storage Backend

> ⚠️ **EXPERIMENTAL** — This feature has had limited testing. Not recommended for production use.

## Summary

Add an experimental SQLite storage backend for the instruction index, sitting behind a
feature flag (`INDEX_SERVER_STORAGE_BACKEND=sqlite`). JSON files remain the primary and
default storage. SQLite is opt-in, with automatic migration from JSON on first enable.

## Problem Statement

The current JSON-file-per-instruction storage works well at small scale (~300 entries) but
has architectural limitations:

- **O(n) queries**: All filtering (category, scoped, text search) scans full in-memory array
- **No transactional writes**: Atomic temp+rename per file; no multi-entry transactions
- **File system pressure**: 293+ individual files plus manifest, usage snapshot, messages JSONL
- **Cross-process invalidation**: `.index-version` file polling is a workaround for lacking shared state
- **No built-in FTS**: Keyword search is substring matching on title+body arrays

SQLite addresses all of these while maintaining single-file deployability.

## Requirements

- [REQ-1] `IInstructionStore` interface abstracting all storage operations
- [REQ-2] `JsonFileStore` implementing `IInstructionStore` (wraps current IndexContext internals)
- [REQ-3] `SqliteStore` implementing `IInstructionStore` using `node:sqlite` (built-in)
- [REQ-4] Feature flag: `INDEX_SERVER_STORAGE_BACKEND=json|sqlite` (default: `json`)
- [REQ-5] Auto-migration: On first SQLite start, import all JSON files into DB
- [REQ-6] JSON export: `sqlite-export` command dumps SQLite back to JSON files
- [REQ-7] FTS5 full-text search index on title + body + categories
- [REQ-8] SQLite WAL mode for concurrent read/write
- [REQ-9] All existing MCP tools and REST API unchanged (behavioral parity)
- [REQ-10] All existing tests pass against both backends
- [REQ-11] Usage tracking stored in SQLite table (replaces usage-snapshot.json)
- [REQ-12] Message storage in SQLite table (replaces messages.jsonl)
- [REQ-13] Governance hash computation identical between backends
- [REQ-14] Backup via SQLite `.backup()` API (replaces file-copy backup)

## Success Criteria

- [ ] `INDEX_SERVER_STORAGE_BACKEND=json` (default) behaves identically to current
- [ ] `INDEX_SERVER_STORAGE_BACKEND=sqlite` passes all existing instruction CRUD tests
- [ ] FTS5 search returns same results as in-memory keyword search
- [ ] Auto-migration from JSON → SQLite preserves all fields including governance
- [ ] SQLite → JSON export produces valid instruction files
- [ ] Dashboard works identically with either backend
- [ ] No performance regression for JSON backend
- [ ] SQLite backend handles concurrent reads via WAL mode
- [ ] All 100+ messaging tests pass against SQLite backend
- [ ] Usage tracking persists correctly in SQLite

## Non-Goals

- Replacing JSON as the default storage (JSON stays primary)
- Multi-node/distributed SQLite (single-instance only)
- PostgreSQL/MySQL support (SQLite only for v1)
- Schema migration framework (single schema version for v1)
- Removing IndexContext public API (it stays as the abstraction layer)

## Technical Considerations

- **Handler Pattern**: No handler changes — `IInstructionStore` sits below IndexContext
- **Registry Integration**: No tool registry changes — tools call IndexContext unchanged
- **Audit**: Mutation audit logging unchanged (operates above storage layer)
- **Config**: New keys in `runtimeConfig.ts`:
  - `INDEX_SERVER_STORAGE_BACKEND` (json|sqlite, default: json)
  - `INDEX_SERVER_SQLITE_PATH` (default: data/index.db)
  - `INDEX_SERVER_SQLITE_WAL` (default: true)
  - `INDEX_SERVER_SQLITE_MIGRATE_ON_START` (default: true)
- **SQLite Implementation**: `node:sqlite` (built-in since Node.js 22.0.0)
  - **No npm install required** — included with Node.js >=22 ✓
  - Import: `const { DatabaseSync } = require('node:sqlite')` or `import { DatabaseSync } from 'node:sqlite'`
  - API: Synchronous operations via `DatabaseSync` class
  - Same pattern as `better-sqlite3`: `db.prepare(sql).run()`, `.get()`, `.all()`
  - WAL mode: `db.exec('PRAGMA journal_mode=WAL')`
  - **Note**: Marked as experimental in Node.js (https://nodejs.org/api/sqlite.html)
  - Zero native dependencies, zero compilation required
- **Schema**: Single `instructions` table with columns matching InstructionEntry fields
  - JSON columns for arrays (categories, changeLog, teamIds)
  - FTS5 virtual table for search
  - Separate `usage` and `messages` tables

## Dependencies

- `node:sqlite` built-in Node module (no npm install)
- Existing IndexContext, IndexLoader, agentMailbox modules
- Issue #18 (feat: SQLite storage backend)

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| `node:sqlite` stability (experimental) | Medium | Monitor upstream; have fallback plan; good API surface |
| Behavioral divergence between backends | High | Shared test suite run against both backends |
| Migration data loss | Critical | Validation: count + hash comparison post-migration |
| Performance regression on JSON path | Medium | Benchmark before/after; JSON path untouched |
| SQLite file locking on network drives | Medium | Document: local filesystem only for SQLite |

## References

- GitHub Issue #18: feat: SQLite storage backend
- constitution.json rules: A-3 (IndexContext as source of truth), S-4 (config via runtimeConfig)
- Node.js built-in SQLite: https://nodejs.org/api/sqlite.html
