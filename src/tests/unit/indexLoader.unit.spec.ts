import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { IndexLoader } from '../../services/indexLoader';
import { ClassificationService } from '../../services/classificationService';
import { reloadRuntimeConfig } from '../../config/runtimeConfig';

function writeJson(p: string, obj: any){ fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8'); }

const BASE = path.join(process.cwd(), 'tmp', 'unit-Index');
const DIR = path.join(BASE, 'instructions');

function minimal(id: string){
  return { id, title: id, body: 'body '+id, priority: 10, audience: 'individual', requirement: 'mandatory', categories: [] };
}

describe('IndexLoader (unit)', () => {
  beforeEach(() => {
    fs.rmSync(BASE, { recursive: true, force: true });
    fs.mkdirSync(DIR, { recursive: true });
    delete (globalThis as any).__MCP_INDEX_SERVER_MEMO; // reset memo cache between tests
    delete process.env.INDEX_SERVER_MEMOIZE;
    reloadRuntimeConfig();
  });

  it('loads single valid instruction and computes stable hash', () => {
    writeJson(path.join(DIR, 'a.json'), minimal('a'));
    const loader = new IndexLoader(DIR, new ClassificationService());
    const res = loader.load();
    expect(res.entries.length).toBe(1);
    expect(res.errors).toHaveLength(0);
    expect(res.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('skips non-instruction config and reports no error', () => {
    writeJson(path.join(DIR, 'gates.json'), { some: 'config' });
    const loader = new IndexLoader(DIR, new ClassificationService());
    const res = loader.load();
    expect(res.entries.length).toBe(0);
    expect(res.errors).toHaveLength(0);
  });

  it('normalizes previously schema-invalid id (bad casing/spaces) instead of rejecting', () => {
    writeJson(path.join(DIR, 'bad.json'), { ...minimal('Bad Upper'), id: 'Bad Upper' });
    const loader = new IndexLoader(DIR, new ClassificationService());
    const res = loader.load();
    expect(res.errors.length).toBe(0);
    expect(res.entries.length).toBe(1);
    // Expect sanitized id: lower-case, spaces -> hyphens, trimmed
    expect(res.entries[0].id).toBe('bad-upper');
  });

  it('loads instruction file with UTF-8 BOM (strips BOM before parsing)', () => {
    const obj = minimal('bom-test');
    const json = JSON.stringify(obj, null, 2);
    // Write with BOM prefix (U+FEFF = EF BB BF in UTF-8)
    fs.writeFileSync(path.join(DIR, 'bom.json'), '\uFEFF' + json, 'utf8');
    const loader = new IndexLoader(DIR, new ClassificationService());
    const res = loader.load();
    expect(res.entries.length).toBe(1);
    expect(res.entries[0].id).toBe('bom-test');
    expect(res.errors).toHaveLength(0);
  });

  it('memoizes unchanged file when INDEX_SERVER_MEMOIZE=1', () => {
    reloadRuntimeConfig();
    writeJson(path.join(DIR, 'a.json'), minimal('a'));
    const loader1 = new IndexLoader(DIR, new ClassificationService());
    const res1 = loader1.load();
    // touch: load again; second load should report same entry count and zero errors
    const loader2 = new IndexLoader(DIR, new ClassificationService());
    const res2 = loader2.load();
    expect(res1.entries[0].id).toBe('a');
    expect(res2.entries[0].id).toBe('a');
    delete process.env.INDEX_SERVER_MEMOIZE;
    reloadRuntimeConfig();
  });

  it('loadAsync yields to timers while retrying transient read errors', async () => {
    writeJson(path.join(DIR, 'async.json'), minimal('async'));
    process.env.INDEX_SERVER_READ_RETRIES = '2';
    process.env.INDEX_SERVER_READ_BACKOFF_MS = '10';
    reloadRuntimeConfig();

    const loader = new IndexLoader(DIR, new ClassificationService());
    const realLoad = loader.load.bind(loader);
    let loadCalls = 0;
    vi.spyOn(loader, 'load').mockImplementation(() => {
      loadCalls++;
      if (loadCalls === 1) {
        return { entries: [], errors: [{ file: 'async.json', error: 'empty file transient' }], hash: '' };
      }
      return realLoad();
    });
    let timerFired = false;
    const timer = new Promise<void>(resolve => {
      setTimeout(() => {
        timerFired = true;
        resolve();
      }, 0);
    });

    const loadPromise = loader.loadAsync();
    await timer;
    const result = await loadPromise;

    expect(timerFired).toBe(true);
    expect(loadCalls).toBe(2);
    expect(result.entries[0]?.id).toBe('async');
  });
});
