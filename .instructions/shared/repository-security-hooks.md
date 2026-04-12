# Repository Security Hooks

## Purpose

Document the layered Git hook security model so agents and contributors
understand each protection layer, update hooks safely, and avoid
weakening controls without explicit rationale.

## The 10-Layer Hook Model

| Layer | Protection                   | Hook Phase  | Key Script / Tool                                                                      |
| ----- | ---------------------------- | ----------- | -------------------------------------------------------------------------------------- |
| 1     | Forbidden file blocking      | pre-commit  | `scripts/pre-commit.ps1`                                                               |
| 2     | Curated PII scanning         | pre-commit  | `scripts/pre-commit.ps1`, `.pii-allowlist`                                             |
| 3     | Live env-value leak scan     | pre-commit  | `scripts/pre-commit.ps1`                                                               |
| 4     | Standard secret scanners     | pre-commit  | `ggshield`, `detect-secrets`                                                           |
| 5     | Pre-push gitleaks scan       | pre-push    | `.gitleaks.toml`, `gitleaks` via `.pre-commit-config.yaml`                             |
| 6     | Pre-push Semgrep scan        | pre-push    | `scripts/run-semgrep-pre-push.ps1`, `semgrep` via `.pre-commit-config.yaml`            |
| 7     | Protected-remote enforcement | pre-push    | `scripts/pre-push-public-guard.cjs`                                                    |
| 8     | Slow regression gate         | pre-push    | `scripts/pre-push.ps1`                                                                 |
| 9     | CI replay of local policy    | CI workflow | `.github/workflows/ci.yml`, `.github/workflows/precommit.yml`                          |
| 10    | Supplemental CI scans        | CI workflow | `ggshield-secret-scans.yml`, `gitleaks-secret-scans.yml`, `semgrep.yml`                |

## Update Guidance

- When changing hook logic, update the matching docs and local
  instructions in the same commit.
- Prefer narrow file allowlists for generated artifacts over broad regex
  suppression when resolving hook false positives.
- Avoid weakening allowlists without explicit rationale documented
  in the PR description or adoption notes.
- Run `pre-commit run --files <changed>` on touched files before
  broader `pre-commit run --all-files` validation.
- Run `pre-commit run --all-files` after any hook configuration change.

## Operational Guidance

- `pre-commit` is the single Git hook orchestrator for this repo.
- Do not layer Husky or parallel hook managers on top of pre-commit
  unless the repo explicitly replaces it and documents the decision.
- Keep CI aligned with local enforcement — CI must not be materially
  weaker than the local gates.
- Use `.template-adoption.json` `localDeviations` to document any
  intentional differences from the canonical template hook setup.
