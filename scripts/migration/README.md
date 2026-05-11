# scripts/migration

One-time data migration scripts. These are kept for history and reproducibility
but are **not** part of the normal build or CI pipeline. Each script targets a
specific migration event (schema version bump, field rename, content-type adoption).

## Scripts

| Script | Event | Purpose |
|--------|-------|---------|
| `add-contenttype-prod.ps1` | Content-type adoption | Backfill `contentType` field on production instructions |
| `migrate-manifest-schema.ps1` | Manifest v2 | Migrate `manifest.json` to the v2 schema shape |
| `normalize-instructions.js` | Normalization | Normalize legacy instruction files to current schema |
| `prepare-minimal-instructions.mjs` | Clean-room prep | Strip non-essential fields before publishing a minimal set |
| `purge-instructions.ps1` | Purge | Remove a batch of instructions by ID pattern from production |
| `rename-server-in-instructions.ps1` | Field rename | Rename `server` → `source` across all instruction JSON files |
| `restore-instructions.ps1` | Recovery | Restore instruction files from a backup export |
| `test-contenttype-migration.ps1` | Verification | Dry-run the content-type migration and report what would change |

## Rules

- **Run once, then archive.** Once a migration is applied to production, the script
  should not be run again. Comment the date and SHA at the top when you apply it.
- **Test first.** Run against the dev sandbox (`-Profile json -DryRun`) before
  applying to production.
- **Never delete.** Keep all migration scripts in git history; they document what
  changed and when.
