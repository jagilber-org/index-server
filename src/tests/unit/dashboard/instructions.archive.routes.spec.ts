/**
 * Dashboard archive route tests — spec 006-archive-lifecycle Phase E3 (REQ-27).
 *
 * Exercises the five archive endpoints attached to the Instructions router:
 *   - GET    /api/instructions_archived
 *   - GET    /api/instructions_archived/:name
 *   - POST   /api/instructions/:name/archive
 *   - POST   /api/instructions_archived/:name/restore
 *   - DELETE /api/instructions_archived/:name
 *
 * Mounts the real router behind ensureLoadedMiddleware against a temp
 * INDEX_SERVER_DIR so each test has its own JSON-file store.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createInstructionsRoutes } from '../../../dashboard/server/routes/instructions.routes';
import { ensureLoadedMiddleware } from '../../../dashboard/server/middleware/ensureLoadedMiddleware';
import { invalidate } from '../../../services/indexContext';
import { readAuditEntries, resetAuditLogCache } from '../../../services/auditLog';
import { AUDIT_ACTIONS } from '../../../services/auditActions';
import { reloadRuntimeConfig } from '../../../config/runtimeConfig';

interface HttpResult { status: number; body: string }

function httpRequest(method: string, url: string, payload?: unknown): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const data = payload === undefined ? undefined : JSON.stringify(payload);
    const headers: Record<string, string | number> = {};
    if (data !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = http.request(url, { method, headers }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
    if (data !== undefined) req.write(data);
    req.end();
  });
}

function sourceHashFor(label: string): string {
  return crypto.createHash('sha256').update(label, 'utf8').digest('hex');
}

function writeInstruction(dir: string, id: string, overrides: Record<string, unknown> = {}): void {
  const entry = {
    id,
    title: `Title ${id}`,
    body: `Body for ${id}.`,
    priority: 50,
    audience: 'all',
    requirement: 'optional',
    categories: ['general'],
    contentType: 'instruction',
    sourceHash: sourceHashFor(id),
    schemaVersion: '7',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(entry, null, 2));
}

describe('dashboard archive routes', () => {
  const previousDir = process.env.INDEX_SERVER_DIR;
  const previousAuditPath = process.env.INDEX_SERVER_AUDIT_LOG;
  let tmpDir = '';
  let auditPath = '';
  let server: http.Server | undefined;
  let baseUrl = '';

  function readAuditActions(): string[] {
    return readAuditEntries().entries.map((e) => e.action);
  }

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-archive-routes-'));
    process.env.INDEX_SERVER_DIR = tmpDir;
    auditPath = path.join(tmpDir, 'audit.log');
    process.env.INDEX_SERVER_AUDIT_LOG = auditPath;
    reloadRuntimeConfig();
    resetAuditLogCache();
    invalidate();

    writeInstruction(tmpDir, 'alpha-active');
    writeInstruction(tmpDir, 'beta-active');

    const app = express();
    app.use(express.json());
    app.use(ensureLoadedMiddleware);
    app.use('/api', createInstructionsRoutes());

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = (server!.address() as { port: number }).port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    invalidate();
    resetAuditLogCache();
    await new Promise<void>((resolve, reject) => {
      if (!server) { resolve(); return; }
      server.close((err) => err ? reject(err) : resolve());
      server = undefined;
    });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  afterAll(() => {
    if (previousDir === undefined) delete process.env.INDEX_SERVER_DIR;
    else process.env.INDEX_SERVER_DIR = previousDir;
    if (previousAuditPath === undefined) delete process.env.INDEX_SERVER_AUDIT_LOG;
    else process.env.INDEX_SERVER_AUDIT_LOG = previousAuditPath;
    reloadRuntimeConfig();
    resetAuditLogCache();
  });

  it('GET /instructions_archived returns empty list when nothing is archived', async () => {
    const res = await httpRequest('GET', `${baseUrl}/api/instructions_archived`);
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body) as { success: boolean; instructions: unknown[]; count: number };
    expect(json.success).toBe(true);
    expect(json.count).toBe(0);
    expect(json.instructions).toEqual([]);
  });

  it('POST /instructions/:name/archive happy path; archived entry appears in list', async () => {
    const archiveRes = await httpRequest('POST', `${baseUrl}/api/instructions/alpha-active/archive`, {
      reason: 'manual',
      archivedBy: 'tester@example.com',
    });
    expect(archiveRes.status).toBe(200);
    const archiveJson = JSON.parse(archiveRes.body) as { success: boolean; entry: { id: string; archiveReason: string; archivedBy: string } };
    expect(archiveJson.success).toBe(true);
    expect(archiveJson.entry.id).toBe('alpha-active');
    expect(archiveJson.entry.archiveReason).toBe('manual');
    expect(archiveJson.entry.archivedBy).toBe('tester@example.com');

    const listRes = await httpRequest('GET', `${baseUrl}/api/instructions_archived`);
    const listJson = JSON.parse(listRes.body) as { count: number; instructions: Array<{ name: string; archiveReason: string }> };
    expect(listJson.count).toBe(1);
    expect(listJson.instructions[0].name).toBe('alpha-active');
    expect(listJson.instructions[0].archiveReason).toBe('manual');

    expect(readAuditActions()).toContain(AUDIT_ACTIONS.ARCHIVE);
  });

  it('POST /instructions/:name/archive rejects invalid reason', async () => {
    const res = await httpRequest('POST', `${baseUrl}/api/instructions/alpha-active/archive`, {
      reason: 'totally-not-a-reason',
    });
    expect(res.status).toBe(400);
    const json = JSON.parse(res.body) as { success: boolean; error: string };
    expect(json.success).toBe(false);
    expect(json.error).toBe('invalid_reason');
  });

  it('GET /instructions_archived/:name returns 404 for unknown and entry payload for known', async () => {
    const missing = await httpRequest('GET', `${baseUrl}/api/instructions_archived/does-not-exist`);
    expect(missing.status).toBe(404);

    await httpRequest('POST', `${baseUrl}/api/instructions/alpha-active/archive`, { reason: 'deprecated' });

    const found = await httpRequest('GET', `${baseUrl}/api/instructions_archived/alpha-active`);
    expect(found.status).toBe(200);
    const json = JSON.parse(found.body) as { success: boolean; archived: boolean; entry: { id: string; archiveReason: string } };
    expect(json.success).toBe(true);
    expect(json.archived).toBe(true);
    expect(json.entry.id).toBe('alpha-active');
    expect(json.entry.archiveReason).toBe('deprecated');
  });

  it('POST /instructions_archived/:name/restore rejects active collision by default; overwrite succeeds', async () => {
    await httpRequest('POST', `${baseUrl}/api/instructions/alpha-active/archive`, { reason: 'manual' });

    // Re-create an active copy with the same id (mimicking an id collision).
    writeInstruction(tmpDir, 'alpha-active', { title: 'Recreated alpha' });
    invalidate();

    const reject = await httpRequest('POST', `${baseUrl}/api/instructions_archived/alpha-active/restore`, {});
    expect(reject.status).toBe(409);

    const overwrite = await httpRequest('POST', `${baseUrl}/api/instructions_archived/alpha-active/restore`, { restoreMode: 'overwrite' });
    expect(overwrite.status).toBe(200);
    const okJson = JSON.parse(overwrite.body) as { success: boolean; restoreMode: string };
    expect(okJson.success).toBe(true);
    expect(okJson.restoreMode).toBe('overwrite');

    expect(readAuditActions()).toContain(AUDIT_ACTIONS.RESTORE);
  });

  it('POST /instructions_archived/:name/restore rejects unknown restoreMode', async () => {
    await httpRequest('POST', `${baseUrl}/api/instructions/alpha-active/archive`, { reason: 'manual' });

    const res = await httpRequest('POST', `${baseUrl}/api/instructions_archived/alpha-active/restore`, { restoreMode: 'bogus' });
    expect(res.status).toBe(400);
    const json = JSON.parse(res.body) as { error: string };
    expect(json.error).toBe('invalid_restoreMode');
  });

  it('POST /instructions_archived/:name/restore happy path; restored entry is active again', async () => {
    await httpRequest('POST', `${baseUrl}/api/instructions/alpha-active/archive`, { reason: 'manual' });
    const res = await httpRequest('POST', `${baseUrl}/api/instructions_archived/alpha-active/restore`, {});
    expect(res.status).toBe(200);

    // The active list should now contain alpha-active again.
    const activeRes = await httpRequest('GET', `${baseUrl}/api/instructions`);
    const activeJson = JSON.parse(activeRes.body) as { instructions: Array<{ name: string }> };
    expect(activeJson.instructions.some((e) => e.name === 'alpha-active')).toBe(true);
  });

  it('DELETE /instructions_archived/:name requires confirm=true and hard-purges otherwise', async () => {
    await httpRequest('POST', `${baseUrl}/api/instructions/alpha-active/archive`, { reason: 'manual' });

    const withoutConfirm = await httpRequest('DELETE', `${baseUrl}/api/instructions_archived/alpha-active`);
    expect(withoutConfirm.status).toBe(400);
    const noConfirmJson = JSON.parse(withoutConfirm.body) as { error: string };
    expect(noConfirmJson.error).toBe('confirm_required');

    // Entry must still be archived.
    const stillArchived = await httpRequest('GET', `${baseUrl}/api/instructions_archived/alpha-active`);
    expect(stillArchived.status).toBe(200);

    const withConfirm = await httpRequest('DELETE', `${baseUrl}/api/instructions_archived/alpha-active?confirm=true`);
    expect(withConfirm.status).toBe(200);

    const gone = await httpRequest('GET', `${baseUrl}/api/instructions_archived/alpha-active`);
    expect(gone.status).toBe(404);

    expect(readAuditActions()).toContain(AUDIT_ACTIONS.PURGE);
  });

  it('emits archive + restore + purge audit entries across the full lifecycle', async () => {
    await httpRequest('POST', `${baseUrl}/api/instructions/alpha-active/archive`, { reason: 'manual' });
    await httpRequest('POST', `${baseUrl}/api/instructions_archived/alpha-active/restore`, {});
    await httpRequest('POST', `${baseUrl}/api/instructions/alpha-active/archive`, { reason: 'manual' });
    await httpRequest('DELETE', `${baseUrl}/api/instructions_archived/alpha-active?confirm=true`);

    const actions = readAuditActions();
    expect(actions).toContain(AUDIT_ACTIONS.ARCHIVE);
    expect(actions).toContain(AUDIT_ACTIONS.RESTORE);
    expect(actions).toContain(AUDIT_ACTIONS.PURGE);
  });
});
