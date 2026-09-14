import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

import { getHandler } from '../../server/registry';
import { reloadRuntimeConfig } from '../../config/runtimeConfig';

// Coverage for body-light list/search defaults and opt-in get body pagination.

const TMP_DIR = path.join(process.cwd(), 'tmp', 'body-light-pagination');
const BIG_ID = 'body-light-big';
const BIG_BODY = Array.from({ length: 40 }, (_, i) => `## Section ${i}\nLine content for section ${i} with enough text to matter.`).join('\n\n');

describe('body-light list/search + get pagination', () => {
  let dispatch: (action: string, params: Record<string, any>) => Promise<any>;

  beforeAll(async () => {
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_DIR = TMP_DIR;
    reloadRuntimeConfig();
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    // @ts-expect-error dynamic side-effect import path
    await import('../../services/handlers.instructions');
    // @ts-expect-error dynamic side-effect import path
    await import('../../services/instructions.dispatcher');
    try {
      const gating = await import('../../services/bootstrapGating.js');
      if ((gating as any).forceBootstrapConfirmForTests) {
        (gating as any).forceBootstrapConfirmForTests('bodyLightPagination.spec auto-confirm');
      }
    } catch { /* ignore */ }
    const handler = getHandler('index_dispatch')!;
    dispatch = (action, params) => (handler as any)({ action, ...params });
    await dispatch('add', { entry: { id: BIG_ID, body: BIG_BODY, title: BIG_ID, audience: 'all', requirement: 'optional', priority: 10, categories: ['test', 'body-light'] }, lax: true });
  });

  it('list returns body-light items by default (no full body, has preview + length)', async () => {
    const resp = await dispatch('list', {});
    expect(resp.bodyLight).toBe(true);
    const item = resp.items.find((i: any) => i.id === BIG_ID);
    expect(item).toBeDefined();
    expect(item.body).toBeUndefined();
    expect(item.bodyOmitted).toBe(true);
    expect(item.bodyLength).toBe(BIG_BODY.length);
    expect(item.bodyPreview.length).toBeLessThan(BIG_BODY.length);
    expect(BIG_BODY.startsWith(item.bodyPreview)).toBe(true);
  });

  it('list with includeBody:true returns full body', async () => {
    const resp = await dispatch('list', { includeBody: true });
    expect(resp.bodyLight).toBeUndefined();
    const item = resp.items.find((i: any) => i.id === BIG_ID);
    expect(item.body).toBe(BIG_BODY);
    expect(item.bodyOmitted).toBeUndefined();
  });

  it('search returns body-light items by default and full with includeBody', async () => {
    const light = await dispatch('search', { q: BIG_ID });
    expect(light.bodyLight).toBe(true);
    const li = light.items.find((i: any) => i.id === BIG_ID);
    expect(li.body).toBeUndefined();
    expect(li.bodyLength).toBe(BIG_BODY.length);

    const full = await dispatch('search', { q: BIG_ID, includeBody: true });
    expect(full.bodyLight).toBeUndefined();
    const fi = full.items.find((i: any) => i.id === BIG_ID);
    expect(fi.body).toBe(BIG_BODY);
  });

  it('get returns full body by default (no pagination envelope)', async () => {
    const resp = await dispatch('get', { id: BIG_ID });
    expect(resp.item.body).toBe(BIG_BODY);
    expect(resp.bodyPagination).toBeUndefined();
  });

  it('get with bodyOffset/bodyLimit returns a window + pagination envelope', async () => {
    const page1 = await dispatch('get', { id: BIG_ID, bodyOffset: 0, bodyLimit: 50 });
    expect(page1.item.body).toBe(BIG_BODY.slice(0, 50));
    expect(page1.bodyPagination).toMatchObject({ offset: 0, length: 50, totalBodyLength: BIG_BODY.length, hasMore: true, nextOffset: 50 });

    const page2 = await dispatch('get', { id: BIG_ID, bodyOffset: page1.bodyPagination.nextOffset, bodyLimit: 50 });
    expect(page2.item.body).toBe(BIG_BODY.slice(50, 100));
    expect(page2.bodyPagination.offset).toBe(50);

    // Reassembling pages reconstructs the full body.
    let assembled = '';
    let off = 0;
    for (let i = 0; i < 100; i++) {
      const pg = await dispatch('get', { id: BIG_ID, bodyOffset: off, bodyLimit: 64 });
      assembled += pg.item.body;
      if (!pg.bodyPagination.hasMore) break;
      off = pg.bodyPagination.nextOffset;
    }
    expect(assembled).toBe(BIG_BODY);
  });

  it('get pagination never splits a surrogate pair', async () => {
    const emojiId = 'body-light-emoji';
    const emojiBody = 'a' + '😀😁😂🤣'.repeat(5); // surrogate pairs after a 1-unit char => boundaries land mid-pair
    await dispatch('add', { entry: { id: emojiId, body: emojiBody, title: emojiId, audience: 'all', requirement: 'optional', priority: 10, categories: ['test'] }, lax: true });
    let assembled = '';
    let off = 0;
    for (let i = 0; i < 200; i++) {
      const pg = await dispatch('get', { id: emojiId, bodyOffset: off, bodyLimit: 2 });
      // No lone surrogate at either end of the chunk.
      const c0 = pg.item.body.charCodeAt(0);
      const cl = pg.item.body.charCodeAt(pg.item.body.length - 1);
      expect(c0 >= 0xdc00 && c0 <= 0xdfff).toBe(false); // not starting on a low surrogate
      expect(cl >= 0xd800 && cl <= 0xdbff).toBe(false); // not ending on a high surrogate
      assembled += pg.item.body;
      if (!pg.bodyPagination.hasMore) break;
      off = pg.bodyPagination.nextOffset;
    }
    expect(assembled).toBe(emojiBody);
  });
});
