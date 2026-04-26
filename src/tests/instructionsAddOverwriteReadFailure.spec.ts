import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getHandler } from '../server/registry';
import { reloadRuntimeConfig } from '../config/runtimeConfig';

const TMP_DIR = path.join(process.cwd(), 'tmp', 'overwrite-read-failure');

describe('index_add overwrite read failure', () => {
  let add: any;

  beforeAll(async () => {
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_DIR = TMP_DIR;
    reloadRuntimeConfig();
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    // @ts-expect-error side effect
    await import('../services/handlers.instructions');
    add = getHandler('index_add');
  });

  afterAll(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('fails explicitly instead of recreating an unreadable existing entry during overwrite', async () => {
    const id = 'overwrite-read-failure';
    const file = path.join(TMP_DIR, `${id}.json`);
    const corruptJson = '{"id":"overwrite-read-failure","title":"broken"';
    fs.writeFileSync(file, corruptJson, 'utf8');

    const result = await add({
      entry: {
        id,
        title: 'Recovered title',
        body: 'replacement body',
        priority: 50,
        audience: 'all',
        requirement: 'optional',
        categories: ['test'],
      },
      overwrite: true,
      lax: true,
    });

    expect(result.error).toBe('existing_instruction_unreadable');
    expect(result.created).toBe(false);
    expect(result.overwritten).toBe(false);
    expect(result.message).toMatch(/Existing instruction could not be read for overwrite/i);
    expect(fs.readFileSync(file, 'utf8')).toBe(corruptJson);
  });
});
