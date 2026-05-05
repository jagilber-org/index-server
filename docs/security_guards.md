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
    - scripts/pre-commit.ps1 treats every path-shaped value from local .env files as PII and fails if it appears in tracked files
    - .pii-allowlist and # pii-allowlist support intentional PII false-positive suppression; env-value leaks do not support allowlist suppression
   - narrowly scoped file allowlists are reserved for generated or vendored artifacts when regex suppression would be broader than intended
   - ggshield and detect-secrets provide layered secret scanning
3. Pre-push hooks:
   - gitleaks runs before push using the repo-owned .gitleaks.toml baseline
   - scripts/run-semgrep-pre-push.ps1 runs Semgrep against workflow, script, and config surfaces before push
   - scripts/pre-push-public-guard.cjs blocks direct pushes to public mirrors without the publish flow
   - scripts/pre-push.ps1 runs the slow regression suite for code pushes
4. Manual security scan (scripts/security-scan.mjs):
   - npm audit
   - repo-wide curated PII scan aligned with the pre-commit rules, excluding generated runtime artifact directories, backups, internal metadata directories, and known generated instruction manifests
5. CI security workflows:
    - .github/workflows/precommit.yml replays pre-commit policy and the dedicated security pre-push hooks in CI, and uploads a ggshield JSON report artifact
    - .github/workflows/ggshield-secret-scans.yml runs dedicated GGShield PR, manual, and scheduled scans
    - .github/workflows/gitleaks-secret-scans.yml runs PR range, manual repo/history, and scheduled history secret scans and uploads SARIF
    - .github/workflows/semgrep.yml runs supplemental workflow and CI/config analysis and uploads SARIF

## Blocking vs Advisory Scanners

The scanner name alone does not define whether a finding blocks a PR or public
release. Use the workflow/script exit behavior as the source of truth:

| Scanner/check | Current blocking behavior |
|---------------|---------------------------|
| Pre-commit forbidden file, curated PII, live env-value leak, gitleaks, detect-secrets, protected-remote guards | Blocking in the local/pre-commit path where configured. |
| `scripts/governance/security-scan.mjs` | Blocking for high/critical `npm audit` findings and curated PII findings; low/moderate advisories are informational. |
| `New-CleanRoomCopy.ps1` forbidden artifact, PII, and ambient env-value scans | Blocking when forbidden artifacts, PII findings, or exact sensitive env-value leaks are reported. The clean-room path points the pre-commit scanner at repo-root `.env` instead of disabling ambient env scanning. If no PII scanner script is found, the scan is skipped and the operator must perform manual review before delivery. |
| `publish-direct-to-remote.cjs` env-value leak scan | Blocking before direct publish. |
| Release workflow validation | Blocking for typecheck, lint, build, unit tests, and log hygiene. |
| Secret scanner workflow uploads | Blocking; upload failures are visible workflow failures, not hidden green runs. SARIF processing wait is disabled where repository tokens cannot read workflow-run status; the upload itself and artifact capture remain visible. |
| GGShield quota and scanner errors | Blocking by default. PR commit-range quota exhaustion is explicitly advisory because it depends on an external GitGuardian quota; manual and scheduled GGShield scans still fail closed, and non-quota scanner errors remain blocking. |
| Release workflow Trivy image scan | Advisory (`exit-code: 0`). |
| Tier 2 ZAP baseline and Trivy container scan | Advisory; reports are uploaded for triage. |
| Tier 3 ZAP full scan, testssl, and nikto | Advisory by default; server startup and security-header validation remain blocking. |

## Future Enhancements

- Add commit-msg hook enforcing Conventional Commits.
- Integrate trufflehog for deeper secret scanning.
- Add dependency review / license allow list.

## Runtime Guards

### `--init-cert` (Certificate Bootstrap)

The `--init-cert` CLI switch on `index-server` generates a self-signed TLS
cert+key for the dashboard. Relevant security guards:

- **Path-traversal guard (SH-4):** every output path (`--cert-file`,
  `--key-file`) is `path.resolve`d and asserted to live strictly under the
  resolved `--cert-dir`. Escapes are rejected with stable error code
  `PATH_OUTSIDE_CERT_DIR` and **no file is written outside the directory**.
- **No shell invocation:** OpenSSL is invoked via `child_process.execFile`
  with an argument array. SAN values, CN, and paths are never interpolated
  into a shell command, so shell metacharacters in user input cannot reach
  the shell.
- **TLS verification posture (SH-6):** the switch only generates trust
  material; it never modifies `strict-ssl`, `NODE_TLS_REJECT_UNAUTHORIZED`,
  or any verification flag elsewhere in the server.
- **Key permissions:** private key written `0600` on POSIX. On Windows the
  POSIX bits are ignored by NTFS — restrict access via folder ACLs.
- **No automatic OS-trust-store install** (out of scope for v1; security-
  sensitive and platform-specific).

See [`cert_init.md`](cert_init.md) for the full reference.

## Operational Guidance

- Run: `pre-commit run --files <changed files>` while iterating on touched files.
- Run: `pre-commit run --all-files` after hook changes.
- Run: `node scripts/security-scan.mjs` before release when you want a repo-wide audit.
- Rotate any secret if false positive uncertainty exists.
