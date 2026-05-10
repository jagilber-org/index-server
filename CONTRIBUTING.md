# Contributing

Thanks for your interest in contributing.

## Contribution Model

Public contributions should target `main` in the public repository.

- Fork `jagilber-org/index-server`
- Create a feature branch for your change
- Open a pull request against `main`

Maintainers may use additional private development and publishing workflows internally, but public contributors should work from the public repository and its pull request flow.

## Development Setup

1. Node 22+
2. `npm install`
3. `npm run build`
4. `npm run setup` — interactive configuration wizard (generates `.env` and MCP client config). Equivalent to `node dist/server/index-server.js --setup`.
5. `npm test`

## Branching

Use feature branches. Submit PRs to `main`.

## Pull Request Review

Fill out the PR template completely before requesting review.

### Agent PR Preflight

Agents MUST complete the mandatory pre-PR checklist in [`.instructions/local/agent-pr-preflight.md`](.instructions/local/agent-pr-preflight.md) before opening a pull request, handing a branch to a coordinator, or reporting a change as PR-ready. The checklist covers `npm test`, `npm run typecheck`, `npm run lint`, `pre-commit run --all-files`, `git diff --check`, and staged-diff review for unintended changes.

### Mandatory AI-Generated Code/Test Review

If any code or tests in the PR were generated or materially edited by an AI agent, reviewers MUST confirm all of the following before merge:

- [ ] No placeholder tests: no `placeholder`, `expect(true)`, `expect(1).toBe(1)`, or empty `() => {}` test bodies were introduced
- [ ] No new `it.skip()` or `describe.skip()` without a linked issue and inline justification
- [ ] Negative tests exist for handler changes, including invalid input, missing required fields, and non-existent resources where applicable
- [ ] Mutation-handler tests verify disk truth independently (for example, by reading the filesystem) rather than trusting only the server response
- [ ] No new `SKIP_OK` markers were added to normalize permanently skipped coverage
- [ ] Claimed test counts match real coverage and assertions
- [ ] No hardcoded success values such as `verified: true` or `created: true` were added unless computed from a real check
- [ ] Agent attestation metadata present on agent-authored commits (AG-4)
- [ ] Copilot `Co-authored-by: Copilot <copilot-noreply-email>` trailer present on Copilot-authored commits
- [ ] Tests added for behavioral changes (unit + integration where the change crosses a layer boundary)
- [ ] No hardcoded paths or secrets — all tunables routed through `src/config/runtimeConfig.ts` (`npm run guard:env` passes)
- [ ] `logAudit()` invoked on every mutation success and side-effecting error path
- [ ] `src/services/toolRegistry.ts` updated for new/changed tools (INPUT_SCHEMAS + STABLE + MUTATION + describeTool) and registered via `src/services/toolHandlers.ts`
- [ ] Conventional Commit subjects on every commit
- [ ] If `constitution.json` changed: `pwsh -File scripts/build/sync-constitution.ps1 -Check` passes and rendered `.md` files are regenerated
- [ ] Security-sensitive changes carry explicit security + testing consensus approvals or a linked decision record
- [ ] Imported external code has a documented source and a `LICENSE`-compatible license, with attribution recorded in `THIRD-PARTY-LICENSES.md` where required

PRs that fail any AI-generated code/test review item must be sent back for correction before merge.

> **Full policy with examples, grep commands, and constitution references:** [`docs/pr_review_checklist.md`](docs/pr_review_checklist.md)

## Commit Messages

Use conventional style where practical (feat:, fix:, docs:, chore:).

## Tests

Include unit tests for new logic. Run `npm test` for the default fast suite, and use `npm run test:slow` or `npm run test:all` when your change touches heavy integration/perf coverage.

### Repo Root Policy

The repository root must stay clean. Do not create directories or files in the repo root
beyond what is tracked in git. Specifically:

- **No `instructions/` directory** — instruction data lives outside the repo (set `INDEX_SERVER_DIR` env var). Tests use isolated temp directories via `os.tmpdir()`.
- **No temp/log sprawl** — use `tmp/` (gitignored) for transient files, never the repo root.
- **No runtime data dirs** — `data/`, `memory/`, `metrics/`, `feedback/` contain `.gitkeep` only; runtime data goes in external paths configured via env vars.

