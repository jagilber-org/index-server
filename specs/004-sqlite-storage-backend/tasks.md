# Task Breakdown: SQLite Storage Backend

> ⚠️ **EXPERIMENTAL** — This feature has had limited testing. Not recommended for production use.

## Phase 1: Storage Interface Extraction

### Task 1.1: Define IInstructionStore Interface
- **Status**: Not Started
- **Assignee**: TBD
- **Files**: `src/services/storage/types.ts`
- **Acceptance**:
  - [ ] Interface with JSDoc for all methods
  - [ ] Types for query options, search options, load result
  - [ ] Exported from barrel `src/services/storage/index.ts`

### Task 1.2: Write Contract Tests (RED)
- **Status**: Not Started
- **Assignee**: TBD
- **Files**: `src/tests/unit/storage/instructionStore.contract.spec.ts`
- **Acceptance**:
  - [ ] 15+ test cases covering CRUD, query, search, usage, hash
  - [ ] Tests parameterized to accept any IInstructionStore
  - [ ] Tests FAIL before implementation (RED phase verified)
  - [ ] Edge cases: empty store, missing ID, duplicate write, concurrent ops

### Task 1.3: Implement JsonFileStore (GREEN)
- **Status**: Not Started
- **Assignee**: TBD
- **Files**: `src/services/storage/jsonFileStore.ts`
- **Acceptance**:
  - [ ] Wraps existing IndexLoader + atomicFs logic
  - [ ] All contract tests pass
  - [ ] No behavior change for existing callers

### Task 1.4: Create Factory + Config
- **Status**: Not Started
- **Assignee**: TBD
- **Files**: `src/services/storage/factory.ts`, `src/config/runtimeConfig.ts`
- **Acceptance**:
  - [ ] `createStore(config)` returns correct backend
  - [ ] `INDEX_SERVER_STORAGE_BACKEND` env var added to runtimeConfig
  - [ ] Default: `json`; accepted: `json`, `sqlite`
  - [ ] `npm run guard:env` passes

### Task 1.5: Wire IndexContext to IInstructionStore (REFACTOR)
- **Status**: Not Started
- **Assignee**: TBD
- **Files**: `src/services/indexContext.ts`
- **Acceptance**:
  - [ ] IndexContext uses factory to get store instance
  - [ ] All existing tests pass unchanged
  - [ ] No direct fs.readFileSync/writeFileSync for instructions in indexContext

---

## Phase 2: SQLite Store Implementation

### Task 2.1: Verify node:sqlite Availability
- **Status**: Not Started
- **Assignee**: TBD
- **Files**: `src/services/storage/sqliteStore.ts` (import verification)
- **Acceptance**:
  - [ ] `import { DatabaseSync } from 'node:sqlite'` works with Node.js >=22
  - [ ] Error handling if run on Node < 22.0.0
  - [ ] No npm install or build scripts required

### Task 2.2: Define SQLite Schema
- **Status**: Not Started
- **Assignee**: TBD
- **Files**: `src/services/storage/sqliteSchema.ts`
- **Acceptance**:
  - [ ] DDL for instructions, instructions_fts, messages, usage, metadata tables
  - [ ] FTS5 triggers for insert/update/delete sync
  - [ ] WAL mode pragma
  - [ ] Schema version in metadata table
  - [ ] All InstructionEntry fields mapped

### Task 2.3: Write SQLite-Specific Tests (RED)
- **Status**: Not Started
- **Assignee**: TBD
- **Files**: `src/tests/unit/storage/sqliteStore.spec.ts`
- **Acceptance**:
  - [ ] Contract tests parameterized for SqliteStore
  - [ ] WAL mode verification test
  - [ ] FTS5 index verification test
  - [ ] JSON array column round-trip tests
  - [ ] In-memory DB option for test speed
  - [ ] All tests FAIL before implementation

### Task 2.4: Implement SqliteStore (GREEN)
- **Status**: Not Started
- **Assignee**: TBD
- **Files**: `src/services/storage/sqliteStore.ts`
- **Acceptance**:
  - [ ] All IInstructionStore methods implemented
  - [ ] All contract + specific tests pass
  - [ ] Prepared statements for hot paths
  - [ ] Proper error handling (DB locked, corrupt, etc.)
  - [ ] Connection cleanup on close

### Task 2.5: Optimize SqliteStore (REFACTOR)
- **Status**: Not Started
- **Assignee**: TBD
- **Files**: `src/services/storage/sqliteStore.ts`
- **Acceptance**:
  - [ ] Indexes on category, status, priority_tier, owner
  - [ ] Batch insert for migration (transaction wrap)
  - [ ] Prepared statement cache

---

## Phase 3: Migration Engine

### Task 3.1: Write Migration Tests (RED)
- **Status**: Not Started
- **Assignee**: TBD
- **Files**: `src/tests/unit/storage/migrationEngine.spec.ts`
- **Acceptance**:
  - [ ] JSON → SQLite: count preservation
  - [ ] JSON → SQLite: governance hash preservation
  - [ ] JSON → SQLite: field spot-check (10 entries)
  - [ ] SQLite → JSON: valid files produced
  - [ ] Round-trip lossless
  - [ ] Idempotent (run twice = same state)
  - [ ] Corrupt file handling (skip + log)
  - [ ] All tests FAIL before implementation

