import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const logAudit = vi.fn();
const logError = vi.fn();
const logInfo = vi.fn();

vi.mock('../../services/auditLog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/auditLog')>();
  return {
    ...actual,
    logAudit,
  };
});
vi.mock('../../services/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/logger')>();
  return {
    ...actual,
    logError,
    logInfo,
    logWarn: vi.fn(),
  };
});

type Handler = (params: Record<string, unknown>) => Promise<unknown> | unknown;

async function loadHandlers(feedbackDir: string) {
  process.env.INDEX_SERVER_FEEDBACK_DIR = feedbackDir;
  process.env.INDEX_SERVER_FEEDBACK_MAX_ENTRIES = '100';
  const runtimeConfig = await import('../../config/runtimeConfig.js');
  runtimeConfig.reloadRuntimeConfig();
  await import('../../services/handlers.feedback.js');
  const registry = await import('../../server/registry.js');
  return {
    manage: registry.getHandler('feedback_manage') as Handler,
    submit: registry.getHandler('feedback_submit') as Handler,
    reloadRuntimeConfig: runtimeConfig.reloadRuntimeConfig,
  };
}

describe('feedback_manage', () => {
  let tmpDir: string;
  const originalFeedbackDir = process.env.INDEX_SERVER_FEEDBACK_DIR;
  const originalMaxEntries = process.env.INDEX_SERVER_FEEDBACK_MAX_ENTRIES;

  beforeEach(() => {
    vi.resetModules();
    logAudit.mockReset();
    logError.mockReset();
    logInfo.mockReset();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-manage-test-'));
  });

  afterEach(async () => {
    if (originalFeedbackDir === undefined) delete process.env.INDEX_SERVER_FEEDBACK_DIR;
    else process.env.INDEX_SERVER_FEEDBACK_DIR = originalFeedbackDir;
    if (originalMaxEntries === undefined) delete process.env.INDEX_SERVER_FEEDBACK_MAX_ENTRIES;
    else process.env.INDEX_SERVER_FEEDBACK_MAX_ENTRIES = originalMaxEntries;
    const runtimeConfig = await import('../../config/runtimeConfig.js');
    runtimeConfig.reloadRuntimeConfig();
    vi.doUnmock('../../services/feedbackStorage');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('supports submit, list, get, update, delete, and stats actions', async () => {
    const { manage } = await loadHandlers(path.join(tmpDir, 'feedback'));

    const first = await manage({
      action: 'submit',
      type: 'issue',
      severity: 'low',
      title: 'First feedback',
      description: 'First description',
      tags: ['alpha', 'beta'],
    }) as Record<string, unknown>;
    const second = await manage({
      action: 'submit',
      type: 'bug-report',
      severity: 'high',
      title: 'Second feedback',
      description: 'Second description',
      tags: ['beta'],
    }) as Record<string, unknown>;

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    const firstId = first.feedbackId as string;
    const secondId = second.feedbackId as string;

    const list = await manage({ action: 'list', tags: ['beta'], limit: 10 }) as Record<string, unknown>;
    expect(list).toMatchObject({ action: 'list', success: true, total: 2, hasMore: false });
    expect((list.entries as Array<{ id: string }>).map(entry => entry.id).sort()).toEqual([firstId, secondId].sort());

    const get = await manage({ action: 'get', id: firstId }) as Record<string, unknown>;
    expect(get).toMatchObject({
      action: 'get',
      success: true,
      entry: expect.objectContaining({ id: firstId, title: 'First feedback' }),
    });

    const update = await manage({
      action: 'update',
      id: firstId,
      status: 'resolved',
      severity: 'medium',
      title: 'Updated feedback',
      description: 'Updated description',
      tags: ['updated'],
      metadata: { triagedBy: 'unit-test' },
    }) as Record<string, unknown>;
    expect(update).toMatchObject({
      action: 'update',
      success: true,
      entry: expect.objectContaining({
        id: firstId,
        status: 'resolved',
        severity: 'medium',
        title: 'Updated feedback',
        description: 'Updated description',
        tags: ['updated'],
        metadata: { triagedBy: 'unit-test' },
      }),
    });

    const stats = await manage({ action: 'stats' }) as Record<string, unknown>;
    expect(stats).toMatchObject({
      action: 'stats',
      success: true,
      stats: expect.objectContaining({
        total: 2,
        byType: expect.objectContaining({ issue: 1, 'bug-report': 1 }),
        bySeverity: expect.objectContaining({ medium: 1, high: 1 }),
        byStatus: expect.objectContaining({ resolved: 1, new: 1 }),
      }),
    });

    const deleted = await manage({ action: 'delete', id: secondId }) as Record<string, unknown>;
    expect(deleted).toMatchObject({ action: 'delete', success: true, deleted: true, id: secondId });

    const afterDelete = await manage({ action: 'get', id: secondId }) as Record<string, unknown>;
    expect(afterDelete).toMatchObject({ action: 'get', success: false, error: 'not_found', id: secondId });
  });

  it('returns structured missing_required and invalid_param envelopes', async () => {
    const { manage } = await loadHandlers(path.join(tmpDir, 'feedback'));

    await expect(manage({ action: 'get' })).resolves.toMatchObject({
      action: 'get',
      success: false,
      error: 'missing_required',
      message: 'Missing required parameter: id',
    });
    await expect(manage({ action: 'submit', type: 'issue', severity: 'low', title: 'Missing description' })).resolves.toMatchObject({
      action: 'submit',
      success: false,
      error: 'missing_required',
    });
    await expect(manage({ action: 'list', limit: 999 })).resolves.toMatchObject({
      action: 'list',
      success: false,
      error: 'invalid_param',
    });
    await expect(manage({ action: 'health' })).resolves.toMatchObject({
      action: 'health',
      success: false,
      error: 'invalid_param',
    });
  });

  it('returns storage_error envelopes without leaking raw storage errors', async () => {
    const rawMessage = "EACCES: permission denied, open 'C:\\secret\\feedback-entries.json'";
    vi.doMock('../../services/feedbackStorage', () => ({
      getMaxEntries: () => 100,
      loadFeedbackStorage: vi.fn(() => { throw new Error(rawMessage); }),
      saveFeedbackStorage: vi.fn(),
      generateFeedbackId: () => 'mock-feedback-id',
    }));
    const { manage } = await loadHandlers(path.join(tmpDir, 'feedback'));

    const result = await manage({ action: 'list' }) as Record<string, unknown>;

    expect(result).toMatchObject({
      action: 'list',
      success: false,
      error: 'storage_error',
    });
    expect(String(result.message)).not.toContain('C:\\secret');
    expect(String(result.message)).not.toContain('EACCES');
    expect(logError).toHaveBeenCalledWith(
      '[feedback] feedback_manage storage load failure',
      expect.any(Error),
    );
    expect(logAudit).toHaveBeenCalledWith(
      'feedback_manage_storage_error',
      undefined,
      { action: 'list' },
      'feedback',
    );
  });

  it('feedback_submit logs and audits storage failures while returning a generic thrown error', async () => {
    const rawMessage = "EACCES: permission denied, open 'C:\\secret\\feedback-entries.json'";
    vi.doMock('../../services/feedbackStorage', () => ({
      getMaxEntries: () => 100,
      loadFeedbackStorage: vi.fn(() => ({ entries: [], lastUpdated: '2026-01-01T00:00:00.000Z', version: '1.0.0' })),
      saveFeedbackStorage: vi.fn(() => { throw new Error(rawMessage); }),
      generateFeedbackId: () => 'mock-feedback-id',
    }));
    const { submit } = await loadHandlers(path.join(tmpDir, 'feedback'));

    await expect(submit({
      type: 'issue',
      severity: 'low',
      title: 'Storage failure',
      description: 'Should not leak raw errors',
    })).rejects.toThrow('Feedback submit failed due to a storage error. The error details are not exposed to clients.');

    await expect(submit({
      type: 'issue',
      severity: 'low',
      title: 'Storage failure',
      description: 'Should not leak raw errors',
    })).rejects.not.toThrow(/C:\\secret|EACCES/);
    expect(logError).toHaveBeenCalledWith(
      '[feedback] feedback_submit storage failure',
      expect.any(Error),
    );
    expect(logAudit).toHaveBeenCalledWith(
      'feedback_submit_storage_error',
      undefined,
      {},
      'feedback',
    );
  });
});
