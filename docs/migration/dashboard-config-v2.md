# Migration: Dashboard Configuration API v2 (#359)

The dashboard Configuration tab moved from a hand-rolled envelope to a
registry-driven flag surface. The new shape is the **single canonical
contract** — there is no compatibility shim; the legacy envelope is
rejected.

PR: <https://github.com/jagilber-dev/index-server/pull/362>
Issue: <https://github.com/jagilber-dev/index-server/issues/359>

---

## TL;DR

| Concern | Before | After |
|---|---|---|
| GET response | `{ serverSettings, indexSettings, securitySettings, ... }` | `{ success, allFlags: FlagSnapshot[], timestamp }` |
| POST request | `{ serverSettings: { enableVerboseLogging, ... } }` | `{ updates: { INDEX_SERVER_VERBOSE_LOGGING: true } }` |
| POST partial-failure status | `200` regardless | `200` all-applied, `207` partial, `400` none-applied |
| Reset a single flag | DELETE the whole config | `POST /api/admin/config/reset/:flag` |
| Sensitive secrets in GET | leaked as plaintext | omitted; `present: boolean` only |

---

## GET `/api/admin/config`

### Old

```json
{
  "success": true,
  "serverSettings": { "enableVerboseLogging": false, "maxConnections": 100, ... },
  "indexSettings":  { "maxBodyLength": 50000, ... },
  "securitySettings": { "adminApiKey": "sk_live_REAL_SECRET", ... },
  "timestamp": 1700000000000
}
```

### New

```json
{
  "success": true,
  "allFlags": [
    {
      "name": "INDEX_SERVER_VERBOSE_LOGGING",
      "value": "1",
      "parsed": true,
      "meta": {
        "label": "Verbose logging",
        "reloadBehavior": "restart-required",
        "editable": true,
        "validation": { "type": "boolean" },
        "surfaces": ["pinned"]
      },
      "overlayShadowsEnv": false
    },
    {
      "name": "INDEX_SERVER_ADMIN_API_KEY",
      "meta": {
        "label": "Admin API key",
        "reloadBehavior": "restart-required",
        "editable": false,
        "readonlyReason": "sensitive",
        "validation": { "type": "string" }
      },
      "overlayShadowsEnv": false,
      "present": true
    }
  ],
  "timestamp": 1700000000000
}
```

Notes:

- **Sensitive redaction** — flags with `editable:false && readonlyReason:'sensitive'`
  omit `value` and `parsed` entirely and expose only `present: boolean`. Other
  readonly reasons (`derived`, `deprecated`, `reserved`, `legacy`) keep their
  value because operators legitimately need to read them.
- `overlayShadowsEnv: true` indicates an overlay entry is masking a
  *different* `process.env` value present at boot. The dashboard renders a
  pill and tooltip; the reset endpoint surfaces the shadowed value in its
  message.

---

## POST `/api/admin/config`

### Old (REJECTED in v2)

```http
POST /api/admin/config
Content-Type: application/json

{ "serverSettings": { "enableVerboseLogging": true, "maxConnections": 50 } }
```

→ `400 Bad Request`:

```json
{
  "success": false,
  "code": "USE_FLAG_KEYS",
  "error": "Legacy envelope payloads are no longer accepted; POST { updates: { FLAG_NAME: value } } instead.",
  "timestamp": 1700000000000
}
```

### New

```http
POST /api/admin/config
Content-Type: application/json
Authorization: Bearer <INDEX_SERVER_ADMIN_API_KEY>

{
  "updates": {
    "INDEX_SERVER_VERBOSE_LOGGING": true,
    "INDEX_SERVER_DASHBOARD_PORT": 17328
  }
}
```

Response codes:

| Outcome | Status | `success` |
|---|---|---|
| Every update applied | `200` | `true` |
| At least one applied AND at least one failed | `207 Multi-Status` | `true` |
| Every update failed (validation, readonly, unknown flag) | `400` | `false` |

Body shape (always):

