/**
 * Audit logging extension tests.
 * Validates:
 * 1. logAudit accepts and persists a `kind` field (mutation | read | http | feedback)
 * 2. Existing mutation entries default to kind='mutation'
 * 3. readAuditEntries returns the kind field and parseErrors metadata
 * 4. logToolAudit helper correctly logs tool invocations with kind='read'|'mutation'
 * 5. logHttpAudit helper logs HTTP requests with kind='http' + clientIp
 * 6. audit log write failures are surfaced via counters, stderr, and health_check
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// We set env BEFORE importing the module under test so runtimeConfig sees them.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-log-test-'));
const auditFile = path.join(tmpDir, 'audit.log.jsonl');

// Pre-set env to enable audit logging
process.env.INDEX_SERVER_AUDIT_LOG = auditFile;

describe('auditLog extension', () => {
  let mod: typeof import('../../services/auditLog');

  beforeEach(async () => {
    if (fs.existsSync(auditFile)) {
      fs.writeFileSync(auditFile, '', 'utf8'); // lgtm[js/file-system-race]
    } else {
      fs.mkdirSync(path.dirname(auditFile), { recursive: true });
    }
    mod = await import('../../services/auditLog.js');
    mod.resetAuditLogCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mod.resetAuditLogCache();
    if (fs.existsSync(auditFile)) fs.writeFileSync(auditFile, '', 'utf8'); // lgtm[js/file-system-race]
  });

  it('logAudit with kind="mutation" persists the kind field', () => {
    mod.logAudit('index_add', ['test-id'], { created: true }, 'mutation');
    const result = mod.readAuditEntries();
    expect(result.parseErrors).toBe(0);
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].kind).toBe('mutation');
    expect(result.entries[0].action).toBe('index_add');
    expect(result.entries[0].ids).toEqual(['test-id']);
  });

  it('logAudit without kind defaults to "mutation" for backward compat', () => {
    mod.logAudit('index_remove', ['id-1']);
    const result = mod.readAuditEntries();
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].kind).toBe('mutation');
  });

  it('logAudit with kind="read" persists read entries', () => {
    mod.logAudit('index_search', undefined, { keywords: ['test'] }, 'read');
    const result = mod.readAuditEntries();
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].kind).toBe('read');
    expect(result.entries[0].action).toBe('index_search');
  });

  it('logAudit with kind="http" persists HTTP access entries', () => {
    mod.logAudit('GET /api/status', undefined, { clientIp: '127.0.0.1', statusCode: 200 }, 'http');
    const result = mod.readAuditEntries();
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].kind).toBe('http');
    expect(result.entries[0].meta?.clientIp).toBe('127.0.0.1');
  });

  it('logAudit with kind="feedback" persists feedback entries', () => {
    mod.logAudit('feedback_submit', ['feedback-1'], { severity: 'low' }, 'feedback');
    const result = mod.readAuditEntries();
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].kind).toBe('feedback');
    expect(result.entries[0].action).toBe('feedback_submit');
  });

  it('all entries include ISO timestamp', () => {
    mod.logAudit('test-action', undefined, undefined, 'read');
    const result = mod.readAuditEntries();
    expect(result.entries[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('logToolAudit produces correct entry for mutation tool', () => {
    mod.logToolAudit('index_add', true, 12.5, 'corr-123');
    const result = mod.readAuditEntries();
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].kind).toBe('mutation');
    expect(result.entries[0].action).toBe('index_add');
    expect(result.entries[0].meta?.correlationId).toBe('corr-123');
    expect(result.entries[0].meta?.durationMs).toBe(12.5);
    expect(result.entries[0].meta?.success).toBe(true);
  });

  it('logToolAudit produces kind="read" for non-mutation tool', () => {
    mod.logToolAudit('index_search', true, 3.2, 'corr-456');
    const result = mod.readAuditEntries();
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].kind).toBe('read');
    expect(result.entries[0].action).toBe('index_search');
  });

  it('logToolAudit records failure', () => {
    mod.logToolAudit('index_add', false, 5.0, 'corr-fail', 'validation_error');
    const result = mod.readAuditEntries();
    expect(result.entries[0].meta?.success).toBe(false);
    expect(result.entries[0].meta?.errorType).toBe('validation_error');
  });

  it('logHttpAudit produces kind="http" with IP and route', () => {
    mod.logHttpAudit('GET', '/api/status', 200, 4.1, '192.168.1.5');
    const result = mod.readAuditEntries();
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].kind).toBe('http');
    expect(result.entries[0].action).toBe('GET /api/status');
    expect(result.entries[0].meta?.clientIp).toBe('192.168.1.5');
    expect(result.entries[0].meta?.statusCode).toBe(200);
    expect(result.entries[0].meta?.durationMs).toBe(4.1);
  });

  it('readAuditEntries respects limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      mod.logAudit(`action-${i}`, undefined, undefined, 'read');
    }
    const result = mod.readAuditEntries(3);
    expect(result.entries.length).toBe(3);
    expect(result.parseErrors).toBe(0);
    expect(result.entries[0].action).toBe('action-2');
  });

  it('surfaces repeated write failures once and retries after persistence recovers', () => {
    mod.logAudit('before-failure', undefined, { seq: 1 }, 'read');

    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const appendSpy = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
      throw new Error('EACCES');
    });

    mod.logAudit('during-failure-1', undefined, { seq: 2 }, 'read');
    mod.logAudit('during-failure-2', undefined, { seq: 3 }, 'read');

    const degradedHealth = mod.getAuditLogHealth();
    expect(degradedHealth.writeFailures).toBe(2);
    expect(degradedHealth.degraded).toBe(true);
    expect(degradedHealth.lastWriteError).toBe('EACCES');
    expect(stderrSpy).toHaveBeenCalledTimes(1);

    appendSpy.mockRestore();

    mod.logAudit('after-recovery', undefined, { seq: 4 }, 'read');

    const result = mod.readAuditEntries();
    expect(result.entries.map(entry => entry.action)).toEqual(['before-failure', 'after-recovery']);
    expect(mod.getAuditLogHealth().lastWriteError).toBeUndefined();
  });

  it('retries after initial path resolution failure instead of disabling audit logging permanently', () => {
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const appendSpy = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
      throw new Error('disk full');
    });

    mod.logAudit('initial-attempt', undefined, { seq: 1 }, 'read');

    expect(mod.getAuditLogHealth().writeFailures).toBe(1);
    expect(mod.getAuditLogHealth().lastWriteError).toBe('disk full');
    expect(stderrSpy).toHaveBeenCalledTimes(1);

    appendSpy.mockRestore();

    mod.logAudit('retry-after-recovery', undefined, { seq: 2 }, 'read');

    const result = mod.readAuditEntries();
    expect(result.entries.map(entry => entry.action)).toEqual(['retry-after-recovery']);
    expect(mod.getAuditLogHealth().lastWriteError).toBeUndefined();
  });

  it('returns parseErrors for corrupted lines and exposes audit degradation in health_check', async () => {
    const validEntry = {
      ts: new Date().toISOString(),
      kind: 'read',
      action: 'healthy-entry',
    };
    fs.writeFileSync(auditFile, `${JSON.stringify(validEntry)}\n{bad json\n`, 'utf8');

    const result = mod.readAuditEntries();
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].action).toBe('healthy-entry');
    expect(result.parseErrors).toBe(1);

    await import('../../services/handlers.metrics.js');
    const { getLocalHandler } = await import('../../server/registry.js');
    const healthHandler = getLocalHandler('health_check');
    expect(healthHandler).toBeDefined();

    const healthResult = await healthHandler?.({});
    const audit = (healthResult as { audit?: { parseErrors?: number; degraded?: boolean } }).audit;
    expect(audit).toBeDefined();
    expect(audit?.parseErrors).toBe(1);
    expect(audit?.degraded).toBe(true);
  });
});
