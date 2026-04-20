/**
 * Regression coverage for feedback ID ec43564a237db25e.
 * Machine-readable metadata must survive persistence without allowing clients
 * to forge server-assigned provenance fields.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { getHandler } from '../server/registry.js';
import { reloadRuntimeConfig } from '../config/runtimeConfig.js';
import { invalidate } from '../services/indexContext.js';
import { createStore } from '../services/storage/factory.js';
import { forceBootstrapConfirmForTests } from '../services/bootstrapGating.js';
import { INSTRUCTIONS_DDL, PRAGMAS } from '../services/storage/sqliteSchema.js';

const TMP_ROOT = path.join(process.cwd(), 'tmp', 'metadata-persistence-regression');

function configureBackend(backend: 'json' | 'sqlite') {
  const backendRoot = path.join(TMP_ROOT, `${backend}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const instructionsDir = path.join(backendRoot, 'instructions');
  const sqlitePath = path.join(backendRoot, 'index.db');
  const workspaceId = `server-${backend}-workspace`;

  invalidate();
  fs.mkdirSync(instructionsDir, { recursive: true });

  process.env.INDEX_SERVER_MUTATION = '1';
  process.env.INDEX_SERVER_DIR = instructionsDir;
  process.env.INDEX_SERVER_WORKSPACE = workspaceId;
  if (backend === 'sqlite') {
    process.env.INDEX_SERVER_STORAGE_BACKEND = 'sqlite';
    process.env.INDEX_SERVER_SQLITE_PATH = sqlitePath;
  } else {
    delete process.env.INDEX_SERVER_STORAGE_BACKEND;
    delete process.env.INDEX_SERVER_SQLITE_PATH;
  }

  reloadRuntimeConfig();
  invalidate();

  return { instructionsDir, sqlitePath, workspaceId };
}

describe('instruction metadata persistence regression', () => {
  beforeAll(async () => {
    await import('../services/handlers.instructions.js');
    await import('../services/instructions.dispatcher.js');
    forceBootstrapConfirmForTests('metadata-persistence-regression');
  });

  afterAll(() => {
    invalidate();
    try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
    delete process.env.INDEX_SERVER_DIR;
    delete process.env.INDEX_SERVER_MUTATION;
    delete process.env.INDEX_SERVER_STORAGE_BACKEND;
    delete process.env.INDEX_SERVER_SQLITE_PATH;
    delete process.env.INDEX_SERVER_WORKSPACE;
  });

  describe.each(['json', 'sqlite'] as const)('%s backend', (backend) => {
    let instructionsDir = '';
    let sqlitePath = '';
    let workspaceId = '';

    beforeEach(() => {
      const configured = configureBackend(backend);
      instructionsDir = configured.instructionsDir;
      sqlitePath = configured.sqlitePath;
      workspaceId = configured.workspaceId;
    });

    it('preserves server-assigned sourceWorkspace and extensions through add', async () => {
      const add = getHandler('index_add');
      const dispatch = getHandler('index_dispatch');

      expect(add).toBeTruthy();
      expect(dispatch).toBeTruthy();

      const id = `metadata-add-${backend}-${Date.now()}`;
      const expectedExtensions = {
        vendor: { backend, feature: 'metadata-persistence' },
        machineReadable: { enabled: true, version: 1 },
      };

      const addResult = await Promise.resolve(add!({
        entry: {
          id,
          title: 'Metadata persistence regression',
          body: 'Preserve server-assigned sourceWorkspace and extensions on index_add.',
          priority: 50,
          audience: 'all',
          requirement: 'optional',
          categories: ['metadata'],
          sourceWorkspace: `forged-${backend}-workspace`,
          extensions: expectedExtensions,
        },
        overwrite: true,
        lax: true,
      })) as Record<string, unknown>;

      expect(addResult.error, JSON.stringify(addResult)).toBeFalsy();

      const getResult = await Promise.resolve(dispatch!({ action: 'get', id })) as Record<string, unknown>;
      const item = getResult.item as Record<string, unknown>;
      expect(item).toBeTruthy();
      expect(item.sourceWorkspace).toBe(workspaceId);
      expect(item.extensions).toEqual(expectedExtensions);

      if (backend === 'json') {
        const diskEntry = JSON.parse(fs.readFileSync(path.join(instructionsDir, `${id}.json`), 'utf8')) as Record<string, unknown>;
        expect(diskEntry.sourceWorkspace).toBe(workspaceId);
        expect(diskEntry.extensions).toEqual(expectedExtensions);
        return;
      }

      const store = createStore('sqlite', instructionsDir, sqlitePath);
      try {
        const persisted = store.get(id) as unknown as Record<string, unknown> | null;
        expect(persisted).toBeTruthy();
        expect(persisted?.sourceWorkspace).toBe(workspaceId);
        expect(persisted?.extensions).toEqual(expectedExtensions);
      } finally {
        store.close();
      }
    });

    it('preserves server-assigned sourceWorkspace and extensions through import', async () => {
      const importHandler = getHandler('index_import');
      const dispatch = getHandler('index_dispatch');

      expect(importHandler).toBeTruthy();
      expect(dispatch).toBeTruthy();

      const id = `metadata-import-${backend}-${Date.now()}`;
      const expectedExtensions = {
        vendor: { backend, feature: 'metadata-import' },
        machineReadable: { importPath: true, revision: 2 },
      };

      const importResult = await Promise.resolve(importHandler!({
        entries: [{
          id,
          title: 'Metadata import regression',
          body: 'Preserve extensions on index_import.',
          priority: 50,
          audience: 'all',
          requirement: 'optional',
          categories: ['metadata'],
          sourceWorkspace: `forged-import-${backend}`,
          extensions: expectedExtensions,
        }],
        mode: 'overwrite',
      })) as Record<string, unknown>;

      expect(importResult.error, JSON.stringify(importResult)).toBeFalsy();

      const getResult = await Promise.resolve(dispatch!({ action: 'get', id })) as Record<string, unknown>;
      const item = getResult.item as Record<string, unknown>;
      expect(item.sourceWorkspace).toBe(workspaceId);
      expect(item.extensions).toEqual(expectedExtensions);
    });

    it('updates extensions on metadata-only overwrite', async () => {
      const add = getHandler('index_add');
      const dispatch = getHandler('index_dispatch');

      expect(add).toBeTruthy();
      expect(dispatch).toBeTruthy();

      const id = `metadata-overwrite-${backend}-${Date.now()}`;
      const initialExtensions = { vendor: { revision: 1 } };
      const updatedExtensions = { vendor: { revision: 2 }, flags: { overwritten: true } };

      const createResult = await Promise.resolve(add!({
        entry: {
          id,
          title: 'Metadata overwrite regression',
          body: 'Original body',
          priority: 50,
          audience: 'all',
          requirement: 'optional',
          categories: ['metadata'],
          extensions: initialExtensions,
        },
        overwrite: true,
        lax: true,
      })) as Record<string, unknown>;
      expect(createResult.error, JSON.stringify(createResult)).toBeFalsy();

      const overwriteResult = await Promise.resolve(add!({
        entry: {
          id,
          extensions: updatedExtensions,
        },
        overwrite: true,
        lax: true,
      })) as Record<string, unknown>;
      expect(overwriteResult.error, JSON.stringify(overwriteResult)).toBeFalsy();
      expect(overwriteResult.overwritten).toBe(true);
      expect(overwriteResult.skipped).toBe(false);

      const getResult = await Promise.resolve(dispatch!({ action: 'get', id })) as Record<string, unknown>;
      const item = getResult.item as Record<string, unknown>;
      expect(item.extensions).toEqual(updatedExtensions);
      expect(item.sourceWorkspace).toBe(workspaceId);
    });
  });

  it('adds the extensions column when opening a legacy sqlite database', () => {
    const { instructionsDir, sqlitePath } = configureBackend('sqlite');
    const legacyDdl = INSTRUCTIONS_DDL.replace(/\s*extensions TEXT,\r?\n/, '\n');
    const legacyDb = new DatabaseSync(sqlitePath);
    legacyDb.exec(PRAGMAS);
    legacyDb.exec(legacyDdl);
    legacyDb.prepare(`
      INSERT INTO instructions (
        id, title, body, priority, audience, requirement, categories, content_type,
        source_hash, schema_version, created_at, updated_at, source_workspace
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'legacy-sqlite-entry',
      'Legacy sqlite entry',
      'Created before extensions column existed',
      50,
      'all',
      'optional',
      '["legacy"]',
      'instruction',
      'legacy-hash',
      '4',
      new Date().toISOString(),
      new Date().toISOString(),
      'legacy-workspace',
    );
    legacyDb.close();

    const store = createStore('sqlite', instructionsDir, sqlitePath);
    try {
      const persisted = store.get('legacy-sqlite-entry') as unknown as Record<string, unknown> | null;
      expect(persisted).toBeTruthy();
      expect(persisted?.sourceWorkspace).toBe('legacy-workspace');
      expect(persisted?.extensions).toBeUndefined();

      const verifyDb = new DatabaseSync(sqlitePath);
      try {
        const columns = verifyDb.prepare('PRAGMA table_info(instructions)').all() as Array<{ name?: string }>;
        expect(columns.some((column) => column.name === 'extensions')).toBe(true);
      } finally {
        verifyDb.close();
      }
    } finally {
      store.close();
    }
  });
});
