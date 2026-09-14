# Lifecycle Hooks

Lifecycle hooks run trusted local commands after Index Server durably commits an instruction mutation. They are optional and remain disabled until at least one command is configured.

Use hooks for cache invalidation, repository synchronization, notifications, or other post-commit automation. The instruction index remains the source of truth.

## Configure Hooks

Open the Configuration tab and find the Manage lifecycle hooks card. Each command field is write-only: existing command text is never returned to the browser.

| Setting | Purpose |
| --- | --- |
| On create | Runs after a new instruction is committed. |
| On update | Runs after an existing instruction is overwritten. |
| On remove | Runs after one or more instructions are removed. |
| On any change | Runs after every committed mutation, import, or promotion. |
| Blocking | Waits for selected commands before returning the mutation response. |
| Timeout | Sets the per-command wall-clock limit in milliseconds. |
| Max concurrent | Limits the number of hook child processes running at once. |

Enter a command to replace its current value, or select Clear to disable it. Save the configuration and restart Index Server before using the new settings.

## Event Behavior

- Create, update, and remove events select their matching command and the On any change command.
- Import and repository-promotion events select only On any change.
- Identical matching commands run once per event.
- Skipped writes, duplicate writes, failed persistence, and zero-result mutations do not dispatch hooks.
- Hook failures never roll back an already committed mutation.

Non-blocking mode returns without waiting for child completion. Blocking mode waits up to the configured timeout, but command failure remains isolated from the committed mutation.

## Hook Input

Mutation data is passed through standard input and environment variables; it is never interpolated into the configured command.

| Environment variable | Value |
| --- | --- |
| INDEX_SERVER_HOOK_OPERATION | create, update, remove, or change |
| INDEX_SERVER_HOOK_ACTION | Originating mutation action |
| INDEX_SERVER_HOOK_IDS | Comma-separated affected instruction identifiers |
| INDEX_SERVER_HOOK_CORRELATION_ID | Request correlation identifier, when available |
| INDEX_SERVER_HOOK_CONTEXT | JSON context containing operation, action, ids, correlationId, metadata, and timestamp |

Prefer INDEX_SERVER_HOOK_CONTEXT when a hook consumes multiple identifiers or mutation metadata.

## Security

- Treat configured commands and scripts as privileged operator automation.
- Never derive command text from instruction content or request parameters.
- Do not embed credentials in command text. Use a protected launcher environment or secret store.
- Restrict hook-script permissions and validate every external side effect.
- The dashboard reports command presence only and never displays stored command text.

## Troubleshooting

1. Confirm the Lifecycle hooks summary reports Enabled and the expected command count.
2. Restart Index Server after saving hook configuration.
3. Confirm the triggering mutation committed a real change.
4. Search structured logs for lifecycle-hooks warnings or errors.
5. Test the command directly under the same account and environment as Index Server.
6. In blocking mode, confirm the command finishes within the configured timeout.

See the [Configuration panel documentation](/api/docs/config) for dashboard configuration behavior and authorization requirements.
