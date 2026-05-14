/**
 * Phase E1 (spec 006-archive-lifecycle) — audit action constants tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { AUDIT_ACTIONS, ARCHIVE_AUDIT_ACTIONS, ArchiveAuditAction } from '../../../services/auditActions';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-audit-actions-'));
const auditFile = path.join(tmpDir, 'audit.log.jsonl');
process.env.INDEX_SERVER_AUDIT_LOG = auditFile;

describe('auditActions — archive lifecycle constants', () => {
  it('exposes each new audit action with the expected literal value', () => {
    expect(AUDIT_ACTIONS.ARCHIVE).toBe('archive');
    expect(AUDIT_ACTIONS.RESTORE).toBe('restore');
    expect(AUDIT_ACTIONS.PURGE).toBe('purge');
    expect(AUDIT_ACTIONS.PURGE_BLOCKED).toBe('purge_blocked');
    expect(AUDIT_ACTIONS.PURGE_BACKUP).toBe('purge_backup');
    expect(AUDIT_ACTIONS.PURGE_BACKUP_FAILED).toBe('purge_backup_failed');
    expect(AUDIT_ACTIONS.REMOVE_DEFAULT_CHANGE_WARNING).toBe('remove_default_change_warning');
  });

  it('ARCHIVE_AUDIT_ACTIONS lists every constant exactly once', () => {
    expect([...ARCHIVE_AUDIT_ACTIONS].sort()).toEqual([
      'archive',
      'purge',
      'purge_backup',
      'purge_backup_failed',
      'purge_blocked',
      'remove_default_change_warning',
      'restore',
    ]);
    expect(Object.isFrozen(ARCHIVE_AUDIT_ACTIONS)).toBe(true);
  });

  it('ArchiveAuditAction union narrows literal assignments (type-level)', () => {
    const a: ArchiveAuditAction = AUDIT_ACTIONS.ARCHIVE;
    const r: ArchiveAuditAction = AUDIT_ACTIONS.RESTORE;
    const p: ArchiveAuditAction = AUDIT_ACTIONS.PURGE;
    expect([a, r, p]).toEqual(['archive', 'restore', 'purge']);
    // @ts-expect-error — unknown action must not be assignable.
    const bad: ArchiveAuditAction = 'definitely-not-an-archive-action';
    void bad;
  });
});

describe('auditActions — emission through logAudit', () => {
  let mod: typeof import('../../../services/auditLog');

  beforeEach(async () => {
    if (fs.existsSync(auditFile)) {
      fs.writeFileSync(auditFile, '', 'utf8'); // lgtm[js/file-system-race]
    } else {
      fs.mkdirSync(path.dirname(auditFile), { recursive: true });
    }
    mod = await import('../../../services/auditLog.js');
    mod.resetAuditLogCache();
  });

  afterEach(() => {
    mod.resetAuditLogCache();
    if (fs.existsSync(auditFile)) fs.writeFileSync(auditFile, '', 'utf8'); // lgtm[js/file-system-race]
  });

  it('writes each archive lifecycle action under its canonical name', () => {
    for (const action of ARCHIVE_AUDIT_ACTIONS) {
      mod.logAudit(action, ['inst-1'], { test: true }, 'mutation');
    }
    const result = mod.readAuditEntries();
    expect(result.parseErrors).toBe(0);
    expect(result.entries.map(e => e.action)).toEqual([...ARCHIVE_AUDIT_ACTIONS]);
    for (const entry of result.entries) {
      expect(entry.kind).toBe('mutation');
      expect(entry.ids).toEqual(['inst-1']);
    }
  });
});
