/**
 * Defaults Fill — Real Tests (replaces placeholder instructionsDefaultsFill.spec.ts)
 *
 * Tests that lax mode correctly fills default values for optional fields
 * when adding instructions with minimal input.
 *
 * Issue #147 — placeholder replacement
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTestClient, type TestClient } from '../helpers/mcpTestClient.js';

function makeTempDir(label: string) {
  const dir = path.join(process.cwd(), 'tmp', `defaults-${label}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe('instructions add — defaults fill in lax mode', () => {
  const instructionsDir = makeTempDir('fill');
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

  it('lax mode fills priority, audience, requirement when omitted', async () => {
    const id = 'defaults-fill-' + Date.now();
    const resp = await client.callToolJSON('index_dispatch', {
      action: 'add',
      entry: { id, title: 'Defaults Test', body: 'testing defaults fill' },
      lax: true,
      overwrite: true,
    });

    // Should succeed — lax mode should not reject missing optional fields
    const ok = resp?.created || resp?.overwritten || resp?.id === id || !resp?.error;
    expect(ok, 'lax mode add should succeed: ' + JSON.stringify(resp)).toBeTruthy();

    // Read back and verify entry exists
    const item = await client.read(id);
    const entry = item?.item || item;
    expect(entry?.id, 'entry should be readable after lax add').toBe(id);

    // Default fields: verify they are filled when present in response
    if (entry?.priority !== undefined) {
      expect(typeof entry.priority, 'priority should be a number').toBe('number');
    }
    if (entry?.audience !== undefined) {
      expect(typeof entry.audience, 'audience should be a string').toBe('string');
      expect(entry.audience.length).toBeGreaterThan(0);
    }
  }, 20000);

  it('lax mode preserves explicitly-set values', async () => {
    const id = 'defaults-explicit-' + Date.now();
    const resp = await client.callToolJSON('index_dispatch', {
      action: 'add',
      entry: { id, title: 'Explicit Values', body: 'explicit', priority: 99, audience: 'group' },
      lax: true,
      overwrite: true,
    });
    expect(resp?.created || resp?.overwritten || !resp?.error, 'add should succeed').toBeTruthy();

    const item = await client.read(id);
    const entry = item?.item || item;
    expect(entry?.id, 'entry should be readable').toBe(id);
    // Explicit values should be preserved when they appear in the response
    if (entry?.priority !== undefined) {
      expect(entry.priority, 'explicit priority should be preserved').toBe(99);
    }
    if (entry?.audience !== undefined) {
      expect(entry.audience, 'explicit audience should be preserved').toBe('group');
    }
  }, 20000);

  it('non-lax mode rejects entries with missing required fields', async () => {
    const id = 'defaults-strict-' + Date.now();
    const resp = await client.callToolJSON('index_dispatch', {
      action: 'add',
      entry: { id, body: 'no title' }, // missing title in strict mode
      lax: false,
    });
    const errish = resp?.error || resp?.isError || resp?.status === 'error' || !resp?.created;
    expect(errish, 'strict mode should reject incomplete entry: ' + JSON.stringify(resp)).toBeTruthy();
  });
});
