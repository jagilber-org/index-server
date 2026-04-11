# CRUD Bug Reproduction Cases

Extracted from production feedback entries - August 29, 2025

## Critical Bug 1: Silent Add Operation Failure

**Feedback ID**: `661353c02124e752`

**Tool**: `index_add`

**Impact**: 100% data loss with false positive response

**Test Payload**:

```json
{
  "entry": {
    "audience": "developers",
    "body": "This is a simple test instruction for CRUD validation",
    "categories": ["testing", "crud"],
    "id": "crud-test-simple",
    "priority": 10,
    "requirement": "optional",
    "title": "Simple CRUD Test Entry"
  },
  "lax": true,
  "overwrite": true
}
```

**Expected Response**:

```json
{
  "id": "crud-test-simple",
  "created": true,
  "overwritten": false,
  "skipped": false,
  "hash": "f930631902af451e7b1eeb5c7f59cd6bf7be1598f2b748b6f5d1f877ea72f362"
}
```

**Verification Command**:

```bash
index_dispatch get "crud-test-simple"
```

**Actual Bug Result**:

- **Add Response**: Success (created: true)
- **Verification**: `{"notFound": true}`
- **Issue**: Silent data loss with false positive

---

## Critical Bug 2: Partial Import Failure

**Feedback ID**: `512f9d1f405e7aa1`

**Tool**: `index_import`

**Impact**: 50% data loss in batch operations

**Test Payload**:

```json
{
  "entries": [
    {
      "audience": "developers",
      "body": "medium complexity test",
      "categories": ["testing", "medium-complexity"],
      "id": "crud-test-medium-001",
      "priority": 25,
      "requirement": "recommended",
      "title": "Medium CRUD Test Entry 001"
    },
    {
      "audience": "all",
      "body": "Second medium test entry",
      "categories": ["testing", "batch"],
      "id": "crud-test-medium-002",
      "priority": 30,
      "requirement": "optional",
      "title": "Medium CRUD Test Entry 002"
    }
  ],
  "mode": "overwrite"
}
```

**Expected Import Response**:

```json
{
  "hash": "eaf1c3e...",
  "imported": 2,
  "skipped": 0,
  "overwritten": 0,
  "total": 2,
  "errors": []
}
```

**Verification Commands**:

```bash
index_dispatch get "crud-test-medium-001"
index_dispatch get "crud-test-medium-002"
```

**Actual Bug Results**:

- **Import Response**: 2 imported successfully
- **crud-test-medium-001**: `{"notFound": true}` - **LOST**
- **crud-test-medium-002**: Found and persisted - **OK**
- **Issue**: 50% data loss despite success report

---

## Schema Validation Issue: All-or-Nothing Behavior

**Feedback ID**: `99ed975af4de3d19`

**Tool**: `index_import`

**Impact**: Complete batch failure for single invalid entry

**Test Batch** (3 entries, 1 intentionally invalid):

```json
{
  "entries": [
    {
      "audience": "developers",
      "body": "Valid entry 1",
      "categories": ["testing"],
      "id": "valid-entry-001",
      "priority": 10,
      "requirement": "optional",
      "title": "Valid Entry 1"
    },
    {
      "audience": "all",
      "body": "Valid entry 2",
      "categories": ["testing"],
      "id": "valid-entry-002",
      "priority": 20,
      "requirement": "recommended",
      "title": "Valid Entry 2"
    },
    {
      "audience": "testers",
      "body": "Invalid entry - missing requirement field",
      "categories": ["testing"],
      "id": "invalid-entry-003",
      "priority": 15,
      "title": "Invalid Entry (Missing Requirement)"
    }
  ]
}
```

**Actual Error Response**:

```json
{
  "error": "invalid_argument",
  "details": "entries[2] missing required field: requirement"
}
```

**Enterprise Expected Behavior**:

- Import valid entries (001, 002)
- Report detailed errors for invalid entries
- Provide partial success with per-item status

**Actual Behavior**:

- Complete operation failure
- No entries imported
- All-or-nothing processing

---

## Reproduction Steps

### Using MCP Tools Directly

**Test Case 1**: Silent Add Failure

```bash
tools/call index_add '{"entry": {"audience": "developers", "body": "This is a simple test instruction for CRUD validation", "categories": ["testing", "crud"], "id": "crud-test-simple", "priority": 10, "requirement": "optional", "title": "Simple CRUD Test Entry"}, "lax": true, "overwrite": true}'

# Verify persistence
tools/call index_dispatch '{"action": "get", "id": "crud-test-simple"}'
```

**Test Case 2**: Partial Import Failure

```bash
tools/call index_import '{"entries": [{"audience": "developers", "body": "medium complexity test", "categories": ["testing", "medium-complexity"], "id": "crud-test-medium-001", "priority": 25, "requirement": "recommended", "title": "Medium CRUD Test Entry 001"}, {"audience": "all", "body": "Second medium test entry", "categories": ["testing", "batch"], "id": "crud-test-medium-002", "priority": 30, "requirement": "optional", "title": "Medium CRUD Test Entry 002"}], "mode": "overwrite"}'

# Verify both entries
tools/call index_dispatch '{"action": "get", "id": "crud-test-medium-001"}'
tools/call index_dispatch '{"action": "get", "id": "crud-test-medium-002"}'
```

### Using SDK Test Client

The `createTestClient()` helper (`src/tests/helpers/mcpTestClient.ts`) can serve as a baseline comparison to verify these operations work correctly programmatically.

---

## Bug Pattern Analysis

1. **Success Reporting Disconnect**: Operations report success but don't persist
2. **Batch Processing Inconsistency**: Some items in batch fail silently  
3. **Transaction Integrity Missing**: No rollback or verification before success response
4. **Enterprise Resilience Gap**: All-or-nothing instead of graceful degradation

These exact payloads can be used in automated tests to verify fixes and prevent regressions.
