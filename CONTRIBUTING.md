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
3. `npm test`
4. `npm run build`

## Branching

Use feature branches. Submit PRs to `main`.

## Commit Messages

Use conventional style where practical (feat:, fix:, docs:, chore:).

## Tests

Include unit tests for new logic. Run `npm test` and ensure coverage not reduced.

### Configuration & Environment Variables

Do NOT introduce new top-level `process.env.*` usages scattered across the codebase.

All runtime and test tunables must flow through `src/config/runtimeConfig.ts`:

1. If you need a new timing / wait value, extend `INDEX_SERVER_TIMING_JSON` key usage (e.g. `{"featureX.startupWait":5000}`) instead of adding `FEATUREX_STARTUP_WAIT_MS`.
2. For logging verbosity, use `INDEX_SERVER_LOG_LEVEL` (levels: silent,error,warn,info,debug,trace) or add a trace token to `INDEX_SERVER_TRACE` (comma-separated) rather than a new boolean flag.
3. For mutation gating, rely on `INDEX_SERVER_MUTATION` (legacy `INDEX_SERVER_MUTATION` is auto-mapped; do not reintroduce it).
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

## Code Style

Respect existing formatting. Run any lint scripts if present.

## Constitution

This project is governed by a machine-readable constitution (`constitution.json` / `.specify/memory/constitution.md`). All contributions must align with its principles — review it before submitting significant changes.

## Questions

Open a discussion or issue.
