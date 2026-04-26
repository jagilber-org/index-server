import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('feedbackStorage', () => {
  let tmpDir: string;
  let feedbackDir: string;
  let runtimeConfig: typeof import('../../config/runtimeConfig.js');
  let feedbackStorage: typeof import('../../services/feedbackStorage.js');
  const originalFeedbackDir = process.env.INDEX_SERVER_FEEDBACK_DIR;
  const originalMaxEntries = process.env.INDEX_SERVER_FEEDBACK_MAX_ENTRIES;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-storage-test-'));
    feedbackDir = path.join(tmpDir, 'feedback');
    process.env.INDEX_SERVER_FEEDBACK_DIR = feedbackDir;
    process.env.INDEX_SERVER_FEEDBACK_MAX_ENTRIES = '1';
    runtimeConfig = await import('../../config/runtimeConfig.js');
    runtimeConfig.reloadRuntimeConfig();
    feedbackStorage = await import('../../services/feedbackStorage.js');
  });

  afterEach(() => {
    if (originalFeedbackDir === undefined) delete process.env.INDEX_SERVER_FEEDBACK_DIR;
    else process.env.INDEX_SERVER_FEEDBACK_DIR = originalFeedbackDir;

    if (originalMaxEntries === undefined) delete process.env.INDEX_SERVER_FEEDBACK_MAX_ENTRIES;
    else process.env.INDEX_SERVER_FEEDBACK_MAX_ENTRIES = originalMaxEntries;

    runtimeConfig.reloadRuntimeConfig();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saveFeedbackStorage persists a trimmed copy without mutating the caller storage object', () => {
    const storage: import('../../services/feedbackStorage.js').FeedbackStorage = {
      entries: [
        {
          id: 'older',
          timestamp: '2026-01-01T00:00:00.000Z',
          type: 'issue',
          severity: 'low',
          title: 'Older',
          description: 'Older entry',
          status: 'new',
        },
        {
          id: 'newer',
          timestamp: '2026-01-02T00:00:00.000Z',
          type: 'issue',
          severity: 'high',
          title: 'Newer',
          description: 'Newer entry',
          status: 'acknowledged',
        },
      ],
      lastUpdated: '2026-01-01T00:00:00.000Z',
      version: '1.0.0',
    };

    feedbackStorage.saveFeedbackStorage(storage);

    expect(storage.entries.map(entry => entry.id)).toEqual(['older', 'newer']);
    expect(storage.lastUpdated).toBe('2026-01-01T00:00:00.000Z');

    const saved = feedbackStorage.loadFeedbackStorage();
    expect(saved.entries.map(entry => entry.id)).toEqual(['newer']);
    expect(saved.lastUpdated).not.toBe(storage.lastUpdated);
  });
});
