# Use Case Scenarios

Real-world examples showing how Index Server provides value as a central, persistent knowledge source for AI agents across repos and sessions.

---

## What Is Index Server?

A central persistent knowledge source for cross-repo generalized instructions, skills, guides, and troubleshooting runbooks — served to AI agents via the Model Context Protocol (MCP) over stdio (VS Code, Copilot CLI) or HTTP(S) (dashboard, REST clients, CI pipelines).

**Key value propositions:**

- **Persistent cross-session memory** — Knowledge survives across sessions, repos, and machines
- **Semantic search** — Finds related instructions even when exact keywords don't match
- **Governed catalog** — Versioned, auditable, with ownership and approval workflows
- **Agent-friendly** — MCP tools let agents search, read, and contribute knowledge natively

---

## Scenario 1: Support Engineer Troubleshooting

**Problem:** Every support case starts from scratch. The agent re-learns troubleshooting steps, Kusto queries, and runbook procedures that were already discovered in previous cases.

**Workflow:**

```
1. Open VS Code → open `<case-working-directory>`
2. Add case statement to issue.md
3. Ask agent:
   "Working on case 12345. Save all information to case folder.
    Read issue.md. Create a plan to troubleshoot this issue.
    Search index-server for troubleshooting guides and runbooks."
4. Agent searches index-server → finds relevant prior knowledge
5. Agent works the issue using existing runbooks + new investigation
6. After resolution, ask agent:
   "Enrich index-server with any new generalized learnings,
    Kusto queries, and troubleshooting steps for future cases."
```

**What gets stored:**

```
index_add: {
  id: "azure-storage-timeout-runbook",
  title: "Azure Storage Timeout Troubleshooting",
  body: "## Symptoms\n- 503 errors on blob operations...\n## Kusto Queries\n```kusto\nStorageBlobLogs | where ...\n```\n## Resolution Steps\n1. Check throttling limits...",
  categories: ["azure", "storage", "troubleshooting", "runbook"]
}
```

**Next time:** A different engineer on a similar case gets the runbook automatically via semantic search — no re-learning needed.

---

## Scenario 2: Development Team Knowledge Base

**Problem:** Coding conventions, architecture decisions, and API patterns live in wikis that agents can't access, or in scattered README files that agents don't consistently find.

**Workflow:**

```
1. After an architecture decision or code review:
   "Add this API error handling pattern to index-server as a
    reusable guide for all repos."

2. In any repo, agents automatically search index-server:
   "Search index-server for error handling patterns in our APIs"
   → Finds the team's standardized pattern

3. Promote repo-local learnings:
   "Promote the .instructions/ from this repo to index-server
    so other repos benefit."
```

**Example instructions:**

| Instruction ID | Purpose |
|---|---|
| `api-error-handling-v2` | Standardized error response format |
| `azure-deployment-checklist` | Pre-deployment verification steps |
| `kusto-query-patterns` | Common KQL query templates |
| `git-workflow-conventions` | Branch naming and PR standards |

---

## Scenario 3: Cross-Repo Knowledge Promotion

**Problem:** Lessons learned in one repo stay in that repo. Other teams hit the same issues.

**Workflow:**

```
1. In repo-A, create .instructions/local/fix-connection-pool.md
2. Validate the fix works across multiple scenarios
3. Move to .instructions/shared/ for repo-wide reuse
4. Promote to index-server for organization-wide access:

   promote_from_repo: {
     repoPath: "C:/repos/repo-A",
     scope: "instructions"
   }
```

**Search flow (local-first):**

```
repo files → .instructions/local/ → .instructions/shared/ → index-server → external docs
```

---

## Scenario 4: Onboarding New Team Members

**Problem:** New engineers spend days learning tooling, conventions, and tribal knowledge.

**Setup:**

Add to the repo's `copilot-instructions.md`:

```markdown
## Index Server
- Search index-server for team conventions and troubleshooting guides
- When you learn something reusable, add it to index-server
- Prefer index-server over external documentation for team-specific knowledge
```

**Result:** From day one, the new engineer's AI agent has access to every troubleshooting runbook, coding pattern, and architectural decision the team has accumulated.

