# Maintenance Panel

The Maintenance panel provides system operations and backup/restore controls.

## Maintenance Control

Displays the current maintenance mode status. When maintenance mode is active, the server returns a maintenance response to incoming MCP requests.

## System Operations

### Quick Actions

- **Create Backup** — creates a timestamped backup of all instruction files to the backups directory
- **Clear Caches** — flushes in-memory caches (manifest, stats, Index). the index reloads on next request.
- **Restart Server** — gracefully restarts the server process

### Backup Management

- **Backup to File** — exports the selected backup as a downloadable JSON file
- **Restore from File** — imports a backup from a previously exported JSON file

### Restore Backup

Select a backup snapshot from the dropdown and click Restore to replace the current instruction index with the backup contents.

### Backup Types

| Type | Created By | Location |
| ---- | ---------- | -------- |
| Auto-backup | Periodic timer | backups/auto-backup-YYYYMMDD-HHMMSS/ |
| Deploy backup | deploy-local.ps1 | backups/instructions-YYYYMMDD-HHMMSS/ |
| Rename backup | rename-server-in-instructions.ps1 | backup-{dir}-YYYYMMDD-HHMMSS.zip |
| Bulk delete | index_remove (force) | backups/pre-delete-YYYYMMDD-HHMMSS/ |

### Backup Environment Variables

| Variable | Default | Description |
| -------- | ------- | ----------- |
| INDEX_SERVER_BACKUPS_DIR | ./backups | Backup storage directory |
| INDEX_SERVER_AUTO_BACKUP | 1 | Enable periodic auto-backup |
| INDEX_SERVER_AUTO_BACKUP_INTERVAL_MS | 3600000 | Backup interval (default 1 hour) |
| INDEX_SERVER_AUTO_BACKUP_MAX_COUNT | 10 | Maximum retained auto-backups |
| INDEX_SERVER_BACKUP_BEFORE_BULK_DELETE | 1 | Auto-backup before forced bulk deletes |

### CLI Restore

```powershell
# Restore latest backup
pwsh scripts/restore-instructions.ps1 -Destination <production-install-root>

# Restore from specific zip
pwsh scripts/restore-instructions.ps1 -BackupPath path/to/backup.zip -Force
```

---

**Related docs:** See `docs/configuration.md` for full backup configuration reference.
