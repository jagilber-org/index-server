# `--init-cert`: Bootstrap a Self-Signed TLS Certificate

`--init-cert` is a built-in CLI switch on `index-server` that generates a
self-signed TLS certificate + key suitable for the admin dashboard. It exists
so operators do **not** need to compose multi-line `openssl req` commands or
remember the SAN extension syntax just to enable HTTPS for local/dev use.

> **Scope:** v1 ships **self-signed certificates only**. CA mode (`--ca`) is
> deferred to v2. Production internet-exposed services should continue to use
> CA-issued certs from your existing PKI.

## Quick start

```powershell
# Generate a self-signed cert at ~/.index-server/certs/ then exit
index-server --init-cert

# Generate AND start the dashboard with it (no extra TLS flags needed)
index-server --init-cert --start

# Custom location, validity, and SANs
index-server --init-cert `
  --cert-dir C:\certs `
  --cn host.local `
  --san DNS:host.local,IP:127.0.0.1 `
  --days 365 `
  --key-bits 4096
```

```bash
# POSIX equivalent
index-server --init-cert \
  --cert-dir /etc/index-server/certs \
  --cn host.local \
  --san DNS:host.local,IP:127.0.0.1
```

After successful generation, the cert and key files are written to
`<cert-dir>/index-server.crt` and `<cert-dir>/index-server.key` (or the paths
you specified via `--cert-file` / `--key-file`).

## Requirements

- **`openssl` on `PATH`.** The switch invokes the system `openssl` binary via
  `child_process.execFile` (no shell). If `openssl` is missing, generation
  fails with a stable error code `OPENSSL_NOT_FOUND`. Install OpenSSL:
  - Windows: Git for Windows ships an `openssl.exe`, or use Chocolatey
    (`choco install openssl`) or [openssl.org downloads][openssl-dl].
  - macOS: `brew install openssl@3` (and ensure it is on `PATH`).
  - Linux: `apt install openssl` / `dnf install openssl`.

[openssl-dl]: https://www.openssl.org/source/

## Flags

| Flag | Type | Default | Notes |
|---|---|---|---|
| `--init-cert` | bool | off | Trigger generation. Process exits after unless `--start` is also given. |
| `--cert-dir <path>` | string | `<home>/.index-server/certs` | Output directory. Created if missing. |
| `--cert-file <path>` | string | `<cert-dir>/index-server.crt` | Override cert path. **Must resolve under `--cert-dir`** (path-traversal guard). |
| `--key-file <path>` | string | `<cert-dir>/index-server.key` | Override key path. Same guard. |
| `--cn <name>` | string | `localhost` | Subject CommonName. |
| `--san <list>` | string | `DNS:localhost,IP:127.0.0.1` | Comma-separated SAN entries. Each MUST start with `DNS:` or `IP:`. |
| `--days <n>` | int | `365` | Validity in days. Range: 1..3650 inclusive. |
| `--key-bits <n>` | int | `2048` | RSA key size. Allowed: `2048` or `4096`. |
| `--force` | bool | off | Overwrite existing cert/key files. Without `--force`, an existing pair is preserved and the operation is reported as `skipped`. |
| `--print-env[=FMT]` | bool/string | off | After generation, print `INDEX_SERVER_DASHBOARD_TLS_*` env-var lines to stderr. `FMT` ∈ `posix \| powershell \| both \| auto` (default: `auto`). |
| `--start` | bool | off | After generation, continue normal startup using the generated cert/key (sets `dashboardTls=true` and feeds the paths automatically). |

Both equals (`--cert-dir=...`) and space-separated (`--cert-dir ...`) forms
are accepted.

## What gets written

| Path | Content | Permissions |
|---|---|---|
| `<cert-dir>/index-server.crt` (or `--cert-file`) | PEM-encoded X.509 certificate, self-signed, RSA-`<key-bits>`, valid `<days>` days | OS default |
| `<cert-dir>/index-server.key` (or `--key-file`) | PEM-encoded unencrypted RSA private key | `0600` on POSIX (no-op on Windows; protect via NTFS ACLs) |

The certificate carries a Subject Alternative Name extension built from
`--san`. The default value (`DNS:localhost,IP:127.0.0.1`) covers loopback
HTTPS. For production-internal scenarios add the host's DNS names and IPs:
`--san DNS:host.example.com,DNS:host,IP:10.0.0.10`.

## Composition with the dashboard

The switch composes naturally with the existing dashboard TLS flags:

- `--init-cert` alone → generate files, exit 0.
- `--init-cert --start` → generate files, then start the server with
  `--dashboard-tls --dashboard-tls-cert <generated.crt> --dashboard-tls-key
  <generated.key>` automatically applied.
- `--init-cert --print-env` → generate files, print env-var lines for the
  operator to paste into their shell, exit 0.
- Subsequent runs without `--force` are a no-op (`skipped`); safe to wire
  into idempotent provisioning.

## Output and exit codes

| Outcome | Stderr | Exit code |
|---|---|---|
| Files generated | `[init-cert] generated: cert=... key=...` | `0` |
| Files already present (no `--force`) | `[init-cert] skipped: cert=... key=...` | `0` |
| Validation error (e.g. invalid `--days`) | `[init-cert] FAILED (code=INVALID_DAYS): ...` | `2` |
| `openssl` not on PATH | `[init-cert] FAILED (code=OPENSSL_NOT_FOUND): ...` | `2` |
| `openssl` returned non-zero | `[init-cert] FAILED (code=OPENSSL_FAILED): ...` | `2` |

All success paths additionally emit a structured log via the standard logger
(level `INFO`, namespace `[certInit]`).

### Stable error codes

These codes are part of the public contract and will not change meaning
between minor releases:

- `OPENSSL_NOT_FOUND` — openssl binary not callable.
- `OPENSSL_FAILED` — openssl spawned but exited non-zero.
- `INVALID_DAYS` — `--days` outside `[1, 3650]`.
- `INVALID_KEY_BITS` — `--key-bits` not in `{2048, 4096}`.
- `INVALID_SAN` — empty SAN, missing `DNS:`/`IP:` prefix, or trailing comma.
- `INVALID_CN` — empty `--cn`.
- `PATH_OUTSIDE_CERT_DIR` — `--cert-file` or `--key-file` resolves outside
  `--cert-dir` (path-traversal guard).
- `MKDIR_FAILED` — could not create `--cert-dir`.
- `WRITE_FAILED` — reserved for future filesystem-write failures.

## `--print-env` output

POSIX (`--print-env=posix`):

```sh
export INDEX_SERVER_DASHBOARD_TLS=1
export INDEX_SERVER_DASHBOARD_TLS_CERT="/home/user/.index-server/certs/index-server.crt"
export INDEX_SERVER_DASHBOARD_TLS_KEY="/home/user/.index-server/certs/index-server.key"
```

PowerShell (`--print-env=powershell`):

```powershell
$env:INDEX_SERVER_DASHBOARD_TLS="1"
$env:INDEX_SERVER_DASHBOARD_TLS_CERT="C:\Users\you\.index-server\certs\index-server.crt"
$env:INDEX_SERVER_DASHBOARD_TLS_KEY="C:\Users\you\.index-server\certs\index-server.key"
```

`auto` selects PowerShell on Win32, POSIX elsewhere. `both` emits both blocks
with `# POSIX` / `# PowerShell` headers.

