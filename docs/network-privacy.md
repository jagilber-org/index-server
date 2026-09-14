# Network Privacy & Verification Guide

Complete reference for Index outbound network behavior, embedded AI components,
and how to verify the server makes no unwanted connections.

---

## Outbound Connection Inventory

Index has exactly **three** code paths that make outbound network connections.
**Which of them are active depends on the configuration profile** — see the
per-profile table under [Per-profile defaults](#per-profile-defaults).
In short: the dashboard listener is on for every profile (bound to loopback),
the semantic model download is on for `enhanced` and `experimental`, and
leader/follower RPC is off unless multi-instance mode is enabled.

### 1. Semantic Search Model Download

| Field | Value |
|-------|-------|
| **Source file** | `src/services/embeddingService.ts` |
| **Destination** | `https://huggingface.co/Xenova/all-MiniLM-L6-v2` |
| **Protocol** | HTTPS (port 443) |
| **When** | First semantic search request only (one-time download) |
| **Data sent** | HTTP GET for model files (~90 MB ONNX model) |
| **Data received** | Pre-trained model weights (public, open-source) |
| **User data sent** | None |

**Environment controls:**

| Variable | Default | Effect |
|----------|---------|--------|
| `INDEX_SERVER_SEMANTIC_ENABLED` | `0` on `default`; **`1` on `enhanced` / `experimental`** | Set to `0` to disable the entire semantic search subsystem. No model loading, no inference, no network calls. |
| `INDEX_SERVER_SEMANTIC_LOCAL_ONLY` | `1` on `default`; **`0` (remote download allowed) on `enhanced` / `experimental`** | Set to `1` to block remote model downloads. Model must already exist in `INDEX_SERVER_SEMANTIC_CACHE_DIR`. |
| `INDEX_SERVER_SEMANTIC_MODEL` | `Xenova/all-MiniLM-L6-v2` | The HuggingFace model identifier. Only used when semantic search is enabled. |
| `INDEX_SERVER_SEMANTIC_CACHE_DIR` | `./data/models` | Local directory where the model is cached after download. |

**How to download the model once and run offline forever:**

```bash
# Step 1: Enable semantic search and allow remote download
INDEX_SERVER_SEMANTIC_ENABLED=1 INDEX_SERVER_SEMANTIC_LOCAL_ONLY=0 node dist/server/index-server.js
# Trigger a semantic search to force model download, then stop the server.

# Step 2: Lock to local-only (already the default on the `default` profile only —
# `enhanced` and `experimental` ship with LOCAL_ONLY=0, so set it explicitly)
INDEX_SERVER_SEMANTIC_ENABLED=1 INDEX_SERVER_SEMANTIC_LOCAL_ONLY=1 node dist/server/index-server.js
# All subsequent runs use the cached model. Zero network calls.
```

**How to verify in code:** The `ensureModel()` function in `embeddingService.ts` sets
`transformers.env.allowRemoteModels = false` when `localOnly` is true. This is a
library-level block that prevents any HTTP request to model repositories.

### 2. Leader/Follower RPC (Multi-Instance Mode)

| Field | Value |
|-------|-------|
| **Source file** | `src/dashboard/server/ThinClient.ts` |
| **Destination** | `http://127.0.0.1:{INDEX_SERVER_LEADER_PORT}/mcp/rpc` |
| **Protocol** | HTTP. Loopback-enforced on `POST /mcp/rpc` since #605: without `INDEX_SERVER_ADMIN_API_KEY` a non-loopback caller is refused with 403; with a key set, `Authorization: Bearer` is required. |
| **When** | When running the thin-client entry point (`src/server/thin-client.ts`), or after losing an `INDEX_SERVER_MODE=auto` election. **Not** `INDEX_SERVER_MODE=follower` on the main entry point, which is not implemented — see [multi_instance_design.md](multi_instance_design.md). |
| **Data sent** | JSON-RPC requests forwarded from stdio to leader |
| **Data received** | JSON-RPC responses from leader instance |

**Environment controls:**

| Variable | Default | Effect |
|----------|---------|--------|
| `INDEX_SERVER_MODE` | `standalone` | Set to `standalone` to disable all leader/follower networking. |
| `INDEX_SERVER_LEADER_PORT` | `9090` (`4090` under the `dev` profile) | Port used for leader RPC. Only relevant in leader/follower mode. This said `9191` until #589; the value is in `src/config/defaultValues.ts:63`. |
| `INDEX_SERVER_ADMIN_API_KEY` | (unset) | When set, `POST /mcp/rpc` requires a Bearer token. When unset, the route is loopback-only. |

**Security note:** The ThinClient connects exclusively to `127.0.0.1`. The address is
hardcoded to localhost -- it never resolves or connects to remote hosts.

### 3. Instance Health Ping (Dashboard Clustering)

| Field | Value |
|-------|-------|
| **Source file** | `src/dashboard/server/InstanceManager.ts` |
| **Destination** | `http://127.0.0.1:{dashboard_port}/api/instances` |
| **Protocol** | HTTP (localhost only, never remote) |
| **When** | Only when dashboard is enabled and multiple instances are registered |
| **Data sent** | HTTP GET health check |
| **Data received** | Instance status JSON |

**Environment controls:**

| Variable | Default | Effect |
|----------|---------|--------|
| `INDEX_SERVER_DASHBOARD` | `1` | Set to `0` to disable the dashboard entirely. No HTTP server, no clustering. |

**Security note:** Like the ThinClient, this connects exclusively to `127.0.0.1`.

---

## What Does NOT Phone Home

The following activities generate **zero** outbound network traffic:

- Server startup and initialization
- Instruction CRUD (add, get, list, remove, update)
- Keyword search (non-semantic)
- Usage tracking and analytics
- Governance hashing and integrity verification
- Audit logging
- Feedback submission and retrieval
- Bootstrap confirmation workflow
- Dashboard rendering (all assets served locally)
- Schema validation
- Index snapshots and backups
- `--init-cert` certificate bootstrap (invokes local `openssl`; no CA or
  OCSP endpoints contacted; cert material stays on the host)

---

## Embedded AI Details

### Component: `@huggingface/transformers`

Index optionally uses the `@huggingface/transformers` npm package for local
machine learning inference. This is used exclusively for semantic (vector) search of
the instruction index.

| Property | Value |
|----------|-------|
| **npm package** | `@huggingface/transformers` |
| **Model** | `Xenova/all-MiniLM-L6-v2` (sentence embeddings, ~90 MB ONNX) |
| **Runtime** | ONNX Runtime (WASM by default, optional CUDA/DirectML GPU) |
| **Inference location** | 100% local, on-device |
| **Training** | None. The model is pre-trained and read-only. |
| **Data sent externally** | None during inference. Model download is one-time HTTPS GET. |
| **Enabled by default** | Profile-dependent: **no** on `default` (`INDEX_SERVER_SEMANTIC_ENABLED=0`), **yes** on `enhanced` and `experimental` |

### What the model does

When semantic search is enabled, the model converts instruction text and search queries
into 384-dimensional embedding vectors. Search results are ranked by cosine similarity
between the query vector and instruction vectors. All computation happens locally.

### GPU acceleration (optional)

| Variable | Options | Notes |
|----------|---------|-------|
| `INDEX_SERVER_SEMANTIC_DEVICE` | `cpu` (default), `cuda`, `dml` | `cpu` uses WASM. `cuda` requires NVIDIA GPU + CUDA. `dml` uses DirectML on Windows. |

GPU acceleration is optional and does not change the network behavior -- it only affects
where the local inference computation runs.

---

## Default Network Posture

The default configuration makes **zero outbound network connections** but opens a
**loopback-only** HTTP listener for the admin dashboard:

```bash
INDEX_SERVER_SEMANTIC_ENABLED=0    # Semantic search disabled (default)
INDEX_SERVER_SEMANTIC_LOCAL_ONLY=1  # Remote model downloads blocked (default)
INDEX_SERVER_MODE=standalone        # No leader/follower networking (default)
INDEX_SERVER_DASHBOARD=1            # Dashboard HTTP on 127.0.0.1:8787 (default)
```

The dashboard binds exclusively to `127.0.0.1` (loopback) and is not reachable
from other machines. To disable it entirely, set `INDEX_SERVER_DASHBOARD=0`.

### Per-profile defaults

| Variable | `default` | `enhanced` | `experimental` |
|----------|-----------|------------|----------------|
| `INDEX_SERVER_DASHBOARD` | `1` (on, loopback) | `1` | `1` |
| `INDEX_SERVER_SEMANTIC_ENABLED` | `0` (off) | `1` (on) | `1` (on) |
| `INDEX_SERVER_SEMANTIC_LOCAL_ONLY` | `1` (no remote) | `0` (remote OK) | `0` (remote OK) |

The `enhanced` and `experimental` profiles enable semantic search with remote model
downloads. The first download fetches ~90 MB from `huggingface.co` (HTTPS GET);
subsequent runs use the local cache. Set `INDEX_SERVER_SEMANTIC_LOCAL_ONLY=1` to
block this on any profile.

---

## Verification

### Quick check: no listening ports

```powershell
# Start the server, then check for listening ports owned by the node process
$proc = Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {
    $_.MainModule.FileName -match 'node'
}
Get-NetTCPConnection -OwningProcess $proc.Id -State Listen -ErrorAction SilentlyContinue
# Expected output: ONE listener on 127.0.0.1:8787 (the dashboard, which every
# profile enables by default and which binds to loopback only).
#
# A non-empty result here is normal and is NOT a privacy problem: the address
# must be 127.0.0.1 (or ::1), never 0.0.0.0 or a routable address. Check the
# LocalAddress column rather than the row count.
#
# To have no listener at all, start with INDEX_SERVER_DASHBOARD=0.
```

### Quick check: no outbound connections

```powershell
# While the server is running
Get-NetTCPConnection -OwningProcess $proc.Id -State Established -ErrorAction SilentlyContinue
# Expected output: empty on the `default` profile.
#
# On `enhanced` / `experimental` the first semantic search performs a one-time
# HTTPS GET to huggingface.co (~90 MB); after it is cached there are no further
# outbound connections. Set INDEX_SERVER_SEMANTIC_LOCAL_ONLY=1 to block it on
# any profile. Loopback entries to the dashboard port are local, not outbound.
```

### Deep verification with Process Monitor

For a thorough audit, use [Process Monitor](https://learn.microsoft.com/en-us/sysinternals/downloads/procmon):

1. Start Process Monitor
2. Add filter: `Process Name is node.exe`
3. Add filter: `Operation is TCP Connect`
4. Start the index
5. Exercise all operations (search, add, list, etc.)
6. Check Process Monitor -- should show zero TCP Connect events in default config

### Verify semantic search isolation

If you enable semantic search with a pre-cached model:

```powershell
# Enable semantic search with local-only model
$env:INDEX_SERVER_SEMANTIC_ENABLED = "1"
$env:INDEX_SERVER_SEMANTIC_LOCAL_ONLY = "1"
# Start server and run searches
# Process Monitor should still show zero outbound TCP connections
```

### Verify model download destination

If you allow a model download, the only outbound connection should be to `huggingface.co`:

```powershell
$env:INDEX_SERVER_SEMANTIC_ENABLED = "1"
$env:INDEX_SERVER_SEMANTIC_LOCAL_ONLY = "0"
# Start server and trigger semantic search
# Process Monitor should show TCP Connect to huggingface.co (port 443) only
# After download completes, set INDEX_SERVER_SEMANTIC_LOCAL_ONLY=1 to prevent future downloads
```

---

## Air-Gapped / Offline Deployment

For environments with no internet access:

1. **On an internet-connected machine**, download the model:
   ```bash
   INDEX_SERVER_SEMANTIC_ENABLED=1 INDEX_SERVER_SEMANTIC_LOCAL_ONLY=0 INDEX_SERVER_SEMANTIC_CACHE_DIR=./model-cache \
     node dist/server/index-server.js
   # Trigger one semantic search, then stop
   ```

2. **Copy the model cache** to the air-gapped machine:
   ```bash
   # Copy the model-cache/ directory to the target machine
   scp -r model-cache/ target-machine:/path/to/index-server/data/models/
   ```

3. **Configure the air-gapped deployment:**
   ```bash
   INDEX_SERVER_SEMANTIC_ENABLED=1
   INDEX_SERVER_SEMANTIC_LOCAL_ONLY=1
   INDEX_SERVER_SEMANTIC_CACHE_DIR=/path/to/index-server/data/models
   INDEX_SERVER_MODE=standalone
   INDEX_SERVER_DASHBOARD=0
   ```

This gives full semantic search capability with zero network dependencies.

---

## Source Code References

| File | Outbound call | Line reference |
|------|---------------|----------------|
| `src/services/embeddingService.ts` | HuggingFace model download | `ensureModel()` function |
| `src/dashboard/server/ThinClient.ts` | Leader RPC | `sendRpc()` method |
| `src/dashboard/server/InstanceManager.ts` | Instance health | `validateInstance()` method |
| `src/dashboard/integration/APIIntegration.ts` | None (template class, never instantiated) | N/A |

No other source files contain `http.get`, `http.request`, `https.get`, `https.request`,
`fetch()`, `axios`, or any other HTTP client calls.
