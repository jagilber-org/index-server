# Routing

> Maps work signals to agents. The coordinator reads this to decide who handles what.

## Routing Table

| Signal Pattern | Route To | Notes |
|----------------|----------|-------|
| Architecture decisions, scope, API design | Morpheus | Sync for approval gates |
| Code review, PR review, governance enforcement | Morpheus | Reviewer role — can reject |
| Handler implementation, tool registry, MCP protocol | Trinity | Primary implementer |
| Index operations, import/export, schema work | Trinity | IndexContext owner |
| Runtime config, server transport, dashboard backend | Trinity | Backend infrastructure |
| Dashboard UI, HTML/CSS/JS, graph visualization, UX | Mouse | Frontend implementation |
| Test writing, TDD, coverage, regression suites | Tank | Red-green-refactor |
| Test cleanup, fixture isolation, conformance tests | Tank | Test infrastructure |
| Bug reproduction, edge case analysis | Tank | With Trinity for fixes |
| Documentation, TOOLS.md, README, guides | Oracle | Non-code artifacts |
| Bootstrapper instructions, feedback analysis | Oracle | Knowledge curation |
| Developer experience, API docs, onboarding | Oracle | User-facing content |
| Session logging, decisions, history | Scribe | Silent, never blocks |
| Work queue, backlog, issue monitoring | Ralph | Continuous loop |
| Legal docs, ToS, privacy, disclaimers, license | Briggs | Legal content only |
| PII tool liability language, compliance wording | Briggs | Coordinates with security |
| Product description legal review, claims audit | Briggs | Pre-publication gate |

## Reviewer Gates

| Artifact Type | Reviewer | Gate |
|---------------|----------|------|
| Handler code | Morpheus | Must approve before merge |
| Tool registry changes | Morpheus | Must approve before merge |
| Schema changes | Morpheus | Must approve before merge |
| Test code | Tank | Self-reviewed (author is reviewer) |
| Documentation | Oracle | Self-reviewed |
| Legal documentation | Briggs | Self-reviewed |
| PII tool disclaimers | Briggs | Required before tool publication |

## Escalation

- If Trinity's work is rejected by Morpheus → Tank or Oracle revises (lockout applies)
- If Tank's tests fail on Trinity's code → Trinity fixes, Tank re-verifies
- If deadlock → escalate to Jason
