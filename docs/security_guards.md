# Security & Governance Guards

## Goals
- Prevent accidental commit of secrets, PII, large artifacts.
- Ensure baseline code quality (type, lint, tests) per commit.
- Surface dependency vulnerabilities early.

## Mechanisms
1. .gitignore excludes logs, caches, env files, db files.
2. Pre-commit hook (scripts/pre-commit.ps1):
   - Typecheck
   - Lint
   - Tests
   - Secret regex scan (AWS, generic secret, GitHub token, PEM)
3. Manual security scan (scripts/security-scan.ps1):
   - npm audit
   - PII heuristic scan (SSN / 16-digit sequences)

## Future Enhancements
- Add commit-msg hook enforcing Conventional Commits.
- Integrate trufflehog / gitleaks for deeper secret scanning.
- Add SAST (semgrep) in CI.
- Add dependency review / license allow list.

## Operational Guidance
- Run: `pwsh scripts/security-scan.ps1` before release.
- Rotate any secret if false positive uncertainty exists.
