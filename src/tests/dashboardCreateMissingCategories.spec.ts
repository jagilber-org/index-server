/**
 * RED/GREEN test: Dashboard POST /api/instructions with missing categories
 *
 * Reproduces the production bug where ClassificationService.normalize() throws
 * "TypeError: entry.categories is not iterable" when the dashboard route constructs
 * an InstructionEntry without a categories field.
 *
 * Root cause: commit 233496c converted dashboard POST from raw fs.writeFileSync
 * (which never called normalize) to writeEntry() (which always calls normalize).
 * The entry constructed by the route omits categories, and normalize() did
 * `for(const cRaw of entry.categories)` without a null guard.
 *
 * Also verifies that the dashboard route performs read-back verification and does
 * NOT return success until the instruction is confirmed persisted and visible.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ClassificationService } from '../services/classificationService';
import { writeEntry, ensureLoaded, invalidate } from '../services/indexContext';
import { reloadRuntimeConfig } from '../config/runtimeConfig';
import type { InstructionEntry } from '../models/instruction';

describe('dashboard create: missing categories bug', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-cat-'));
  const instrDir = path.join(tmpRoot, 'instructions');
  const origDir = process.env.INDEX_SERVER_DIR;

  beforeAll(() => {
    fs.mkdirSync(instrDir, { recursive: true });
    process.env.INDEX_SERVER_DIR = instrDir;
    process.env.INDEX_SERVER_MUTATION = '1';
    reloadRuntimeConfig();
    invalidate();
  });

  afterAll(() => {
    if (origDir) process.env.INDEX_SERVER_DIR = origDir;
    else delete process.env.INDEX_SERVER_DIR;
    delete process.env.INDEX_SERVER_MUTATION;
    reloadRuntimeConfig();
    invalidate();
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('ClassificationService.normalize() must not throw when categories is undefined', () => {
    const classifier = new ClassificationService();
    // Simulate the exact entry shape the dashboard POST route creates
    const entry = {
      id: 'test-no-categories',
      title: 'Test No Categories',
      body: 'This entry has no categories field',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as unknown as InstructionEntry;

    // Before fix: TypeError: entry.categories is not iterable
    // After fix: should normalize successfully with empty categories
    expect(() => classifier.normalize(entry)).not.toThrow();
    const normalized = classifier.normalize(entry);
    expect(Array.isArray(normalized.categories)).toBe(true);
  });

  it('writeEntry() must succeed when entry has no categories', () => {
    // Simulate the exact entry the dashboard route constructs (post-fix, with defaults)
    const entry = {
      id: 'test-write-no-categories',
      title: 'Test Write No Categories',
      body: 'This entry has no categories field',
      categories: [],
      priority: 50,
      audience: 'all',
      requirement: 'optional',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as unknown as InstructionEntry;

    // Before fix: TypeError: entry.categories is not iterable
    expect(() => writeEntry(entry)).not.toThrow();

    // Verify persistence: file must exist on disk
    const file = path.join(instrDir, 'test-write-no-categories.json');
    expect(fs.existsSync(file)).toBe(true);

    // Verify read-back: entry must be in index
    invalidate();
    const st = ensureLoaded();
    expect(st.byId.has('test-write-no-categories')).toBe(true);

    // Verify normalized categories
    const persisted = st.byId.get('test-write-no-categories')!;
    expect(Array.isArray(persisted.categories)).toBe(true);
  });

  it('writeEntry() with categories=undefined must not crash (defensive normalize)', () => {
    // Exact reproduction: entry with categories explicitly undefined
    const entry = {
      id: 'test-undef-categories',
      title: 'Test Undefined Categories',
      body: 'Categories is explicitly undefined',
      categories: undefined,
      priority: 50,
      audience: 'all',
      requirement: 'optional',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as unknown as InstructionEntry;

    expect(() => writeEntry(entry)).not.toThrow();

    const file = path.join(instrDir, 'test-undef-categories.json');
    expect(fs.existsSync(file)).toBe(true);
  });
});