### Task 3.2: Implement Migration Engine (GREEN)
- **Status**: Not Started
- **Assignee**: TBD
- **Files**: `src/services/storage/migrationEngine.ts`
- **Acceptance**:
  - [ ] `migrateJsonToSqlite()` bulk imports
  - [ ] `migrateSqliteToJson()` bulk exports
  - [ ] Transaction-wrapped imports
  - [ ] Validation: count + hash comparison
  - [ ] Progress callback

### Task 3.3: CLI Scripts
- **Status**: Not Started
- **Assignee**: TBD
- **Files**: `scripts/storage-migrate.mjs`, `package.json`
- **Acceptance**:
  - [ ] `npm run storage:migrate` works
  - [ ] `npm run storage:export` works
  - [ ] Error messages actionable

---

## Phase 4: IndexContext Integration

### Task 4.1: Write Integration Tests (RED)
- **Status**: Not Started
- **Assignee**: TBD
- **Files**: `src/tests/integration/storageIntegration.spec.ts`
- **Acceptance**:
  - [ ] Feature flag routing tests
  - [ ] Backend-specific ensureLoaded/writeEntry/removeEntry tests
  - [ ] Governance hash parity test
  - [ ] Auto-migration trigger test
  - [ ] All FAIL before wiring

### Task 4.2: Wire Factory into IndexContext (GREEN)
- **Status**: Not Started
- **Assignee**: TBD
- **Files**: `src/services/indexContext.ts`
- **Acceptance**:
  - [ ] `ensureLoaded()` delegates to store
  - [ ] `writeEntry()` delegates to store
  - [ ] `removeEntry()` delegates to store
  - [ ] Auto-migration on first sqlite start
  - [ ] All tests pass both backends

### Task 4.3: Run Full Test Suite Both Backends
- **Status**: Not Started
- **Assignee**: TBD
- **Acceptance**:
  - [ ] `INDEX_SERVER_STORAGE_BACKEND=json npm test` — all pass
  - [ ] `INDEX_SERVER_STORAGE_BACKEND=sqlite npm test` — all pass
  - [ ] No test count decrease

---

## Phase 5: Messaging + Usage in SQLite

### Task 5.1: Write Messaging SQLite Tests (RED)
- **Status**: Not Started
- **Assignee**: TBD
- **Files**: `src/tests/unit/storage/sqliteMessageStore.spec.ts`
- **Acceptance**:
  - [ ] All 100 messaging tests parameterized for SQLite
  - [ ] reply/replyAll/getThread tests
  - [ ] Tag/sender filtering via SQL

### Task 5.2: Implement SqliteMessageStore (GREEN)
- **Status**: Not Started
- **Assignee**: TBD
- **Files**: `src/services/storage/sqliteMessageStore.ts`

### Task 5.3: Implement SqliteUsageStore (GREEN)
- **Status**: Not Started
- **Assignee**: TBD
- **Files**: `src/services/storage/sqliteUsageStore.ts`

### Task 5.4: Wire into agentMailbox + indexContext
- **Status**: Not Started
- **Assignee**: TBD
- **Files**: `src/services/messaging/agentMailbox.ts`, `src/services/indexContext.ts`

---

## Phase 6: FTS5 Search

### Task 6.1: Write FTS5 Tests (RED)
- **Status**: Not Started
- **Assignee**: TBD
- **Files**: `src/tests/unit/storage/fts5Search.spec.ts`

### Task 6.2: Implement FTS5 Search (GREEN)
- **Status**: Not Started
- **Assignee**: TBD
- **Files**: `src/services/storage/sqliteStore.ts`

---

## Phase 7: Dashboard + Backup

### Task 7.1: Dashboard Parity Tests
- **Status**: Not Started
- **Assignee**: TBD
- **Files**: `src/tests/integration/dashboardSqlite.spec.ts`

### Task 7.2: SQLite Backup Integration
- **Status**: Not Started
- **Assignee**: TBD
- **Files**: `src/services/autoBackup.ts`

---

## Phase 8: Documentation + Polish

### Task 8.1: Update Architecture Docs
- **Status**: Not Started
- **Files**: `docs/architecture.md`, `docs/tools.md`, `README.md`

### Task 8.2: CHANGELOG + Version Bump
- **Status**: Not Started
- **Files**: `CHANGELOG.md`, `package.json`

### Task 8.3: Meta Instruction
- **Status**: Not Started
- **Files**: `instructions/sqlite-storage-backend.json`

### Task 8.4: Final Validation
- **Status**: Not Started
- **Acceptance**:
  - [ ] `npm run typecheck` passes
  - [ ] `npm run lint` — 0 errors
  - [ ] `npm test` both backends — all pass
  - [ ] `npm run build` succeeds
  - [ ] Constitution compliance verified
  - [ ] PR created with `DO NOT MERGE` label
