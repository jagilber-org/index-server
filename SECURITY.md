# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 1.x.x   | ✅ Active support  |
| < 1.0   | ❌ End of life     |

## Reporting a Vulnerability

**Do NOT open public issues for security vulnerabilities.**

Please report suspected vulnerabilities privately using one of these methods:

1. **GitHub Security Advisories** (preferred) — create a new advisory on the [public repository](https://github.com/jagilber-org/index-server/security/advisories). Advisories are always filed against the public mirror (`jagilber-org/index-server`), not the private dev repo.
2. **Email** — contact the maintainer at the email listed in the repository's GitHub profile.

When reporting, include:

- Reproduction steps and environment details
- Impact assessment and affected versions
- Any relevant logs or proof-of-concept (redact sensitive data)

### Response Timeline

- **Acknowledgement**: within 48 hours of receipt
- **Detailed response**: within 5 business days
- **Fix or mitigation**: coordinated with reporter before public disclosure

## Vulnerability Disclosure

We follow responsible disclosure practices:

- Confirm the issue and assign a CVE if applicable.
- Prepare a fix and coordinate a release timeline with the reporter.
- Credit reporters who wish to be acknowledged in the advisory and changelog.

## Urgent Security Merge Policy

Critical or actively-exploited vulnerabilities may be merged with **zero pre-merge review** when delay would increase exposure risk. The following conditions apply:

1. **Post-merge audit required** — a full code review MUST occur within 24 hours of the merge.
2. **Commit or PR rationale** — the merge commit and/or PR description must document why the normal review process was bypassed (for example, active exploitation, severity, or blast radius).
3. **Async reviewer sign-off** — at least one maintainer must provide a reviewing sign-off within 24 hours, confirming the fix is correct and complete.
4. **Reference the vulnerability** — the commit and/or PR must reference the relevant CVE, advisory, or issue number.
5. **Scope limit** — this policy applies **only** to critical and actively-exploited vulnerabilities. Non-critical security issues follow the standard review process.

If the post-merge audit reveals problems, a follow-up fix must be prioritized immediately. Abuse of this policy to bypass review for non-critical changes is a process violation.

## Security Practices

- **Pre-commit hooks** scan for secrets and PII before code leaves the developer machine
- **Bootstrap gating** — all mutation operations require explicit bootstrap confirmation
- **Audit logging** — every Index mutation is logged with timestamp, action, and actor
- **Content scanning** — automated checks before public publishing via dual-repo workflow
- **Mutation controls** — `INDEX_SERVER_MUTATION=0` forces a read-only runtime when you need to disable write operations explicitly
- **Auth key support** — `INDEX_SERVER_AUTH_KEY` is documented as an environment variable for dashboard and API access but is **not enforced at runtime** — the server does not check or validate this key on any request path. This is an experimental placeholder. Do not rely on this setting for access control. See [CODE_SECURITY_REVIEW.md](CODE_SECURITY_REVIEW.md) § Security Gaps for implementation status.

## Hardening Notes

This project includes enterprise hardening features (localhost-only dashboard binding, bootstrap gating, audit logging, mutation controls, pre-commit secret scanning). Keep any future auth secrets private. Avoid committing credentials or tokens.
