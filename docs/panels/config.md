# Configuration Panel

The dashboard **Configuration** tab is the registry-driven view of Index Server
runtime settings. It displays recognized `INDEX_SERVER_*` flags whether they are
set explicitly or using defaults.

## What the Panel Shows

- Effective runtime value and documented default
- Category, stability, description, and validation constraints
- Reload behavior: dynamic, next request, or restart required
- Read-only reason for protected, derived, deprecated, reserved, or legacy flags
- A warning when the runtime overlay shadows a different process environment value
- Sensitive-value presence without returning the value itself

Use the search box to filter by flag name or description. Flags are grouped by
category and rendered from `FLAG_REGISTRY`, the same metadata source used by the
admin configuration API.

## Editing Settings

Editable values can be changed in the panel and saved together. The dashboard
posts flag-keyed updates to `POST /api/admin/config` and stores accepted values
in the runtime overrides file (default `./data/runtime-overrides.json`).

Most settings are classified **restart required**. Saving them persists the new
value, but the running server continues using its current value until restart.
The panel identifies the smaller set of dynamic and next-request flags.

Read-only flags cannot be saved or reset. The API and persistence layer both
enforce this restriction.

## Sensitive Values

Sensitive entries never include plaintext `value`, `parsed`, or `enabled` data
in `GET /api/admin/config`. The API returns only `present: true|false`, and the
panel renders **Configured** or **Not configured** without creating an input.

This applies to credentials and lifecycle command strings. Even an authenticated
dashboard administrator cannot retrieve those values through the configuration
endpoint.

## Lifecycle Hooks

The top-of-panel **Lifecycle hooks** summary provides:

| Status | Meaning |
| --- | --- |
| Enabled / Disabled | Whether at least one non-empty hook command is configured |
| Commands configured | Number of configured create, update, remove, and change commands (zero to four) |
| Blocking | Whether mutation calls wait for selected hooks |
| Timeout | Per-hook wall-clock limit |
| Max concurrent | Process-wide in-flight hook limit |

Command rows remain presence-only in the flag table, while the dedicated
**Manage lifecycle hooks** card provides blank, write-only replacement fields:

- `INDEX_SERVER_HOOK_ON_CREATE`
- `INDEX_SERVER_HOOK_ON_UPDATE`
- `INDEX_SERVER_HOOK_ON_REMOVE`
- `INDEX_SERVER_HOOK_ON_CHANGE`

Existing command text is never loaded into the form. Entering a command replaces
the configured value; **Clear** stages an empty value that disables that hook.
Commands are stored in the runtime overrides file with owner-only file mode on
supported platforms. Avoid embedding credentials in command text; reference a
protected script or secret store instead.

The same card exposes these execution controls:

- `INDEX_SERVER_HOOK_BLOCKING`
- `INDEX_SERVER_HOOK_TIMEOUT_MS`
- `INDEX_SERVER_HOOK_MAX_CONCURRENT`

All lifecycle settings require restart. Commands can alternatively be supplied
through the Index Server launch environment or MCP client server definition.
See [Lifecycle Hooks](../lifecycle-hooks.md)
for setup examples, event mapping, security boundaries, and delivery semantics.

## Common Settings

| Variable | Default | Description |
| --- | --- | --- |
| `INDEX_SERVER_DIR` | `./instructions` | Instruction catalog directory |
| `INDEX_SERVER_MUTATION` | on | Write operations; set off for read-only mode |
| `INDEX_SERVER_DASHBOARD_PORT` | `8787` | Dashboard HTTP/HTTPS port |
| `INDEX_SERVER_DASHBOARD_TLS` | off | Enable dashboard HTTPS |
| `INDEX_SERVER_VERBOSE_LOGGING` | off | Verbose runtime logging |
| `INDEX_SERVER_BACKUPS_DIR` | `<INDEX_SERVER_DIR>/../backups` | Backup storage directory (derived from the instruction directory when unset) |
| `INDEX_SERVER_AUTO_BACKUP` | on | Create periodic backups |
| `INDEX_SERVER_SEMANTIC_ENABLED` | off | Enable semantic search and embedding compute |

## API and Authorization

| Endpoint | Purpose |
| --- | --- |
| `GET /api/admin/config` | Read registry metadata and redacted runtime state |
| `POST /api/admin/config` | Validate and persist `{ "updates": { ... } }` |
| `POST /api/admin/config/reset/:flag` | Remove an editable flag from the overlay |

When `INDEX_SERVER_ADMIN_API_KEY` is configured, admin requests require
`Authorization: Bearer <key>`. Without a key, admin mutation access is restricted
to loopback requests. Sensitive redaction applies regardless of authentication.

## Troubleshooting

- **Saved value has no immediate effect:** check the reload badge; most flags
	need a server restart.
- **Environment value appears ignored:** look for the **shadows ENV** indicator
	and reset the editable overlay entry if the process environment should win.
- **Hook shows Not configured:** enter a command in **Manage lifecycle hooks**,
	save, and restart Index Server; launcher environment configuration is also supported.
- **Flag is read-only:** use the documented secure/operator configuration path;
	the dashboard intentionally refuses the write.
- **Configuration request is unauthorized:** verify the Bearer token or access
	the dashboard from loopback when no admin key is configured.

**Full runtime reference:** [configuration.md](../configuration.md)
