# Agent Execution Directive (Immutable Governance Rule)

This document codifies the mandatory rule: all automated maintenance, build, test, guard, and baseline governance operations MUST be executed exclusively through the MCP PowerShell server (`powershell-mcp-server`) using its `run-powershell` tool. Direct VS Code terminal usage by an AI agent is prohibited.

## Rationale

- Determinism: Unified timeout + working directory controls.
- Auditability: Protocol-level invocation is inspectable/loggable.
- Safety: Eliminates interactive hang scenarios and silent partial runs.
- Consistency: Avoids divergence between human and agent execution pathways.

## Covered Operations

| Category | Examples (non-exhaustive) |
|----------|---------------------------|
| Build | `npm ci`, `npm run build`, `npm run typecheck` |
| Baseline enforcement | `node scripts/guard-baseline.mjs`, `node scripts/baseline-sentinel.mjs verify` |
| Sentinel maintenance | `node scripts/baseline-sentinel.mjs update` (post-approved CR) |
| Minimal test cycles | Targeted `npx vitest run <spec>` executions |
| Repro scripts | `node scripts/repro-add-get.js` (if used) |

## Invocation Pattern

Use the protocol tool (conceptual form):

```text
run-powershell { command: "<PowerShell or simple chained commands>", timeout: <seconds> }
```

Where possible include an explicit timeout (default 90s). Use environment variable injection inline when needed:

```text
run-powershell { command: "$env:BASELINE_ENFORCE='1'; node scripts/guard-baseline.mjs" }
```

## Prohibited Patterns

- Asking user to open a manual terminal for steps the agent can run.
- Multi-step baseline actions executed outside protocol tools.
- Enabling diagnostic verbosity flags in `.vscode/mcp.json` outside approved change request (enforced by `mcpConfigImperativeDirective.spec.ts`).

## Enforcement Mechanisms

- `mcpConfigImperativeDirective.spec.ts` test fails if disallowed env flags are activated.
- `INTERNAL-BASELINE.md` + README embed the directive (multi-surface redundancy).
- Commit hooks enforce change request markers for baseline file modifications.
- Sentinel hash (`.baseline.sentinel`) prevents silent drift.

## Change Control

Modifications to this directive require:

```text
BASELINE-CR: AGENT EXECUTION DIRECTIVE UPDATE
Justification: <why>
Scope: <files / behavior>
Rollback: <steps>
```

And must update sentinel + re-run enforcement tests.

## Future Hardening (Planned)

- CI log scanner rejecting non-MCP invocation traces.
- Tool-level metrics diff gating.

This directive is mandatory. Any deviation indicates governance failure and must trigger immediate remediation.