---

## Scenario 5: CI/CD Integration

**Problem:** CI pipelines need to reference deployment checklists or validation rules, but MCP stdio isn't available in CI.

**Solution:** Use the REST client scripts or HTTP API:

```bash
# In a CI pipeline script
./scripts/index-server-client.sh search "deployment checklist" semantic 5
./scripts/index-server-client.sh get pre-deploy-validation-steps
```

```powershell
# PowerShell CI step
.\scripts\index-server-client.ps1 -Action search -Keywords "release checklist" -Mode semantic
```

---

## Scenario 6: Bootstrap Dashboard HTTPS for a Fresh Install

**Problem:** A new operator wants the admin dashboard on HTTPS but does not
want to compose multi-line `openssl req` commands or hand-author SAN
extensions just to enable TLS for local/internal use.

**Solution:** Use the built-in `--init-cert` switch (requires `openssl` on
PATH):

```bash
# One step: generate cert+key under ~/.index-server/certs/, then start the
# dashboard with HTTPS automatically wired in.
index-server --init-cert --start --dashboard
```

For custom CN/SAN/validity see [`docs/cert_init.md`](cert_init.md). Idempotent
(safe to re-run; preserves existing files unless `--force` given) and never
contacts the network.

---

## How Agents Interact with Index Server

### Searching (most common)

```
Agent: index_search { keywords: ["timeout", "azure", "storage"] }
→ Returns matching instruction IDs ranked by relevance

Agent: index_dispatch { action: "get", id: "azure-storage-timeout-runbook" }
→ Returns full instruction body
```

### Adding Knowledge

```
Agent: index_add {
  entry: {
    id: "new-runbook",
    title: "...",
    body: "...",
    categories: ["troubleshooting"]
  },
  lax: true
}
```

### Tracking Usefulness

```
Agent: usage_track { id: "azure-storage-timeout-runbook", signal: "helpful" }
```

This feedback loop helps surface the most valuable instructions via `usage_hotset`.

---

## When to Promote Knowledge to Index Server

Agents should prompt users to promote learnings to index-server when any of these triggers occur:

### Promotion Triggers

| Trigger | Example | Action |
|---------|---------|--------|
| **Repeated pattern** | Same fix applied in 2+ cases or repos | Generalize and promote as a runbook |
| **Post-resolution insight** | After closing a support case with novel troubleshooting steps | Ask: "Should I add these steps to index-server for future cases?" |
| **Architecture decision** | Team agrees on error handling, API patterns, or deployment conventions | Promote as a reusable standard |
| **Cross-repo applicability** | Local `.instructions/` guidance proves useful in a second repo | Move to `.instructions/shared/`, then promote |
| **Onboarding friction** | New team member hits a wall that existing agents can't help with | Capture the solution for future onboarding |
| **Session boundary** | End of a productive session with multiple learnings | Ask: "I discovered N reusable patterns — want me to promote them?" |

### Promotion Flow

```
1. Capture locally first:
   → Write to .instructions/local/ (repo-specific)
   → Or .instructions/shared/ (repo-wide reuse)

2. Validate across sessions:
   → Pattern used successfully 2+ times
   → No project-specific dependencies
   → Quality score ≥ 3.0 (see 001-knowledge-index-lifecycle spec)

3. Promote to index-server:
   → promote_from_repo { repoPath: "...", scope: "instructions" }
   → Or index_add for standalone knowledge

4. Track effectiveness:
   → usage_track with signal: "helpful" or "not-relevant"
   → usage_hotset to surface most-used instructions
```

### What NOT to Promote

- Unvalidated experiments or first-attempt fixes
- Project-specific configuration (stays in `.instructions/local/`)
- Personal preferences or one-off workarounds
- Sensitive data, credentials, or internal paths

### Agent Prompt Template

When triggers are detected, agents should suggest:

> "I've accumulated [N] reusable learnings during this session that could help future cases/repos:
> - [brief description of each]
> Would you like me to promote these to index-server for team-wide access?"

---

## Getting Started

See the **[Quick Start Guide](quickstart.md)** to install and configure Index Server in 5 minutes.
