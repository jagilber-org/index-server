# Docker Deployment Guide

## Overview

Index Server ships with a production-hardened Docker image featuring:
- **Multi-stage build** — compile-time tools excluded from runtime image
- **Non-root execution** — runs as `node` user
- **Tini init** — proper PID 1 signal handling (graceful shutdown)
- **Health checks** — automatic container health monitoring
- **Read-only filesystem** — via docker-compose (tmpfs for temp files)
- **Resource limits** — memory and CPU caps prevent runaway processes
- **TLS support** — optional HTTPS with auto-generated or custom certificates

## Quick Start

### HTTP Mode (default)

```bash
# Build and run
docker compose up -d

# View logs
docker compose logs -f index-server

# Check health
docker inspect --format='{{.State.Health.Status}}' index-server
```

The default compose file publishes the dashboard to `127.0.0.1` only. To expose it on another host interface intentionally, set `INDEX_SERVER_PORT_BIND_HOST=0.0.0.0` when starting compose.

### HTTPS Mode

```bash
# Generate self-signed certificates
node scripts/generate-certs.mjs

# Run with TLS
docker compose --profile tls up -d
```

### Interactive Setup

```bash
# Guided configuration wizard
node scripts/setup-wizard.mjs

# Non-interactive
node scripts/setup-wizard.mjs --non-interactive --tls --port 8787 --mutation
```

## Configuration

All application configuration uses environment variables with the `INDEX_SERVER_` prefix.
The compose file also supports `INDEX_SERVER_PORT_BIND_HOST` and defaults it to `127.0.0.1` so published ports stay local unless you intentionally widen exposure.

| Variable | Default | Description |
|----------|---------|-------------|
| `INDEX_SERVER_DASHBOARD` | `1` | Enable admin dashboard |
| `INDEX_SERVER_DASHBOARD_PORT` | `8787` | Dashboard port |
| `INDEX_SERVER_DASHBOARD_HOST` | `0.0.0.0` | In-container bind address |
| `INDEX_SERVER_DASHBOARD_TLS` | `0` | Enable HTTPS |
| `INDEX_SERVER_DASHBOARD_TLS_CERT` | — | TLS certificate path (PEM) |
| `INDEX_SERVER_DASHBOARD_TLS_KEY` | — | TLS private key path (PEM) |
| `INDEX_SERVER_DASHBOARD_TLS_CA` | — | CA certificate path (PEM) |
| `INDEX_SERVER_MUTATION` | `0` | Enable write operations |
| `INDEX_SERVER_LOG_LEVEL` | `info` | Log level (error/warn/info/debug/trace) |
| `INDEX_SERVER_DIR` | `/app/instructions` | Instruction index directory |
| `INDEX_SERVER_METRICS_DIR` | `/app/metrics` | Metrics storage |
| `INDEX_SERVER_FEEDBACK_DIR` | `/app/feedback` | Feedback storage |

## Volumes

| Mount Point | Purpose |
|-------------|---------|
| `/app/instructions` | Instruction index (override built-in bundle) |
| `/app/data` | Persistent state data |
| `/app/certs` | TLS certificates (read-only mount) |
| `/app/logs` | Log files |
| `/app/metrics` | Performance metrics |
| `/app/feedback` | User feedback storage |

## TLS Certificate Generation

### Self-Signed (Development)

```bash
node scripts/generate-certs.mjs --hostname localhost --days 365

# Custom hostname
node scripts/generate-certs.mjs --hostname myserver.example.com --days 730 --key-size 4096
```

Generated files in `./certs/`:
- `ca.crt` — CA certificate (add to trust store for browsers)
- `ca.key` — CA private key (keep secure)
- `server.crt` — Server certificate
- `server.key` — Server private key

### Production Certificates

Mount your own certificates:

```yaml
volumes:
  - /path/to/your/certs:/app/certs:ro
environment:
  - INDEX_SERVER_DASHBOARD_TLS=1
  - INDEX_SERVER_DASHBOARD_TLS_CERT=/app/certs/fullchain.pem
  - INDEX_SERVER_DASHBOARD_TLS_KEY=/app/certs/privkey.pem
```

## Security Features

### Image Hardening
- **Alpine-based** — minimal attack surface (~50MB base)
- **No dev tools** — gcc, make, python removed in build stage
- **Non-root** — all processes run as `node` user (UID 1000)
- **Tini** — prevents zombie processes, proper signal forwarding
- **No new privileges** — `security_opt: no-new-privileges:true`
- **Read-only rootfs** — writable only via tmpfs and named volumes

### Network Security
- **Single port exposed** — only dashboard port (8787)
- **Localhost publish by default** — docker-compose publishes to `127.0.0.1` unless overridden
- **Container bind for reachability** — the service binds `0.0.0.0` inside the container so published ports work correctly
- **Security headers** — CSP, X-Frame-Options, HSTS, X-Content-Type-Options
- **No version disclosure** — X-Powered-By removed

### TLS Configuration
- **HSTS** — Strict-Transport-Security header when TLS enabled
- **Modern protocols** — Node.js default TLS (TLS 1.2+ only)
- **Per-request CSP nonce** — unique nonce per response
- **WSS** — WebSocket Secure for dashboard real-time updates

## Testing

```bash
# All tests
npm test

# Security-specific tests
npm run test:security    # nmap + Docker + security headers
npm run test:nmap        # Network security scanning (requires nmap)
npm run test:docker      # Docker image security (requires Docker)

# Performance tests
npm run test:perf        # Latency, throughput, memory benchmarks

# CRUD lifecycle tests
npm run test:crud        # Full instruction create/read/update/delete

# Dashboard tests
npm run test:dashboard   # API endpoints, headers, TLS

# Setup wizard tests
npm run test:wizard      # Configuration generation validation

# Playwright E2E (requires running dashboard)
npm run pw:test          # Full browser-based UI tests
```

## Docker Commands

```bash
# Build image
npm run docker:build

# Run (HTTP)
npm run docker:run

# Run (HTTPS)
npm run docker:run:tls

# Stop
npm run docker:stop

# View health
docker inspect --format='{{json .State.Health}}' index-server | jq .

# Enter container for debugging
docker exec -it index-server sh

# View resource usage
docker stats index-server

# Expose the dashboard beyond localhost intentionally
INDEX_SERVER_PORT_BIND_HOST=0.0.0.0 docker compose up -d
```

## Troubleshooting

### Container won't start
```bash
docker logs index-server
# Check for permission issues or missing files
```

### Health check failing
```bash
# Verify endpoint manually
docker exec index-server wget -q -O- http://127.0.0.1:8787/api/status
```

### TLS errors
```bash
# Verify certificate
openssl x509 -in certs/server.crt -text -noout

# Test TLS connection
openssl s_client -connect localhost:8787 -CAfile certs/ca.crt
```

### Read-only filesystem errors
The docker-compose sets `read_only: true`. If the app needs to write to a path
not covered by volumes, add it to `tmpfs` or create a named volume.
