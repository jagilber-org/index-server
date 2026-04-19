/**
 * Audit logging extension tests (TDD red → green).
 * Validates:
 * 1. logAudit accepts and persists a `kind` field (mutation | read | http)
 * 2. Existing mutation entries default to kind='mutation'
 * 3. readAuditEntries returns the kind field
 * 4. logToolAudit helper correctly logs tool invocations with kind='read'|'mutation'
 * 5. logHttpAudit helper logs HTTP requests with kind='http' + clientIp
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
    // Clear the file before each test
    if (fs.existsSync(auditFile)) fs.writeFileSync(auditFile, ''); // lgtm[js/file-system-race]
    // Dynamic import to pick up env
    mod = await import('../../services/auditLog.js');
    mod.resetAuditLogCache();
  });

  afterEach(() => {
    mod.resetAuditLogCache();
  });

  it('logAudit with kind="mutation" persists the kind field', () => {
    mod.logAudit('index_add', ['test-id'], { created: true }, 'mutation');
    const entries = mod.readAuditEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].kind).toBe('mutation');
    expect(entries[0].action).toBe('index_add');
    expect(entries[0].ids).toEqual(['test-id']);
  });

  it('logAudit without kind defaults to "mutation" for backward compat', () => {
    mod.logAudit('index_remove', ['id-1']);
    const entries = mod.readAuditEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].kind).toBe('mutation');
  });

  it('logAudit with kind="read" persists read entries', () => {
    mod.logAudit('index_search', undefined, { keywords: ['test'] }, 'read');
    const entries = mod.readAuditEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].kind).toBe('read');
    expect(entries[0].action).toBe('index_search');
  });

  it('logAudit with kind="http" persists HTTP access entries', () => {
    mod.logAudit('GET /api/status', undefined, { clientIp: '127.0.0.1', statusCode: 200 }, 'http');
    const entries = mod.readAuditEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].kind).toBe('http');
    expect(entries[0].meta?.clientIp).toBe('127.0.0.1');
  });

  it('all entries include ISO timestamp', () => {
    mod.logAudit('test-action', undefined, undefined, 'read');
    const entries = mod.readAuditEntries();
    expect(entries[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('logToolAudit produces correct entry for mutation tool', () => {
    mod.logToolAudit('index_add', true, 12.5, 'corr-123');
    const entries = mod.readAuditEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].kind).toBe('mutation');
    expect(entries[0].action).toBe('index_add');
    expect(entries[0].meta?.correlationId).toBe('corr-123');
    expect(entries[0].meta?.durationMs).toBe(12.5);
    expect(entries[0].meta?.success).toBe(true);
  });

  it('logToolAudit produces kind="read" for non-mutation tool', () => {
    mod.logToolAudit('index_search', true, 3.2, 'corr-456');
    const entries = mod.readAuditEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].kind).toBe('read');
    expect(entries[0].action).toBe('index_search');
  });

  it('logToolAudit records failure', () => {
    mod.logToolAudit('index_add', false, 5.0, 'corr-fail', 'validation_error');
    const entries = mod.readAuditEntries();
    expect(entries[0].meta?.success).toBe(false);
    expect(entries[0].meta?.errorType).toBe('validation_error');
  });

  it('logHttpAudit produces kind="http" with IP and route', () => {
    mod.logHttpAudit('GET', '/api/status', 200, 4.1, '192.168.1.5');
    const entries = mod.readAuditEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].kind).toBe('http');
    expect(entries[0].action).toBe('GET /api/status');
    expect(entries[0].meta?.clientIp).toBe('192.168.1.5');
    expect(entries[0].meta?.statusCode).toBe(200);
    expect(entries[0].meta?.durationMs).toBe(4.1);
  });

  it('readAuditEntries respects limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      mod.logAudit(`action-${i}`, undefined, undefined, 'read');
    }
    const entries = mod.readAuditEntries(3);
    expect(entries.length).toBe(3);
    // Should return the LAST 3 entries
    expect(entries[0].action).toBe('action-2');
  });
});
