# scripts/hooks

Git hook implementations. These are **not** the hooks themselves (those live in
`.git/hooks/`); these are the scripts that hooks invoke. Managed by `pre-commit`
via `.pre-commit-config.yaml`. Run `pwsh -File scripts/hooks/setup-hooks.ps1`
once to wire them up.

## Scripts

| Script | Hook | Purpose |
|--------|------|---------|
| `pre-commit.mjs` | `pre-commit` | ESM pre-commit runner: lint, type-check, schema validate |
| `pre-commit.ps1` | `pre-commit` | PowerShell pre-commit runner (PII scan, security scan) |
| `pre-push.mjs` | `pre-push` | ESM pre-push runner: full test suite gate |
| `pre-push.ps1` | `pre-push` | PowerShell pre-push runner: build verify + governance |
| `pre-push-integrity.ps1` | `pre-push` | Assert dist/ integrity before push |
| `pre-push-log-hygiene.ps1` | `pre-push` | Block if debug log statements remain in staged files |
| `pre-push-public-guard.cjs` | `pre-push` | CJS guard: block push to public remote without clean-room check |
| `run-codeql-pre-push.ps1` | `pre-push` | Run CodeQL analysis before push through `hooks/codeql-pre-push.ps1` |
| `hooks/run-gitleaks-pre-push.ps1` | `pre-push` | Run gitleaks commit-range scanning before push |
| `run-semgrep-pre-push.ps1` | `pre-push` | Run Semgrep SAST before push |
| `setup-hooks.cjs` | setup | CJS installer: symlink hook scripts into `.git/hooks/` |
| `setup-hooks.ps1` | setup | PowerShell installer: same, with Windows path handling |

**There is no `commit-msg` hook.** The table used to list `commit-msg-baseline.{mjs,ps1}`
as validating "commit message against Conventional Commits". It never did that:
it exited 0 unless `INTERNAL-BASELINE.md` appeared in the staged diff, and that
file does not exist and has no commits — so the hook could not fire, on any
commit, ever. Deleted in #582 along with the rest of the baseline machinery.
`setup-hooks.cjs` removes the stale hook from existing clones.

Conventional-commit format is therefore **unenforced** at commit time. If that
is wanted, it needs a real check, not a resurrection of this one.

## Setup

```pwsh
# Install hooks once after cloning
pwsh -File scripts/hooks/setup-hooks.ps1

# Template-compatible wrapper
pwsh -File scripts/setup-hooks.ps1

# Or via pre-commit
pre-commit install --hook-type pre-push
```

> Do NOT use `--no-verify` to bypass hooks. Fix the gate or fix the code.
