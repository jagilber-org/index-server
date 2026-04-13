## Set Up Semantic Search (Enhanced Profile)

Semantic search uses a local embedding model to find instructions by meaning, not just keywords.

### First-Time Model Download

The model (~90 MB) must be downloaded once. Set these env vars temporarily:

```
INDEX_SERVER_SEMANTIC_ENABLED=1
INDEX_SERVER_SEMANTIC_LOCAL_ONLY=0
```

Start the server and run a search — the model downloads automatically to `data/models/`.

After the download completes, lock it down:

```
INDEX_SERVER_SEMANTIC_LOCAL_ONLY=1
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `INDEX_SERVER_SEMANTIC_ENABLED` | `0` | Enable semantic search |
| `INDEX_SERVER_SEMANTIC_MODEL` | `Xenova/all-MiniLM-L6-v2` | HuggingFace model name |
| `INDEX_SERVER_SEMANTIC_DEVICE` | `cpu` | Compute: `cpu`, `cuda`, or `dml` (Windows ML) |
| `INDEX_SERVER_SEMANTIC_CACHE_DIR` | `./data/models` | Downloaded model files |
| `INDEX_SERVER_EMBEDDING_PATH` | `./data/embeddings.json` | Cached embedding vectors |
| `INDEX_SERVER_SEMANTIC_LOCAL_ONLY` | `1` | Block remote downloads after setup |

### Recommended Model

For better quality (~30% improvement), switch to:

```
INDEX_SERVER_SEMANTIC_MODEL=Xenova/bge-base-en-v1.5
```

This produces 768-dimensional embeddings and is ~90 MB.

### Verify

In Copilot Chat (agent mode), try:

```
search index-server for post installation configuration
```

Results should include semantically related instructions, not just keyword matches.

[Show Status](command:index.showStatus) · [Re-generate Config](command:index.configure)

### Tips

- Embeddings are cached and only recomputed when instructions change
- Switching models auto-invalidates the cache
- Use `scripts/benchmark-search.ps1` to compare search quality
- The dashboard has an **Embeddings** panel showing vector coverage
