/**
 * Centralized audit action name constants.
 *
 * Phase E1 of spec 006-archive-lifecycle introduces this module to replace
 * inline string literals at audit emission sites for the archive lifecycle.
 * Callers should import the constants below rather than passing raw strings
 * to {@link logAudit}; the {@link ArchiveAuditAction} union enables TS to
 * flag typos in switch / equality checks downstream.
 *
 * Existing pre-Phase-D audit actions (e.g. `remove`, `remove_blocked`,
 * `remove_backup`, `remove_backup_failed`, `groom`, `governanceUpdate`, …)
 * remain inline strings for now; this module focuses on the archive
 * lifecycle additions and the `remove`-default transition warning.
 */

export const AUDIT_ACTIONS = {
  /** Entry archived (from `index_archive`, `index_remove` mode='archive', or `index_groom` retirement). */
  ARCHIVE: 'archive',
  /** Archived entry restored to the active surface (`index_restore`). */
  RESTORE: 'restore',
  /** Archived entry permanently purged (`index_purgeArchive`, `index_groom` mode.purgeArchive, `index_remove` mode='purge'). */
  PURGE: 'purge',
  /** Bootstrap mutation-gate or bulk-limit denied a purge attempt. */
  PURGE_BLOCKED: 'purge_blocked',
  /** Pre-purge automatic zip backup of the instructions directory. */
  PURGE_BACKUP: 'purge_backup',
  /** Pre-purge automatic backup failed; downstream purge aborted. */
  PURGE_BACKUP_FAILED: 'purge_backup_failed',
  /** `index_remove` invoked without explicit `mode`; informational only this release. */
  REMOVE_DEFAULT_CHANGE_WARNING: 'remove_default_change_warning',
} as const;

export type ArchiveAuditAction = typeof AUDIT_ACTIONS[keyof typeof AUDIT_ACTIONS];

/** Frozen list of all archive-lifecycle audit action names (for iteration / assertions). */
export const ARCHIVE_AUDIT_ACTIONS: readonly ArchiveAuditAction[] = Object.freeze([
  AUDIT_ACTIONS.ARCHIVE,
  AUDIT_ACTIONS.RESTORE,
  AUDIT_ACTIONS.PURGE,
  AUDIT_ACTIONS.PURGE_BLOCKED,
  AUDIT_ACTIONS.PURGE_BACKUP,
  AUDIT_ACTIONS.PURGE_BACKUP_FAILED,
  AUDIT_ACTIONS.REMOVE_DEFAULT_CHANGE_WARNING,
]);
