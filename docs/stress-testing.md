# Stress Testing

This guide covers the two PowerShell stress test scripts for Index Server and how to run them locally or in CI.

## Scripts Overview

| Script | Purpose |
|--------|---------|
| `scripts/perf/stress-test.ps1` | Simple CRUD cycle stress with per-operation timing |
| `scripts/perf/stress-test-crud.ps1` | Comprehensive CRUD stress with phased operations, usage tracking, and hotset queries |
| `scripts/perf/stress-test-backup.ps1` | Backup lifecycle stress with CRUD seeding and backup/restore cycling |
| `scripts/diagnostics/sqlite-validate.ps1` | SQLite integrity checks via PRAGMA and the dashboard validate endpoint |

Both scripts exercise a running Index Server instance through `index-server-client.ps1`, validate operation-specific response payloads, and report timing, success/failure counts, and error details.

## stress-test.ps1

Runs N iterations of a full CRUD cycle (add → get → search → update → verify update → remove → verify delete) and reports per-operation latency statistics. Each step validates the response shape and expected IDs/content, so malformed or success-shaped failures count as test failures.

### Usage

```powershell
# Run 50 sequential iterations
.\scripts\stress-test.ps1 -Iterations 50

# Run 200 iterations with 4 parallel workers
.\scripts\stress-test.ps1 -Iterations 200 -Parallel 4

# Target a specific server with auth
.\scripts\stress-test.ps1 -BaseUrl https://my-server:4600 -AdminKey $env:MY_KEY -SkipCertCheck

# Clean up leftover test instructions
.\scripts\stress-test.ps1 -CleanupOnly
```

### Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `-BaseUrl` | `$env:INDEX_SERVER_URL` or `http://localhost:4600` | Server URL |
| `-Iterations` | `100` | Number of CRUD cycles |
| `-Prefix` | `stress-test` | ID prefix for test instructions |
| `-Parallel` | `1` | Concurrent workers (requires PS 7+ when > 1) |
| `-SkipCertCheck` | `$false` | Skip TLS certificate validation |
| `-NoDelete` | `$false` | Skip the delete + verify phase |
| `-CleanupOnly` | `$false` | Only remove leftover `stress-test-*` instructions |
| `-AdminKey` | `$env:INDEX_SERVER_ADMIN_API_KEY` | Bearer token for authenticated endpoints |

## stress-test-crud.ps1

A more comprehensive stress test that runs multi-phase CRUD cycles including create, read (sampled), list, search, update verification, usage tracking, hotset queries, delete, and sampled delete verification. Reports ops/sec and success rate.

### Usage

```powershell
# Default: 50 instructions × 3 cycles, 5 parallel workers
.\scripts\stress-test-crud.ps1

# Custom configuration
.\scripts\stress-test-crud.ps1 -BaseUrl http://localhost:4600 -Count 100 -Cycles 5 -Parallel 10
```

### Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `-BaseUrl` | `http://localhost:4600` | Server URL |
| `-ClientScript` | `scripts/client/index-server-client.ps1` | Path to client script |
| `-Count` | `50` | Instructions per cycle |
| `-Cycles` | `3` | Number of full CRUD cycles |
| `-Parallel` | `5` | Max concurrent operations in the CREATE phase |
| `-AdminKey` | `$env:INDEX_SERVER_ADMIN_API_KEY` | Bearer token for authenticated endpoints |

## Response Validation

Both stress scripts dot-source `scripts\crud-response-validation.ps1` and fail when a tool response is missing required payload fields. The validators check:

- add responses report the expected ID and `created`/`overwritten` state
- get responses return the expected instruction ID, title, and body content
- search/list responses include result collections and expected IDs where applicable
- remove responses include the deleted ID in `removedIds`
- delete verification responses report `notFound=true`
- usage, hotset, health, and embedding endpoints return success-shaped payloads

## Parallel Mode

Both scripts support parallel execution but use different scopes:

- **`stress-test.ps1`**: Parallelizes entire CRUD cycles across workers using `ForEach-Object -Parallel`.
- **`stress-test-crud.ps1`**: Parallelizes the CREATE phase within each cycle using `ForEach-Object -Parallel`.

### Requirements

- **PowerShell 7+** is required for parallel mode (`ForEach-Object -Parallel` is not available in Windows PowerShell 5.1).
- If you request `-Parallel N` (where N > 1) on PS 5.1, `stress-test.ps1` will exit with a clear error message.
- Sequential mode (`-Parallel 1`, the default for `stress-test.ps1`) works on any PowerShell version.

### Checking your PowerShell version

```powershell
$PSVersionTable.PSVersion
# Must be 7.0 or higher for parallel mode
```

## CI Integration

Stress tests are run via the **Nightly Stress Suite** workflow defined in `.github/workflows/stress-nightly.yml`.

- **Trigger**: Manual dispatch only (`workflow_dispatch`) to conserve CI minutes.
- **Runner**: `ubuntu-latest` with Node.js 22.
- **Steps**: Install → Build → Run focused stress suite → Run full stress suite → Collect diagnostics.
- **Artifacts**: Logs and diagnostics are uploaded as `stress-logs` with 5-day retention.
- **Failure handling**: On failure, an issue is automatically created with the `stress-failure` label (if one doesn't already exist).

To trigger manually, go to **Actions → Nightly Stress Suite → Run workflow** in the GitHub UI.

## Cleanup

Both scripts create temporary instructions with predictable prefixes. To clean up after a failed or interrupted run:

```powershell
# stress-test.ps1 cleanup
.\scripts\stress-test.ps1 -CleanupOnly

# For stress-test-crud.ps1, instructions are deleted at the end of each cycle.
# If interrupted, manually remove with:
.\scripts\index-server-client.ps1 -Action search -Keywords @('stress-test-c') -Limit 500
# Then remove each ID found.
```

## Troubleshooting

### Rate Limiting (HTTP 429)

`stress-test-crud.ps1` has built-in retry logic with backoff for 429 responses (up to 3 attempts). If you see persistent 429 errors:

- Reduce `-Parallel` or `-Count`.
- Check the server's rate limiting configuration.
- Add a delay between cycles.

### Authentication Errors

If the server requires authentication, pass the admin key:

```powershell
.\scripts\stress-test.ps1 -AdminKey "your-key-here"
# Or set the environment variable:
$env:INDEX_SERVER_ADMIN_API_KEY = "your-key-here"  # pragma: allowlist secret
```

### TLS Certificate Errors

For self-signed certificates or development servers:

```powershell
.\scripts\stress-test.ps1 -SkipCertCheck
```

### Server Not Reachable

Both scripts perform a health check before starting. If it fails:

1. Verify the server is running: `curl http://localhost:4600/health`
2. Check the `-BaseUrl` parameter matches your server address.
3. Ensure firewall rules allow the connection.
