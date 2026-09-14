/**
 * Regression coverage for #494: governance-denylisted files are denied silently.
 *
 * The loader refuses any file whose basename starts with `000-bootstrapper` or
 * `001-lifecycle-bootstrap` to prevent knowledge recursion. That guard is
 * correct, but it was invisible:
 *
 *  1. `_skipped.json` is built from parse/validation `errors` only, so denied
 *     files produced `{ count: 0, items: [] }` while files were being dropped
 *     on every load.
 *  2. `index_add` / `index_import` happily persisted a file under a denied id,
 *     answered `success: true, verified: true`, and the entry then vanished on
 *     the next load with nothing to explain it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTestClient } from './helpers/mcpTestClient.js';

function makeTempDir(name: string) {
  const dir = path.join(process.cwd(), 'tmp', name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

interface AddResp { success?: boolean; created?: boolean; error?: string; id?: string }
interface ImportResp { errors?: { id: string; error: string }[]; written?: number }
interface SkippedArtifact { count: number; items: { file: string; reason: string }[] }

const DENIED_IDS = ['000-bootstrapper', '001-lifecycle-bootstrap'];

describe('#494: governance denylist is enforced at write time and reported', () => {
  const instructionsDir = makeTempDir('governance-denylist-494');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;

  beforeAll(async () => {
    // A denied file placed directly on disk must show up in the skipped report.
    fs.writeFileSync(path.join(instructionsDir, '000-bootstrapper.json'), JSON.stringify({
      id: '000-bootstrapper', title: 'Seeded bootstrapper', body: 'Should never load.',
      priority: 1, audience: 'all', requirement: 'optional', categories: ['general'],
      sourceHash: 'a'.repeat(64), schemaVersion: '7',
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    }, null, 2));

    client = await createTestClient({ instructionsDir, forceMutation: true });
  }, 30000);

  afterAll(async () => { await client?.close(); });

  it('does not load a denylisted file that is present on disk', async () => {
    const resp = await client.callToolJSON('index_dispatch', { action: 'get', id: '000-bootstrapper' });
    expect((resp as { notFound?: boolean })?.notFound).toBe(true);
  });

  it('records denied files in _skipped.json instead of reporting count 0', async () => {
    await client.callToolJSON('index_dispatch', { action: 'reload' });
    const skippedPath = path.join(instructionsDir, '_skipped.json');
    expect(fs.existsSync(skippedPath)).toBe(true);

    const skipped = JSON.parse(fs.readFileSync(skippedPath, 'utf8')) as SkippedArtifact;
    const denied = skipped.items.filter(i => i.reason.includes('governance-denylist'));
    expect(denied.map(d => d.file)).toContain('000-bootstrapper.json');
    expect(skipped.count).toBe(skipped.items.length);
  });

  for (const id of DENIED_IDS) {
    it(`index_add rejects the denylisted id "${id}" instead of writing a file that never loads`, async () => {
      const resp = (await client.callToolJSON('index_add', {
        entry: { id, title: 'Denied', body: 'This id can never load.' },
        lax: true,
        overwrite: true,
      })) as AddResp;

      expect(resp?.success).toBe(false);
      expect(resp?.error).toContain('denylisted_id');
    });
  }

  it('index_import rejects a denylisted id and reports it per entry', async () => {
    const resp = (await client.callToolJSON('index_import', {
      entries: [{
        id: '001-lifecycle-bootstrap', title: 'Denied', body: 'This id can never load.',
        priority: 50, audience: 'all', requirement: 'optional',
      }],
      mode: 'overwrite',
    })) as ImportResp;

    const errors = resp?.errors ?? [];
    expect(errors.some(e => e.id === '001-lifecycle-bootstrap' && e.error.includes('denylisted_id'))).toBe(true);
  });

  it('still accepts an id that merely resembles a denied prefix', async () => {
    const resp = (await client.callToolJSON('index_add', {
      entry: { id: 'bootstrapper-notes', title: 'Allowed', body: 'Not a governance seed file.' },
      lax: true,
      overwrite: true,
    })) as AddResp;
    expect(resp?.success).not.toBe(false);
  });
});
