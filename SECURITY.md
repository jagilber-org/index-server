# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 1.x.x   | ✅ Active support  |
| < 1.0   | ❌ End of life     |

## Reporting a Vulnerability

**Do NOT open public issues for security vulnerabilities.**

Please report suspected vulnerabilities privately using one of these methods:

1. **GitHub Security Advisories** (preferred) — create a new advisory on the [public repository](https://github.com/jagilber-org/index-server/security/advisories).
2. **Email** — contact the maintainer at the email listed in the repository's GitHub profile.

When reporting, include:

- Reproduction steps and environment details
- Impact assessment and affected versions
- Any relevant logs or proof-of-concept (redact sensitive data)

### Response Timeline

- **Acknowledgement**: within 48 hours of receipt
- **Detailed response**: within 7 business days
- **Fix or mitigation**: coordinated with reporter before public disclosure

## Vulnerability Disclosure

We follow responsible disclosure practices:

- Confirm the issue and assign a CVE if applicable.
- Prepare a fix and coordinate a release timeline with the reporter.
- Credit reporters who wish to be acknowledged in the advisory and changelog.

## Security Practices

- **Pre-commit hooks** scan for secrets and PII before code leaves the developer machine
- **Bootstrap gating** — all mutation operations require explicit bootstrap confirmation
- **Audit logging** — every Index mutation is logged with timestamp, action, and actor
- **Content scanning** — automated checks before public publishing via dual-repo workflow
- **Mutation controls** — `INDEX_SERVER_MUTATION` environment variable gates write operations
- **Auth key support** — optional `INDEX_SERVER_AUTH_KEY` for securing dashboard and API access

## Hardening Notes

This project includes enterprise hardening (see `HARDENING-DESIGN.md`). Keep auth secrets (`INDEX_SERVER_AUTH_KEY`) private. Avoid committing credentials or tokens.
