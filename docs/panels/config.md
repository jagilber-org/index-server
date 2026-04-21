# Configuration Panel

The Configuration panel displays the current server runtime configuration.

## Server Configuration

Shows all active configuration values resolved from environment variables, defaults, and feature flags. Configuration is read-only in the dashboard — changes require updating environment variables and restarting the server.

### Key Configuration Groups

- **Server** — transport mode, port, host, TLS settings
- **Instructions** — instruction directory path, max body size, content types
- **Mutation** — whether write operations are enabled, bulk delete limits, backup settings
- **Dashboard** — admin port, host, TLS, session settings
- **Features** — active feature flags (tools_extended, tools_admin, semantic search)
- **Persistence** — data directory, metrics storage, session persistence

### Important Environment Variables

| Variable | Default | Description |
| -------- | ------- | ----------- |
| INDEX_SERVER_DIR | ./instructions | Instruction file directory |
| INDEX_SERVER_MUTATION | 0 | Enable write operations (add/remove/import) |
| INDEX_SERVER_DASHBOARD_PORT | 3001 | Dashboard HTTP port |
| INDEX_SERVER_DASHBOARD_TLS | 0 | Enable HTTPS for dashboard |
| INDEX_SERVER_VERBOSE_LOGGING | 0 | Verbose debug logging |
| INDEX_SERVER_DATA_DIR | ./data | Persistent data directory |
| INDEX_SERVER_BACKUPS_DIR | ./backups | Backup storage directory |
| INDEX_SERVER_AUTO_BACKUP | 1 | Enable periodic auto-backup |

### Feature Flags

Feature flags can be set via environment variables or `flags.json`:

- `INDEX_SERVER_FLAG_TOOLS_EXTENDED=1` — expose extended tool tier
- `INDEX_SERVER_FLAG_TOOLS_ADMIN=1` — expose admin tool tier
- `INDEX_SERVER_SEMANTIC_ENABLED=1` — enable semantic search mode

---

**Full reference:** See `docs/configuration.md` for complete environment variable documentation.
