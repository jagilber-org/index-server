## Summary

<!-- Brief description of what this PR does and why. -->

## Type

<!-- Check one: -->
- [ ] Feature — new capability, file, or surface
- [ ] Fix — bug fix, hook correction, false-positive resolution
- [ ] Security — scanner config, hook hardening, vulnerability response
- [ ] Docs — documentation, instruction, or metadata update
- [ ] Chore — dependency update, CI config, tooling
- [ ] Release — version bump and release preparation

## Checklist

### Required

- [ ] Topic branch created from `main` (not committed directly)
- [ ] Pre-commit hooks pass locally (`pre-commit run --files <changed>`)
- [ ] Pre-push hooks pass (Semgrep, ggshield, public-repo guard)
- [ ] CI checks pass on this PR
- [ ] Changes are focused — one logical change per PR

### When Applicable

- [ ] Documentation updated for behavioral changes (DC-1)
- [ ] `scripts/test-hook-regressions.ps1` passes (hook changes)
- [ ] `scripts/build/sync-constitution.ps1 -Check` passes (constitution changes)
- [ ] `scripts/validate-template-metadata.ps1` passes (metadata changes)
- [ ] CHANGELOG.md updated (release PRs)
- [ ] Security review completed (hook, scanner, or allowlist changes)

### Mandatory For AI-Generated Code Or Tests

Complete this section whenever any code or tests in this PR were generated or materially edited by an AI agent.
See [`docs/pr_review_checklist.md`](docs/pr_review_checklist.md) for the full policy with examples and grep commands.

- [ ] No placeholder tests were introduced (`placeholder`, `expect(true)`, `expect(1).toBe(1)`, empty `() => {}`)
- [ ] No new `it.skip()` / `describe.skip()` without a linked issue and inline justification
- [ ] Handler changes include negative tests for invalid input, missing fields, and non-existent resources where applicable
- [ ] Mutation-handler tests independently verify disk truth instead of trusting only response payloads
- [ ] No new `SKIP_OK` markers were added
- [ ] Claimed test counts match real assertions and coverage
- [ ] No hardcoded success values such as `verified: true` or `created: true` were added unless derived from a real check
- [ ] Agent attestation metadata present on agent-authored commits (AG-4)
- [ ] Copilot `Co-authored-by: Copilot <copilot-noreply-email>` trailer present on every Copilot-authored commit
- [ ] Tests added for behavioral changes (unit + integration where the change crosses a layer boundary)
- [ ] No new hardcoded paths or secrets — all runtime tunables flow through `src/config/runtimeConfig.ts` (`npm run guard:env` passes)
- [ ] `logAudit()` invoked on every success and side-effecting error path of new/changed mutation handlers
- [ ] `src/services/toolRegistry.ts` updated for new/changed tools: `INPUT_SCHEMAS`, `STABLE` set, `MUTATION` set, `describeTool(...)`, plus side-effect import in `src/services/toolHandlers.ts`
- [ ] All commit subjects follow Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, etc.)
- [ ] If `constitution.json` changed: `pwsh -File scripts/build/sync-constitution.ps1 -Check` exits 0 and rendered `.md` files were regenerated
- [ ] Security-sensitive changes (hooks, scanners, auth, audit, attestation) carry explicit security + testing consensus approvals or a linked decision record
- [ ] Imported/adapted external code has a documented source URL and a license compatible with `LICENSE`; attribution added to `THIRD-PARTY-LICENSES.md` where required

## Testing

<!-- How was this tested? What validation was run? -->

## Related Issues

<!-- Link related issues: Fixes #N, Relates to #N -->
