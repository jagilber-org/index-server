/**
 * Usage persistence adapter — backend routing.
 *
 * With storage.backend = 'sqlite', usage counters must persist to the `usage`
 * table in the instruction DB rather than to data/usage-snapshot.json. That is
 * what makes SQLite self-contained: previously the snapshot file remained the
 * authority regardless of backend, so a SQLite deployment kept its counters in
 * a file that nothing in the SQLite path ever read or migrated.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SqliteUsageStore } from '../../../services/storage/sqliteUsageStore.js';
import { reloadRuntimeConfig } from '../../../config/runtimeConfig.js';

const ENV_KEYS = [
  'INDEX_SERVER_STORAGE_BACKEND',
  'INDEX_SERVER_SQLITE_PATH',
  'INDEX_SERVER_USAGE_SNAPSHOT_PATH',
] as const;

describe('usage persistence — backend routing', () => {
  let tmpDir: string;
  let dbPath: string;
  let snapPath: string;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-persist-'));
    dbPath = path.join(tmpDir, 'index.db');
    snapPath = path.join(tmpDir, 'usage-snapshot.json');
    saved = {};
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.INDEX_SERVER_USAGE_SNAPSHOT_PATH = snapPath;
  });

  afterEach(async () => {
    const { closeUsagePersistence } = await import('../../../services/usagePersistence.js');
    closeUsagePersistence();
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    reloadRuntimeConfig();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes counters to the SQLite usage table (not the snapshot file) when backend=sqlite', async () => {
    process.env.INDEX_SERVER_STORAGE_BACKEND = 'sqlite';
    process.env.INDEX_SERVER_SQLITE_PATH = dbPath;
    reloadRuntimeConfig();

    const { readPersistedUsage, writePersistedUsage, closeUsagePersistence } =
      await import('../../../services/usagePersistence.js');

    writePersistedUsage({
      alpha: {
        usageCount: 9,
        retrievedCount: 6,
        appliedCount: 3,
        firstSeenTs: '2026-01-01T00:00:00.000Z',
        lastUsedAt: '2026-04-04T00:00:00.000Z',
        lastRetrievedAt: '2026-04-01T00:00:00.000Z',
        lastAppliedAt: '2026-04-04T00:00:00.000Z',
        lastAction: 'get',
      },
    });

    // Round-trips through the adapter, split intact.
    const back = readPersistedUsage();
    expect(back.alpha.retrievedCount).toBe(6);
    expect(back.alpha.appliedCount).toBe(3);
    expect(back.alpha.lastAppliedAt).toBe('2026-04-04T00:00:00.000Z');
    expect(back.alpha.lastAction).toBe('get');

    closeUsagePersistence();

    // It really landed in the DB, and NOT in the snapshot file.
    const store = new SqliteUsageStore(dbPath);
    const row = store.get('alpha')!;
    store.close();
    expect(row.retrievedCount).toBe(6);
    expect(row.appliedCount).toBe(3);
    expect(fs.existsSync(snapPath)).toBe(false);
  });

  it('still writes the snapshot file when backend=json', async () => {
    process.env.INDEX_SERVER_STORAGE_BACKEND = 'json';
    delete process.env.INDEX_SERVER_SQLITE_PATH;
    reloadRuntimeConfig();

    const { readPersistedUsage, writePersistedUsage } =
      await import('../../../services/usagePersistence.js');

    writePersistedUsage({ beta: { usageCount: 2, retrievedCount: 1, appliedCount: 1 } });

    expect(fs.existsSync(snapPath)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(snapPath, 'utf8')) as Record<string, Record<string, unknown>>;
    expect(onDisk.beta.retrievedCount).toBe(1);
    expect(readPersistedUsage().beta.appliedCount).toBe(1);
  });

  it('keeps the two backends isolated from each other', async () => {
    // The backend is fixed at config-load time, so each switch must go through
    // reloadRuntimeConfig() — it is not hot-swappable at runtime.
    const mod = await import('../../../services/usagePersistence.js');

    process.env.INDEX_SERVER_STORAGE_BACKEND = 'json';
    delete process.env.INDEX_SERVER_SQLITE_PATH;
    reloadRuntimeConfig();
    mod.writePersistedUsage({ shared: { usageCount: 1, retrievedCount: 1, appliedCount: 0 } });

    process.env.INDEX_SERVER_STORAGE_BACKEND = 'sqlite';
    process.env.INDEX_SERVER_SQLITE_PATH = dbPath;
    reloadRuntimeConfig();
    mod.closeUsagePersistence();
    // The SQLite table is empty — it must not silently read the JSON file.
    expect(mod.readPersistedUsage()).toEqual({});

    mod.writePersistedUsage({ shared: { usageCount: 5, retrievedCount: 2, appliedCount: 3 } });
    expect(mod.readPersistedUsage().shared.appliedCount).toBe(3);

    // The JSON snapshot is untouched by the SQLite write.
    process.env.INDEX_SERVER_STORAGE_BACKEND = 'json';
    delete process.env.INDEX_SERVER_SQLITE_PATH;
    reloadRuntimeConfig();
    mod.closeUsagePersistence();
    expect(mod.readPersistedUsage().shared.usageCount).toBe(1);
  });
});
