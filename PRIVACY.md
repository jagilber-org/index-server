# Privacy Policy

**Effective Date:** 2025  
**Project:** Index (`@jagilber-org/index-server`)  
**License:** MIT

---

## Summary

Index collects **no personal data**. All processing occurs locally on your machine. No telemetry, analytics, usage tracking, or phone-home behavior exists in the default configuration.

---

## Data Collection

**We collect no data.** Specifically:

- **No personal information** is collected, stored, or transmitted
- **No telemetry** is sent to any external service
- **No usage analytics** leave your machine
- **No cookies** are set (the dashboard, if enabled, is localhost-only)
- **No user accounts** are required
- **No registration** is required

---

## Local Processing

All Index operations — instruction CRUD, search, governance hashing, integrity verification, usage tracking, feedback, and audit logging — are performed entirely on the local machine. Data is stored in local files on disk. No data is transmitted to any external service during normal operation.

---

## Optional Network Connections

Index has exactly **three** code paths that make outbound network connections. **All three are disabled by default.**

| Connection | Destination | When | How to Disable |
|------------|-------------|------|----------------|
| Semantic search model download | `huggingface.co` (HTTPS, port 443) | One-time download on first semantic search request | `INDEX_SERVER_SEMANTIC_ENABLED=0` (default) or `INDEX_SERVER_SEMANTIC_LOCAL_ONLY=1` (default) |
| Leader/follower RPC | `127.0.0.1` (localhost only) | Multi-instance mode only | `INDEX_SERVER_MODE=standalone` (default) |
| Instance health ping | `127.0.0.1` (localhost only) | Dashboard clustering only | `INDEX_SERVER_DASHBOARD=0` (default) |

**No user data is included in any outbound connection.** The only external download is a pre-trained open-source ML model from HuggingFace. After the one-time download, the model is cached locally and all subsequent operations are fully offline.

For detailed technical verification procedures (including Process Monitor and network audit commands), see [Network Privacy & Verification Guide](docs/network-privacy.md).

---

## Fully Offline Operation

The default configuration (`INDEX_SERVER_SEMANTIC_ENABLED=0`, `INDEX_SERVER_MODE=standalone`, `INDEX_SERVER_DASHBOARD=0`) makes **zero outbound network connections of any kind**. The server operates as a pure stdio process with no network listeners and no outbound connections.

See [Network Privacy & Verification Guide](docs/network-privacy.md) for air-gapped deployment instructions.

---

## Data Controller

If you use Index to process files or instructions that contain personal data, **you** are the sole data controller. Index is a local tool — it does not act as a data processor on your behalf. You are responsible for compliance with applicable data protection regulations (GDPR, CCPA, HIPAA, etc.) as they apply to the data you store in your instruction index.

---

## Third-Party Dependencies

Index's dependencies do not independently collect data. The optional `@huggingface/transformers` package performs local ML inference only. See [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md) for dependency license details.

---

## Changes to This Policy

Changes to this privacy policy will be documented in the [CHANGELOG.md](CHANGELOG.md) and reflected in the repository commit history.

---

## Contact

For privacy-related questions, open an issue on the [GitHub repository](https://github.com/jagilber-org/index-server/issues) or contact the maintainer via the email listed in the repository's GitHub profile.
