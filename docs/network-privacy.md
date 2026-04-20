# Network Privacy & Verification Guide

Complete reference for Index outbound network behavior, embedded AI components,
and how to verify the server makes no unwanted connections.

---

## Outbound Connection Inventory

Index has exactly **three** code paths that make outbound network connections.
All three are disabled by default in the standard configuration.

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
| `INDEX_SERVER_SEMANTIC_ENABLED` | `0` | Set to `0` to disable the entire semantic search subsystem. No model loading, no inference, no network calls. |
| `INDEX_SERVER_SEMANTIC_LOCAL_ONLY` | `1` | Set to `1` to block remote model downloads. Model must already exist in `INDEX_SERVER_SEMANTIC_CACHE_DIR`. |
| `INDEX_SERVER_SEMANTIC_MODEL` | `Xenova/all-MiniLM-L6-v2` | The HuggingFace model identifier. Only used when semantic search is enabled. |
| `INDEX_SERVER_SEMANTIC_CACHE_DIR` | `./data/models` | Local directory where the model is cached after download. |

**How to download the model once and run offline forever:**

```bash
# Step 1: Enable semantic search and allow remote download
INDEX_SERVER_SEMANTIC_ENABLED=1 INDEX_SERVER_SEMANTIC_LOCAL_ONLY=0 node dist/server/index-server.js
# Trigger a semantic search to force model download, then stop the server.

# Step 2: Lock to local-only (this is already the default)
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
| **Protocol** | HTTP (localhost only, never remote) |
| **When** | Only in follower mode (`INDEX_SERVER_MODE=follower`) |
| **Data sent** | JSON-RPC requests forwarded from stdio to leader |
| **Data received** | JSON-RPC responses from leader instance |

**Environment controls:**

| Variable | Default | Effect |
|----------|---------|--------|
| `INDEX_SERVER_MODE` | `standalone` | Set to `standalone` to disable all leader/follower networking. |
| `INDEX_SERVER_LEADER_PORT` | `9191` | Port used for leader RPC. Only relevant in leader/follower mode. |

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
| `INDEX_SERVER_DASHBOARD` | `0` | Set to `0` to disable the dashboard entirely. No HTTP server, no clustering. |

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
| **Enabled by default** | No (`INDEX_SERVER_SEMANTIC_ENABLED=0`) |

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

## Default Configuration = Fully Offline

The default environment configuration makes **zero outbound network connections**:

```bash
INDEX_SERVER_SEMANTIC_ENABLED=0    # Semantic search disabled (default)
INDEX_SERVER_SEMANTIC_LOCAL_ONLY=1  # Remote model downloads blocked (default)
INDEX_SERVER_MODE=standalone        # No leader/follower networking (default)
INDEX_SERVER_DASHBOARD=0            # No dashboard HTTP server (default)
```

With these defaults (which require no configuration), the server operates as a pure
stdio process with no network listeners and no outbound connections.

---

## Verification

### Quick check: no listening ports

```powershell
# Start the server, then check for listening ports owned by the node process
$proc = Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {
    $_.MainModule.FileName -match 'node'
}
Get-NetTCPConnection -OwningProcess $proc.Id -State Listen -ErrorAction SilentlyContinue
# Expected output: empty (no listening ports in standalone mode)
```

### Quick check: no outbound connections

```powershell
# While the server is running
Get-NetTCPConnection -OwningProcess $proc.Id -State Established -ErrorAction SilentlyContinue
# Expected output: empty (no established connections in default config)
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
