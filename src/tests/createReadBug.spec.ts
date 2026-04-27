/**
 * Regression test for the fake-verification bug (commit 65afc0d).
 *
 * The original bug: index_add returned { verified: true, created: true } even when
 * the instruction was NOT actually persisted to disk. The old code:
 * 1. Stuffed the entry into the in-memory Map BEFORE "verifying"
 * 2. Then "verified" by checking the Map — which always found it
 * 3. Returned verified: true without ever checking disk
 *
 * This test catches that class of lie by:
 * - Adding an instruction via MCP
 * - Independently reading the disk file (bypassing the server entirely)
 * - Verifying the file exists, parses, and has the correct id/body/title
 * - Then calling get via MCP and confirming it matches disk
 *
 * If verified:true but disk is empty/wrong, this test FAILS.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTestClient, type TestClient } from './helpers/mcpTestClient.js';

describe('createReadBug regression — verified must mean persisted', () => {
  const instructionsDir = path.join(process.cwd(), 'tmp', 'create-read-bug-' + Date.now());
  let client: TestClient;

  beforeAll(async () => {
    fs.mkdirSync(instructionsDir, { recursive: true });
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

  it('verified:true requires file on disk with correct content', async () => {
    const id = 'regression-fake-verify-' + Date.now();
    const body = 'This exact string must appear on disk';
    const title = 'Fake Verify Regression';

    const addResp = await client.create({ id, title, body });

    // If server says created + verified, prove it
    if (addResp?.created && addResp?.verified) {
      const file = path.join(instructionsDir, id + '.json');
      expect(fs.existsSync(file), `verified:true but ${id}.json missing from disk`).toBe(true);

      const diskRaw = fs.readFileSync(file, 'utf8');
      const diskParsed = JSON.parse(diskRaw);
      expect(diskParsed.id).toBe(id);
      expect(diskParsed.body).toBe(body);
      expect(diskParsed.title).toBe(title);
    } else {
      // If it failed, that's acceptable — but it must NOT claim verified:true
      expect(addResp?.verified, 'failed add must not claim verified').not.toBe(true);
    }
  }, 30000);

  it('get after add returns matching content — not stale/empty', async () => {
    const id = 'regression-stale-read-' + Date.now();
    const body = 'Fresh body that must be readable';
    const title = 'Stale Read Regression';

    await client.create({ id, title, body });

    const getResp = await client.read(id);
    const item = getResp?.item || getResp;
    expect(item?.id, 'get must return the id we just added').toBe(id);
    expect(item?.body, 'get must return the exact body').toBe(body);
  }, 30000);

  it('list after add includes the new entry', async () => {
    const id = 'regression-list-miss-' + Date.now();
    await client.create({ id, title: 'List Miss', body: 'should appear in list' });

    const listResp = await client.list();
    const found = listResp.items.some((i: Record<string, unknown>) => i.id === id);
    expect(found, `${id} must appear in list after add`).toBe(true);
  }, 30000);
});