## Security notes

- **Path-traversal guard (SH-4):** Every output path is `path.resolve`d and
  asserted to live under the resolved `--cert-dir`. An override that escapes
  the cert dir is rejected with `PATH_OUTSIDE_CERT_DIR` and **no file is
  written outside the directory**.
- **No shell invocation:** OpenSSL is invoked via `execFile` with an argument
  array. SAN values, CN, paths, etc. are never interpolated into a command
  string, so shell metacharacters in user input cannot reach the shell.
- **TLS verification posture (SH-6):** This switch only generates trust
  material. It does not modify `strict-ssl`, `NODE_TLS_REJECT_UNAUTHORIZED`,
  or any verification setting elsewhere in the server.
- **Key permissions:** Set to `0600` on POSIX. On Windows the POSIX bits are
  ignored by NTFS — restrict access via folder ACLs (e.g. only the service
  account that runs `index-server` should have read access to the key).
- **Key creation race (residual):** OpenSSL writes the private key with the
  process umask. To avoid a brief window where the key would be world-readable
  before the explicit `chmod 0600`, the implementation narrows the umask to
  `0o077` for the duration of the `openssl` call (restored in `finally`) so
  the key is created mode `0o600` from the start. On Windows umask is a no-op
  and NTFS ACLs apply instead. **Residual:** on a multi-user host with a
  hostile sibling user, defense-in-depth is still recommended — run
  `index-server` as a dedicated user, place `--cert-dir` inside that user's
  home, and chmod the parent directory to `0o700` so unprivileged users cannot
  list or stat the key file at all.
