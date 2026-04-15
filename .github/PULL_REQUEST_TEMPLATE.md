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
- [ ] `scripts/sync-constitution.ps1 -Check` passes (constitution changes)
- [ ] `scripts/validate-template-metadata.ps1` passes (metadata changes)
- [ ] CHANGELOG.md updated (release PRs)
- [ ] Security review completed (hook, scanner, or allowlist changes)

## Testing

<!-- How was this tested? What validation was run? -->

## Related Issues

<!-- Link related issues: Fixes #N, Relates to #N -->
