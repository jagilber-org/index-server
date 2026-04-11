# 002 – Tool Surface Consolidation & Flag-Gating

**Category:** governance  
**Status:** draft  
**Priority:** P1  
**Author:** copilot  
**Date:** 2025-08-28

---

## Motivation

Index currently exposes **44 tools** via tools/list. Most MCP clients (Copilot, Cursor, Claude) struggle with large tool surfaces — context windows fill up, tool selection accuracy drops, and users are overwhelmed.

### Current Tool Surface (44 tools)

| Group | Count | Tools |
|-------|-------|-------|
| **Core** | 4 | health\_check, instructions\_dispatch, instructions\_search, prompt\_review |
| **Governance** | 4 | instructions\_governanceHash, instructions\_governanceUpdate, integrity\_verify, gates\_evaluate |
| **Instruction mutations** | 8 | instructions\_add, instructions\_import, instructions\_remove, instructions\_reload, instructions\_repair, instructions\_groom, instructions\_enrich, instructions\_normalize |
| **Usage** | 3 | usage\_track, usage\_hotset, usage\_flush |
| **Metrics/Diagnostics** | 7 | metrics\_snapshot, feature\_status, instructions\_health, instructions\_diagnostics, diagnostics\_block, diagnostics\_microtaskFlood, diagnostics\_memoryPressure |
| **Meta** | 5 | meta\_tools, meta\_activation\_guide, meta\_check\_activation, help\_overview, instructions\_schema |
| **Graph** | 1 | graph\_export |
| **Feedback** | 6 | feedback\_submit, feedback\_list, feedback\_get, feedback\_update, feedback\_stats, feedback\_health |
| **Manifest** | 3 | manifest\_status, manifest\_refresh, manifest\_repair |
| **Bootstrap** | 3 | bootstrap\_request, bootstrap\_confirmFinalize, bootstrap\_status |
| **Promote** | 1 | promote\_from\_repo |

## Design

### Phase 1 — Flag-gated Tool Tiers (reduces visible count without removing anything)

Add a `toolTier` classification to each registered tool:

- **core** — Always visible. Essential for daily use.
- **extended** — Visible when `INDEX_SERVER_TOOLS_EXTENDED=1` (or flags.json `tools_extended: true`).
- **admin** — Visible when `INDEX_SERVER_TOOLS_ADMIN=1`. Rarely needed, operational/debug.

tools/list in sdkServer.ts filters registry based on active tiers.

#### Tier Assignment

| Tier | Tools | Count |
|------|-------|-------|
| **core** | health\_check, instructions\_dispatch, instructions\_search, prompt\_review, help\_overview | 5 |
| **extended** | graph\_export, usage\_track, usage\_hotset, feedback\_submit, feedback\_list, feedback\_get, instructions\_add, instructions\_import, instructions\_remove, instructions\_reload, instructions\_governanceHash, instructions\_governanceUpdate, gates\_evaluate, integrity\_verify, metrics\_snapshot, promote\_from\_repo, instructions\_schema | 17 |
| **admin** | meta\_tools, meta\_activation\_guide, meta\_check\_activation, feature\_status, instructions\_health, instructions\_diagnostics, instructions\_repair, instructions\_groom, instructions\_enrich, instructions\_normalize, usage\_flush, feedback\_update, feedback\_stats, feedback\_health, manifest\_status, manifest\_refresh, manifest\_repair, bootstrap\_request, bootstrap\_confirmFinalize, bootstrap\_status, diagnostics\_block, diagnostics\_microtaskFlood, diagnostics\_memoryPressure | 23 |

**Default experience: 5 tools.** Extended: 22 tools. Admin: all 44.

### Phase 2 — Consolidation (reduces total tool count)

Fold groups into dispatchers, following the precedent of instructions\_query and instructions\_categories being folded into instructions\_dispatch.

#### 2a: Feedback → feedback\_dispatch

Merge 6 tools → 1 dispatcher:
- feedback\_dispatch with action = submit | list | get | update | stats | health
- Remove standalone feedback\_\* tools from registry

#### 2b: Manifest → fold into instructions\_dispatch

Manifest is Index metadata. Add 3 new dispatcher actions:
- action = manifestStatus | manifestRefresh | manifestRepair
- Remove standalone manifest\_\* tools

#### 2c: Bootstrap → single bootstrap tool

Merge 3 tools → 1:
- bootstrap tool with action = request | confirm | status

#### 2d: Meta → single meta tool

Merge 3 meta tools + help\_overview + instructions\_schema → 1:
- meta tool with section = tools | activation\_guide | check\_activation | help | schema

#### 2e: Diagnostics → diagnostics tool

Merge diagnostics\_block, diagnostics\_microtaskFlood, diagnostics\_memoryPressure, instructions\_diagnostics → 1:
- diagnostics with action = block | microtaskFlood | memoryPressure | instructionsDiag

### Phase 2 Impact

| Phase | Total tools | Core visible |
|-------|-------------|-------------|
| Before | 44 | 44 |
| Phase 1 only | 44 (5 default) | 5 |
| Phase 1 + 2 | 29 (5 default) | 5 |

## TDD Plan (Red → Green)

### Red Tests (write first, all must fail)

1. **toolTierFiltering.red.spec.ts** — getToolRegistry({ tier: 'core' }) returns only 5 tools; tier: 'extended' returns 22; tier: 'admin' returns all
2. **toolTierFlags.red.spec.ts** — MCP\_TOOLS\_EXTENDED=1 env var causes tools/list to include extended tier; flags.json { "tools\_extended": true } also works
3. **feedbackDispatch.red.spec.ts** — feedback\_dispatch action=list returns same result as old feedback\_list; action=submit works; standalone feedback\_\* tools removed from core/extended tier
4. **manifestDispatchActions.red.spec.ts** — instructions\_dispatch action=manifestStatus returns same as old manifest\_status
5. **bootstrapConsolidation.red.spec.ts** — single bootstrap tool with action param handles all 3 operations

### Green Phase (implement to pass)

1. Add `tier` field to ToolRegistryEntry interface
2. Classify all tools in toolRegistry.ts
3. Extend featureFlags.ts with tools\_extended and tools\_admin flags
4. Modify getToolRegistry() to accept { tier?: 'core' | 'extended' | 'admin' } filter parameter
5. Modify sdkServer.ts tools/list to pass tier filter based on active flags
6. Create feedback\_dispatch handler + fold standalone feedback tools
7. Add manifest actions to instructions\_dispatch
8. Consolidate bootstrap tools
9. Update STABLE/MUTATION sets

## Constitution Compliance

- **Q-1**: All new exports get tests (red specs first)
- **Q-5**: New handlers use registerHandler() pattern
- **A-1**: Side-effect imports in toolHandlers.ts
- **A-2**: Registry STABLE/MUTATION updated
- **S-3**: Mutation tools still require MCP\_ENABLE\_MUTATION=1
- **S-4**: Config through runtimeConfig.ts / featureFlags.ts
- **G-1**: This spec exists before code
- **G-3**: Conventional commits
