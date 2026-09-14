# Privacy Policy

**Effective Date:** 2025-06-15  
**Last Updated:** 2026-04-25  
**Project:** Index (`@jagilber-org/index-server`)  
**License:** MIT

---

## Summary

Index Server itself collects **no personal data**. All processing occurs locally on your machine in the default configuration. No telemetry, analytics, usage tracking, or phone-home behavior exists. Optional features (semantic search) may trigger a one-time third-party download — see [Optional Network Connections](#optional-network-connections) for details.

---

## Data Collection

**Index Server itself collects no personal data.** Specifically:

- **No personal information** is collected, stored, or transmitted by Index Server
- **No telemetry** is sent to any external service by Index Server
- **No usage analytics** leave your machine
- **No cookies** are set (the dashboard, if enabled, is localhost-only)
- **No user accounts** are required
- **No registration** is required

> **Scope note:** This policy covers only the Index Server application. Your MCP client, operating system, Node.js runtime, and npm registry may have their own data collection practices outside the scope of this policy.

---

## Local Processing

All Index operations — instruction CRUD, search, governance hashing, integrity verification, usage tracking, feedback, and audit logging — are performed entirely on the local machine. Data is stored in local files on disk. No data is transmitted to any external service during normal operation.

---

## Optional Network Connections

Index has exactly **three** code paths that make outbound network connections. **Which are active depends on the configuration profile**, and only one of the three ever leaves the machine.

| Connection | Destination | When | Default | How to Disable |
|------------|-------------|------|---------|----------------|
| Semantic search model download | `huggingface.co` (HTTPS, port 443) | One-time download on first semantic search request | **Off on `default`; ON for `enhanced` and `experimental`** | `INDEX_SERVER_SEMANTIC_ENABLED=0` or `INDEX_SERVER_SEMANTIC_LOCAL_ONLY=1` |
| Leader/follower RPC | `127.0.0.1` (localhost only) | Multi-instance mode only | Off (`INDEX_SERVER_MODE=standalone`) | `INDEX_SERVER_MODE=standalone` |
| Instance health ping | `127.0.0.1` (localhost only) | Dashboard clustering only | **ON for every profile** (loopback-bound) | `INDEX_SERVER_DASHBOARD=0` |

> **The profile the setup wizard gives most users is `enhanced`.** It prompts for semantic search with "yes" preselected, and answering yes selects `enhanced` — which permits the one-time model download. If you want the fully-offline posture described below, choose the `default` profile or set `INDEX_SERVER_SEMANTIC_LOCAL_ONLY=1` explicitly.

**No user data is included in any outbound connection.** The only external download is a pre-trained open-source ML model from HuggingFace.

> **HuggingFace CDN note:** The one-time model download connects to `huggingface.co` over HTTPS. HuggingFace's CDN infrastructure may log standard HTTP request metadata (IP address, user-agent, timestamps) according to their own [privacy policy](https://huggingface.co/privacy). Index Server does not control or have access to HuggingFace's server-side logging. After the one-time download, the model is cached locally and all subsequent operations are fully offline.

For detailed technical verification procedures (including Process Monitor and network audit commands), see [Network Privacy & Verification Guide](docs/network-privacy.md).

---

## Fully Offline Operation

Set `INDEX_SERVER_SEMANTIC_ENABLED=0`, `INDEX_SERVER_MODE=standalone` and `INDEX_SERVER_DASHBOARD=0`, and the server makes **zero outbound network connections of any kind** and opens no network listener, operating as a pure stdio process.

Two of those three are already the case on the `default` profile. **`INDEX_SERVER_DASHBOARD` is not** — every profile enables the dashboard, so a default install *does* open a listener. That listener binds to `127.0.0.1` only (`INDEX_SERVER_DASHBOARD_HOST` defaults to loopback), so it is not reachable from another machine, but it is a listener and `netstat` will show it. Set `INDEX_SERVER_DASHBOARD=0` for the no-listener posture.

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
