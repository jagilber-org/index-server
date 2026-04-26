/**
 * NEGATIVE TESTS for index_add / index_dispatch
 *
 * These tests verify failure paths that WOULD HAVE caught the fake-verification bug
 * (where index_add returned verified:true without actually persisting anything).
 *
 * Strategy:
 * 1. Never trust the server's response alone — independently verify disk truth
 * 2. Test every required-field validation path
 * 3. Test duplicate rejection, corruption handling, read-back failures
 * 4. Test that "verified" actually means the file exists AND parses AND matches
 *
 * Uses createTestClient (MCP SDK) for full-stack through-the-wire tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTestClient, type TestClient } from './helpers/mcpTestClient.js';

function makeTempDir(label: string) {
  const dir = path.join(process.cwd(), 'tmp', `neg-${label}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe('index_add NEGATIVE tests — failure paths', () => {
  const instructionsDir = makeTempDir('add-neg');
  let client: TestClient;

  beforeAll(async () => {
    client = await createTestClient({
      instructionsDir,
      forceMutation: true,
      extraEnv: { INDEX_SERVER_STRICT_CREATE: '1' },
    });
  }, 30000);

  afterAll(async () => {
    await client?.close();
    try { fs.rmSync(instructionsDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  // --- Required field validation ---

  it('rejects add with missing id', async () => {
    const resp = await client.create({ id: '', title: 'No ID', body: 'body' });
    expect(resp?.error || resp?.status === 'error' || !resp?.created,
      'missing id should fail: ' + JSON.stringify(resp)).toBeTruthy();
  });

  it('rejects add with missing title', async () => {
    const resp = await client.callToolJSON('index_dispatch', {
      action: 'add',
      entry: { id: 'neg-no-title-' + Date.now(), body: 'body', priority: 50, audience: 'all', requirement: 'optional', categories: ['test'] },
      overwrite: true,
    });
    expect(resp?.error || resp?.status === 'error' || !resp?.created,
      'missing title should fail: ' + JSON.stringify(resp)).toBeTruthy();
  });

  it('rejects add with missing body', async () => {
    const resp = await client.callToolJSON('index_dispatch', {
      action: 'add',
      entry: { id: 'neg-no-body-' + Date.now(), title: 'Has Title', priority: 50, audience: 'all', requirement: 'optional', categories: ['test'] },
      overwrite: true,
    });
    expect(resp?.error || resp?.status === 'error' || !resp?.created,
      'missing body should fail: ' + JSON.stringify(resp)).toBeTruthy();
  });

  // --- The test that catches the fake verification bug ---

  it('verified:true MUST mean file exists on disk with correct content', async () => {
    const id = 'neg-verify-disk-' + Date.now();
    const body = 'This body must appear on disk verbatim';
    const title = 'Disk Truth Test';

    const resp = await client.create({ id, title, body });
    expect(resp?.id).toBe(id);

    if (resp?.verified === true) {
      // Server claims verified — INDEPENDENTLY check disk
      const file = path.join(instructionsDir, id + '.json');
      expect(fs.existsSync(file), 'verified:true but file missing on disk').toBe(true);

      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      expect(parsed.id, 'disk id mismatch').toBe(id);
      expect(parsed.body, 'disk body mismatch').toBe(body);
      expect(parsed.title, 'disk title mismatch').toBe(title);
    }

    // Also verify via get (server read-back)
    const getResp = await client.read(id);
    const item = getResp?.item || getResp;
    expect(item?.id, 'get after add must return correct id').toBe(id);
    expect(item?.body, 'get after add must return correct body').toBe(body);
  }, 30000);

  it('created:true MUST mean file count increased by exactly 1', async () => {
    const beforeList = await client.list();
    const beforeCount = beforeList.count;

    const id = 'neg-count-check-' + Date.now();
    const resp = await client.create({ id, title: 'Count Check', body: 'counting' });
    expect(resp?.created, 'should be created').toBe(true);

    const afterList = await client.list();
    expect(afterList.count, 'count must increase by 1').toBe(beforeCount + 1);
  }, 30000);

  // --- Duplicate rejection ---

  it('duplicate add without overwrite fails or skips', async () => {
    const id = 'neg-dup-' + Date.now();
    const resp1 = await client.create({ id, title: 'First', body: 'first body' });
    expect(resp1?.created || resp1?.overwritten, 'first add should succeed').toBeTruthy();

    // Try adding again WITHOUT overwrite
    const resp2 = await client.callToolJSON('index_dispatch', {
      action: 'add',
      entry: { id, title: 'Second', body: 'second body', priority: 50, audience: 'all', requirement: 'optional', categories: ['test'] },
      overwrite: false,
      lax: true,
    });
    // Must NOT silently succeed — should be skipped or error
    expect(resp2?.created !== true || resp2?.error || resp2?.skipped,
      'duplicate without overwrite must not claim created:true: ' + JSON.stringify(resp2)).toBeTruthy();
  }, 30000);

  // --- Body too large ---

  it('rejects oversized body at the default limit', async () => {
    const id = 'neg-big-body-' + Date.now();
    const hugeBody = 'x'.repeat(100000);
    const resp = await client.create({ id, title: 'Huge', body: hugeBody });
    expect(resp?.created, 'server must reject oversized body').toBe(false);
    expect(resp?.error, 'oversized body should return a clear error').toBe('body_too_large');
    const getResp = await client.read(id);
    const item = getResp?.item || getResp;
    expect(item?.id, 'oversized body must not be persisted').not.toBe(id);
  }, 30000);

  // --- Invalid semver ---

  it('rejects invalid semver version', async () => {
    const id = 'neg-bad-ver-' + Date.now();
    const resp = await client.callToolJSON('index_dispatch', {
      action: 'add',
      entry: { id, title: 'Bad Version', body: 'body', priority: 50, audience: 'all', requirement: 'optional', categories: ['test'], version: 'not-a-version' },
      overwrite: true,
      lax: true,
    });
    expect(resp?.error || resp?.status === 'error' || !resp?.created,
      'invalid semver should fail: ' + JSON.stringify(resp)).toBeTruthy();
  }, 30000);
});

describe('index_get / index_remove NEGATIVE tests', () => {
  const instructionsDir = makeTempDir('get-neg');
  let client: TestClient;

  beforeAll(async () => {
    client = await createTestClient({
      instructionsDir,
      forceMutation: true,
    });
  }, 30000);

  afterAll(async () => {
    await client?.close();
    try { fs.rmSync(instructionsDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it('get non-existent ID returns error or empty', async () => {
    const resp = await client.read('totally-does-not-exist-' + Date.now());
    // Must not return a valid item with content
    const item = resp?.item;
    expect(!item || item.error || !item.body,
      'get non-existent should not return valid item: ' + JSON.stringify(resp)?.slice(0, 200)).toBeTruthy();
  }, 30000);

  it('remove non-existent ID does not crash', async () => {
    const resp = await client.remove('remove-ghost-' + Date.now());
    // Should not throw; may return removed:0 or similar
    expect(resp !== undefined, 'remove should return a response').toBe(true);
  }, 30000);

  it('remove then get returns nothing', async () => {
    const id = 'neg-remove-get-' + Date.now();
    await client.create({ id, title: 'Will Remove', body: 'ephemeral' });
    await client.remove(id);
    const resp = await client.read(id);
    const item = resp?.item;
    expect(!item || !item.body,
      'get after remove should return nothing: ' + JSON.stringify(resp)?.slice(0, 200)).toBeTruthy();
  }, 30000);
});

describe('disk-truth independent verification', () => {
  const instructionsDir = makeTempDir('disk-truth');
  let client: TestClient;

  beforeAll(async () => {
    client = await createTestClient({
      instructionsDir,
      forceMutation: true,
      extraEnv: { INDEX_SERVER_STRICT_CREATE: '1' },
    });
  }, 30000);

  afterAll(async () => {
    await client?.close();
    try { fs.rmSync(instructionsDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it('every file on disk after N adds must be valid JSON with matching id', async () => {
    const ids = Array.from({ length: 5 }, (_, i) => `disk-truth-${Date.now()}-${i}`);
    for (const id of ids) {
      const resp = await client.create({ id, title: `DT-${id}`, body: `Body for ${id}` });
      expect(resp?.created || resp?.overwritten, `add ${id} should succeed`).toBeTruthy();
    }

    // Independent disk scan — don't trust the server
    for (const id of ids) {
      const file = path.join(instructionsDir, id + '.json');
      expect(fs.existsSync(file), `file for ${id} must exist`).toBe(true);
      const raw = fs.readFileSync(file, 'utf8');
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        throw new Error(`File ${id}.json is not valid JSON: ${(e as Error).message}`);
      }
      expect(parsed.id, `disk id must match for ${id}`).toBe(id);
      expect(typeof parsed.body, `disk body must be string for ${id}`).toBe('string');
      expect((parsed.body as string).length, `disk body must not be empty for ${id}`).toBeGreaterThan(0);
      expect(typeof parsed.title, `disk title must be string for ${id}`).toBe('string');
    }
  }, 60000);

  it('list must include every ID we added', async () => {
    // Don't compare raw file count (server creates internal files like bootstrap.confirmed.json)
    // Instead verify every ID we explicitly created appears in list
    const ids = Array.from({ length: 3 }, (_, i) => `list-check-${Date.now()}-${i}`);
    for (const id of ids) {
      await client.create({ id, title: `LC-${id}`, body: `body-${id}` });
    }
    const listResp = await client.list();
    const listedIds = new Set(listResp.items.map((i: Record<string, unknown>) => i.id));
    for (const id of ids) {
      expect(listedIds.has(id), `${id} must be in list`).toBe(true);
    }
  }, 30000);

  it('corrupted JSON file is handled gracefully on reload', async () => {
    const corruptId = 'corrupt-' + Date.now();
    const file = path.join(instructionsDir, corruptId + '.json');
    fs.writeFileSync(file, '{this is not valid json!!!', 'utf8');

    // Reading the corrupt entry should not crash — should return error or empty
    const resp = await client.read(corruptId);
    // Acceptable outcomes: error, no item, or item without matching content
    // NOT acceptable: crash, hang, or returning fake data
    expect(resp !== undefined, 'should not crash on corrupt file').toBe(true);

    // Clean up corrupt file
    fs.unlinkSync(file);
  }, 30000);
});