```json
{
  "success": true,
  "results": {
    "INDEX_SERVER_VERBOSE_LOGGING": {
      "applied": true,
      "reloadBehavior": "restart-required",
      "requiresRestart": true
    },
    "INDEX_SERVER_DASHBOARD_PORT": {
      "applied": false,
      "reloadBehavior": "restart-required",
      "requiresRestart": true,
      "error": "[RANGE] value must be a port between 1 and 65535"
    }
  },
  "timestamp": 1700000000000
}
```

Validation error codes carried in `error` are one of:
`READONLY | TYPE | RANGE | ENUM | PATTERN | FORMAT`.

---

## Reset a single flag

```http
POST /api/admin/config/reset/INDEX_SERVER_VERBOSE_LOGGING
Authorization: Bearer <INDEX_SERVER_ADMIN_API_KEY>
```

Removes the overlay entry and restores `process.env` to the boot-time
shadowed value (or unsets it when none was shadowed). When the overlay
shadowed an env value at boot, the response is:

```json
{
  "success": true,
  "message": "Reverted INDEX_SERVER_VERBOSE_LOGGING to ENV value `0`.",
  "shadowedEnvValue": "0",
  "timestamp": 1700000000000
}
```

Otherwise `"Reverted INDEX_SERVER_VERBOSE_LOGGING to built-in default."` and
`shadowedEnvValue: null`.

Readonly flags refuse the reset:

```json
{
  "success": false,
  "code": "READONLY",
  "readonlyReason": "sensitive",
  "error": "Flag INDEX_SERVER_ADMIN_API_KEY is readonly (sensitive) and cannot be reset via the dashboard.",
  "timestamp": 1700000000000
}
```

Status: `409 Conflict`.

---

## Overlay file

The overlay lives at `data/runtime-overrides.json` by default and is read
**once at boot** before the first `getRuntimeConfig()` call. Merge order:

```
overlay value > process.env value > built-in default
```

`process.env` values *shadowed by* an overlay entry are captured in an
in-memory snapshot and surfaced via:

- the GET `overlayShadowsEnv: true` field, and
- the reset endpoint's `shadowedEnvValue` field.

Disable the overlay entirely with `INDEX_SERVER_DISABLE_OVERRIDES=1`.
Override the file path with `INDEX_SERVER_OVERRIDES_FILE=/path/to/overrides.json`.

Concurrency: the on-disk rename is atomic. The surrounding read-modify-write
envelope is **single-writer-by-convention**; deployments running multiple
admin writers concurrently must serialize externally.

---

## Reload-behavior taxonomy

Every flag carries `meta.reloadBehavior`:

| Value | Badge | Meaning |
|---|---|---|
| `dynamic` | 🟢 | Picked up on the next read of `getRuntimeConfig().field`. |
| `next-request` | 🟡 | Picked up on the next HTTP request boundary. |
| `restart-required` | 🔴 | Captured at boot or in module-load parsers; requires a process restart. |

When you write to a `restart-required` flag, the dashboard shows the row's
🔴 badge and a persistent **"Pending restart"** banner until the overlay
entry is either reset or matches the active runtime value (e.g. because a
restart has occurred).

In the current architecture the majority of flags are classified as
`restart-required` because `getRuntimeConfig()` returns a frozen singleton
captured at module load. The save path calls `reloadRuntimeConfig()` so a
future promotion of individual flags to `dynamic` is a registry update only,
not a structural change.

---

## Consumer remediation checklist

- [ ] Replace any `serverSettings` / `indexSettings` / `securitySettings`
      reads with `allFlags[]` lookups by `name`.
- [ ] For each POST writer, wrap the payload in `{ updates: { ... } }` and
      use the flag's full `INDEX_SERVER_*` env-var name as the key.
- [ ] Handle `400 USE_FLAG_KEYS` defensively if your code still ships an
      old build during rollout.
- [ ] Stop reading `securitySettings.adminApiKey` (or any other
      `sensitive` flag) from GET responses — they no longer carry a value.
      If you need to confirm configuration, read `present: boolean`.
- [ ] Treat `207 Multi-Status` as success-with-warnings, not as failure.
- [ ] If you previously DELETE'd the whole config to clear a single flag,
      switch to `POST /api/admin/config/reset/:flag`.
