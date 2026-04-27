import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { InstructionEntry } from '../../models/instruction';

const TMP_DIR = path.join(process.cwd(), 'tmp', 'instructions-async-handlers');

interface MockState {
  loadedAt: string;
  hash: string;
  byId: Map<string, InstructionEntry>;
  list: InstructionEntry[];
  fileCount: number;
  versionMTime: number;
  versionToken: string;
}

function createState(): MockState {
  return {
    loadedAt: new Date().toISOString(),
    hash: 'hash-0',
    byId: new Map(),
    list: [],
    fileCount: 0,
    versionMTime: 0,
    versionToken: 'token-0',
  };
}

async function loadHandler(method: 'index_add' | 'index_import') {
  vi.resetModules();
  const state = createState();
  const ensureLoaded = vi.fn(() => {
    throw new Error('sync ensureLoaded should not be used by async mutation handlers');
  });
  const writeEntry = vi.fn(() => {
    throw new Error('sync writeEntry should not be used by async mutation handlers');
  });
  const ensureLoadedAsync = vi.fn(async () => state);
  const writeEntryAsync = vi.fn(async (entry: InstructionEntry) => {
    state.byId.set(entry.id, entry);
    state.list = Array.from(state.byId.values());
    state.fileCount = state.list.length;
    state.hash = `hash-${state.fileCount}`;
    state.loadedAt = new Date().toISOString();
    return undefined;
  });

  vi.doMock('../../services/indexContext', () => ({
    ensureLoaded,
    ensureLoadedAsync,
    writeEntry,
    writeEntryAsync,
    getInstructionsDir: () => TMP_DIR,
    invalidate: () => undefined,
    touchIndexVersion: () => undefined,
    isDuplicateInstructionWriteError: () => false,
  }));
  vi.doMock('../../services/manifestManager', () => ({
    writeManifestFromIndex: () => undefined,
    attemptManifestUpdate: () => undefined,
  }));
  vi.doMock('../../services/tracing', () => ({
    emitTrace: () => undefined,
    traceEnabled: () => false,
  }));

  const registry = await import('../../server/registry.js');
  if (method === 'index_add') {
    await import('../../services/handlers/instructions.add.js');
  } else {
    await import('../../services/handlers/instructions.import.js');
  }

  return {
    handler: registry.getHandler(method) as (params: Record<string, unknown>) => Promise<Record<string, unknown>>,
    ensureLoaded,
    ensureLoadedAsync,
    writeEntry,
    writeEntryAsync,
  };
}

describe('instruction mutation handlers use async index context helpers', () => {
  beforeEach(() => {
    process.env.INDEX_SERVER_MUTATION = '1';
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
  });

  afterEach(() => {
    delete process.env.INDEX_SERVER_MUTATION;
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('index_add awaits async load/write helpers', async () => {
    const { handler, ensureLoaded, ensureLoadedAsync, writeEntry, writeEntryAsync } = await loadHandler('index_add');

    const result = await handler({
      entry: {
        id: 'async-add',
        title: 'Async add',
        body: 'Body',
        priority: 10,
        audience: 'all',
        requirement: 'optional',
        categories: ['test'],
      },
      overwrite: false,
    });

    expect(result).toMatchObject({
      id: 'async-add',
      created: true,
      overwritten: false,
      skipped: false,
      verified: true,
    });
    expect(ensureLoadedAsync).toHaveBeenCalled();
    expect(writeEntryAsync).toHaveBeenCalledTimes(1);
    expect(ensureLoaded).not.toHaveBeenCalled();
    expect(writeEntry).not.toHaveBeenCalled();
  });

  it('index_import awaits async load/write helpers', async () => {
    const { handler, ensureLoaded, ensureLoadedAsync, writeEntry, writeEntryAsync } = await loadHandler('index_import');

    const result = await handler({
      entries: [{
        id: 'async-import',
        title: 'Async import',
        body: 'Body',
        priority: 10,
        audience: 'all',
        requirement: 'optional',
        categories: ['test'],
      }],
      mode: 'overwrite',
    });

    expect(result).toMatchObject({
      imported: 1,
      overwritten: 0,
      skipped: 0,
      total: 1,
      hash: 'hash-1',
    });
    expect(ensureLoadedAsync).toHaveBeenCalled();
    expect(writeEntryAsync).toHaveBeenCalledTimes(1);
    expect(ensureLoaded).not.toHaveBeenCalled();
    expect(writeEntry).not.toHaveBeenCalled();
  });
});
