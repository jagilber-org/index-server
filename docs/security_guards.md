# Security & Governance Guards

## Goals

- Prevent accidental commit of secrets, PII, large artifacts.
- Ensure local hook enforcement is aligned with the repository security model.
- Surface dependency vulnerabilities early.

## Mechanisms

1. .gitignore excludes logs, caches, env files, db files.
2. Pre-commit orchestration (.pre-commit-config.yaml):
   - scripts/pre-commit.ps1 blocks forbidden .env-style files
   - scripts/pre-commit.ps1 scans secret regexes and curated PII patterns (email, phone, SSN, public IPv4, Luhn-validated credit cards, Azure connection strings, SAS tokens, certificate thumbprints)
   - scripts/pre-commit.ps1 checks exact sensitive environment variable values for live leak detection
   - .pii-allowlist, # pii-allowlist, and env-leak-allowlist support intentional false-positive suppression
   - narrowly scoped file allowlists are reserved for generated or vendored artifacts when regex suppression would be broader than intended
   - ggshield and detect-secrets provide layered secret scanning
3. Pre-push hooks:
   - gitleaks runs before push using the repo-owned .gitleaks.toml baseline
   - scripts/run-semgrep-pre-push.ps1 runs Semgrep against workflow, script, and config surfaces before push
   - scripts/pre-push-public-guard.cjs blocks direct pushes to public mirrors without the publish flow
   - scripts/pre-push.ps1 runs the slow regression suite for code pushes
4. Manual security scan (scripts/security-scan.mjs):
   - npm audit
   - repo-wide curated PII scan aligned with the pre-commit rules
5. CI security workflows:
   - .github/workflows/precommit.yml replays pre-commit policy and the dedicated security pre-push hooks in CI, and uploads a ggshield JSON report artifact
   - .github/workflows/ggshield-secret-scans.yml runs dedicated GGShield PR, manual, and scheduled scans
   - .github/workflows/gitleaks-secret-scans.yml runs PR range, manual repo/history, and scheduled history secret scans and uploads SARIF
   - .github/workflows/semgrep.yml runs supplemental workflow and CI/config analysis and uploads SARIF

## Future Enhancements

- Add commit-msg hook enforcing Conventional Commits.
- Integrate trufflehog for deeper secret scanning.
- Add dependency review / license allow list.

## Operational Guidance

- Run: `pre-commit run --files <changed files>` while iterating on touched files.
- Run: `pre-commit run --all-files` after hook changes.
- Run: `node scripts/security-scan.mjs` before release when you want a repo-wide audit.
- Rotate any secret if false positive uncertainty exists.