- **Trust-store install is out of scope.** Browsers will warn on a
  self-signed cert until you explicitly trust it (Windows: Trusted Root
  Certification Authorities; macOS: Keychain "Always Trust"; Linux: distro-
  specific store). v1 deliberately does not auto-install.
- **No network calls.** Generation is fully local; `openssl req -x509` does
  not contact any CA or OCSP endpoint.

## Idempotency

Re-running `--init-cert` on an existing cert + key pair is a no-op:

```text
$ index-server --init-cert
[init-cert] generated: cert=... key=...

$ index-server --init-cert
[init-cert] skipped: cert=... key=...
```

If **only one** of the two files exists (e.g. you deleted/rotated the key
externally but the cert remains), the run is also skipped with
`reason="partial state on disk; pass --force to overwrite"` so the surviving
file is never silently clobbered. Pass `--force` to overwrite either or both.
The new cert will have a different serial number and `notBefore` timestamp.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `[init-cert] FAILED (code=OPENSSL_NOT_FOUND)` | `openssl` not on `PATH` | Install OpenSSL (see Requirements) and reopen your shell. |
| `[init-cert] FAILED (code=INVALID_SAN)` | SAN entry missing `DNS:`/`IP:` prefix | Use `--san DNS:host,IP:192.0.2.4` (each entry needs the prefix). <!-- # pii-allowlist: RFC 5737 documentation IP --> |
| `[init-cert] FAILED (code=PATH_OUTSIDE_CERT_DIR)` | `--cert-file` / `--key-file` escapes `--cert-dir` | Pass an explicit `--cert-dir` that contains both paths. |
| Browser still warns after using `--start` | Self-signed cert is not trusted by your OS | Either trust the cert in the OS store, or accept the browser's "proceed" dialog (loopback only). |
| `openssl req failed (status=…): unable to write 'random state'` | OpenSSL home dir not writable | Set `OPENSSL_CONF` / `RANDFILE` env vars to a writable path, or run as a user with write access to the OpenSSL home. |

## Out of scope (v1)

- Local-CA mode (`--ca`) and signing chains. Deferred to v2.
- Auto-install into OS trust stores.
- Cert rotation / renewal scheduling.
- mTLS / client-certificate provisioning.
- Bundled JavaScript crypto fallback when `openssl` is absent.
- Persisting generated paths back to a config file on disk (use
  `--print-env` to capture them in your shell environment).

## See also

- [`docs/dashboard.md`](./dashboard.md) — admin dashboard TLS configuration
  with operator-supplied certs.
- [`docs/configuration.md`](./configuration.md) — full CLI flag and env-var
  reference.
- [`docs/security_guards.md`](./security_guards.md) — security guard catalog.
- [`docs/network-privacy.md`](./network-privacy.md) — network/privacy posture.
