import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { reloadRuntimeConfig } from '../config/runtimeConfig';
import { invalidate } from '../services/indexContext';
import { getHandler } from '../server/registry';

type AddHandler = (params: {
  entry: Record<string, unknown>;
  overwrite?: boolean;
  lax?: boolean;
}) => Promise<Record<string, unknown>>;

const originalDir = process.env.INDEX_SERVER_DIR;
const originalMutation = process.env.INDEX_SERVER_MUTATION;
const tempDirs: string[] = [];

function configureIsolatedDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'index-add-overwrite-'));
  tempDirs.push(dir);
  process.env.INDEX_SERVER_MUTATION = '1';
  process.env.INDEX_SERVER_DIR = dir;
  reloadRuntimeConfig();
  invalidate();
  return dir;
}

function restoreEnv(): void {
  if (originalDir) process.env.INDEX_SERVER_DIR = originalDir;
  else delete process.env.INDEX_SERVER_DIR;

  if (originalMutation) process.env.INDEX_SERVER_MUTATION = originalMutation;
  else delete process.env.INDEX_SERVER_MUTATION;

  reloadRuntimeConfig();
  invalidate();
}

describe('index_add overwrite truthfulness', () => {
  beforeAll(async () => {
    // @ts-expect-error side-effect registration
    await import('../services/handlers.instructions');
  });

  afterEach(() => {
    restoreEnv();
    for (const dir of tempDirs.splice(0)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // cleanup only
      }
    }
  });

  it('fails noop overwrite verification when the persisted file disappeared', async () => {
    const dir = configureIsolatedDir();
    const add = getHandler('index_add') as AddHandler;
    const id = `noop-missing-file-${Date.now()}`;
    const entry = {
      id,
      title: 'Noop Missing File',
      body: 'Original body',
      priority: 5,
      audience: 'all',
      requirement: 'optional',
      categories: ['truth'],
    };

    const created = await add({ entry, overwrite: true, lax: true });
    expect(created).toMatchObject({ id, created: true, verified: true });

    const file = path.join(dir, `${id}.json`);
    fs.unlinkSync(file);

    const resp = await add({ entry, overwrite: true, lax: true });

    expect(resp.error).toBe('read-back verification failed');
    expect(resp.verified).not.toBe(true);
  });

  it('refuses to overwrite an unreadable existing record with a synthetic replacement', async () => {
    const dir = configureIsolatedDir();
    const add = getHandler('index_add') as AddHandler;
    const id = `overwrite-unreadable-${Date.now()}`;
    const file = path.join(dir, `${id}.json`);
    const malformed = '{"id":"broken-entry","title":"Broken"';
    fs.writeFileSync(file, malformed, 'utf8');
    invalidate();

    const resp = await add({
      entry: {
        id,
        title: 'Replacement title',
        body: 'Replacement body',
        priority: 5,
        audience: 'all',
        requirement: 'optional',
        categories: ['truth'],
      },
      overwrite: true,
      lax: true,
    });

    expect(resp.error).toBe('existing_instruction_unreadable');
    expect(fs.readFileSync(file, 'utf8')).toBe(malformed);
  });

  it('fails hydration explicitly when overwrite depends on an unreadable existing record', async () => {
    const dir = configureIsolatedDir();
    const add = getHandler('index_add') as AddHandler;
    const id = `hydrate-unreadable-${Date.now()}`;
    const file = path.join(dir, `${id}.json`);
    const malformed = '{"id":"hydrate-broken","title":"Broken"';
    fs.writeFileSync(file, malformed, 'utf8');
    invalidate();

    const resp = await add({
      entry: {
        id,
        body: 'Replacement body only',
      },
      overwrite: true,
      lax: true,
    });

    expect(resp.error).toBe('existing_instruction_unreadable');
    expect(resp.validationErrors).toBeUndefined();
    expect(fs.readFileSync(file, 'utf8')).toBe(malformed);
  });
});