See `docs/testing.md` for the test isolation pattern.

### Configuration & Environment Variables

Do NOT introduce new top-level `process.env.*` usages scattered across the codebase.

All runtime and test tunables must flow through `src/config/runtimeConfig.ts`:

1. If you need a new timing / wait value, extend `INDEX_SERVER_TIMING_JSON` key usage (e.g. `{"featureX.startupWait":5000}`) instead of adding `FEATUREX_STARTUP_WAIT_MS`.
2. For logging verbosity, use `INDEX_SERVER_LOG_LEVEL` (levels: silent,error,warn,info,debug,trace) or add a trace token to `INDEX_SERVER_TRACE` (comma-separated) rather than a new boolean flag.
3. For mutation control, rely on `INDEX_SERVER_MUTATION` (`0` forces read-only mode; do not introduce alternate flags).
4. Fast coverage paths use `INDEX_SERVER_TEST_MODE=coverage-fast`; legacy `FAST_COVERAGE` accepted but should not appear in new code.

If an absolutely new capability requires configuration:

- Add parsing inside `runtimeConfig.ts` (with JSDoc + deprecation mapping if replacing legacy flags)
- Update `docs/CONFIGURATION.md` and README consolidation section
- Add a one-time warning for any temporary legacy alias

PRs adding raw `process.env.X` reads outside the config module will be requested to refactor before merge.

### Automated Enforcement

An automated guard (`npm run guard:env`) executes during `build:verify` and CI to block newly introduced direct `process.env.*` reads. If your change legitimately needs a bootstrap-time read (rare), either:

1. Route through `runtimeConfig.ts` (preferred), or
2. Add a narrowly scoped allowlist pattern with justification in `scripts/enforce-config-usage.ts` (include a comment referencing the follow-up issue to migrate/remove it).

Do not silence the guard by broadening allowlists—refactor instead. Enforcement failures list file:line with a remediation suggestion.

## Security

Do not include secrets in commits. Report vulnerabilities per `SECURITY.md`.

## Urgent Security Merge Policy

Critical or actively-exploited vulnerabilities may be merged with **zero pre-merge review** when delay would increase exposure risk. The following conditions apply:

1. **Post-merge audit required** — a full code review MUST occur within 24 hours of the merge.
2. **Commit message rationale** — the merge commit must document why the normal review process was bypassed (e.g., active exploitation, severity, blast radius).
3. **Async reviewer sign-off** — at least one maintainer must provide a reviewing sign-off within 24 hours, confirming the fix is correct and complete.
4. **Reference the vulnerability** — the commit and/or PR must reference the relevant CVE, advisory, or issue number.
5. **Scope limit** — this policy applies **only** to critical and actively-exploited vulnerabilities. Non-critical security issues follow the standard review process.

If the post-merge audit reveals problems, a follow-up fix must be prioritized immediately. Abuse of this policy to bypass review for non-critical changes will be treated as a process violation.

## Shared Instructions

This project maintains shared instruction files in `.instructions/shared/` that define reusable patterns for security hooks, git workflow, observability, agent attestation, and more. Review these when contributing changes to the areas they cover:

- **Security**: `repository-security-hooks.md`, `adopter-hook-patterns.md`, `public-mirror-guard.md`
- **Workflow**: `git-workflow.md`, `template-adoption-workflow.md`, `mirrored-release-workflow.md`
- **Analysis**: `language-ecosystem-patterns.md`, `codeql-configuration-patterns.md`, `iac-patterns.md`
- **Operations**: `observability-logging.md`, `agent-attestation.md`, `index-server-bootstrap.md`

## Code Style

Respect existing formatting. Run any lint scripts if present.

## Constitution

This project is governed by a machine-readable constitution (`constitution.json` / `.specify/memory/constitution.md`). All contributions must align with its principles — review it before submitting significant changes.

## Questions

Open a discussion or issue.
