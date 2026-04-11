/**
 * TDD Tests: IndexLoader auto-split integration.
 * Verifies that when autoSplitOversized is enabled, the index loader
 * splits oversized entries on disk instead of truncating them.
 *
 * Constitution: A-6 (body size enforcement), A-3 (indexContext single source of truth).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { IndexLoader } from '../services/indexLoader.js';
import { ClassificationService } from '../services/classificationService.js';
import { reloadRuntimeConfig, getRuntimeConfig } from '../config/runtimeConfig.js';

const BASE = path.join(process.cwd(), 'tmp', 'Index-autosplit');
const DIR = path.join(BASE, 'instructions');

function writeJson(p: string, obj: unknown) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}

function makeEntry(id: string, body: string) {
  return {
    id,
    title: `Title for ${id}`,
    body,
    priority: 50,
    audience: 'all',
    requirement: 'recommended',
    categories: ['test'],
    schemaVersion: '0.6.2',
  };
}

describe('IndexLoader auto-split integration', () => {
  let bodyMaxLength: number;

  beforeEach(() => {
    fs.rmSync(BASE, { recursive: true, force: true });
    fs.mkdirSync(DIR, { recursive: true });
    delete (globalThis as any).__MCP_INDEX_SERVER_MEMO;
    process.env.INDEX_SERVER_AUTO_SPLIT_OVERSIZED = '1';
    process.env.INDEX_SERVER_EVENT_SILENT = '1';
    reloadRuntimeConfig();
    bodyMaxLength = getRuntimeConfig().index.bodyMaxLength;
  });

  afterEach(() => {
    delete process.env.INDEX_SERVER_AUTO_SPLIT_OVERSIZED;
    delete process.env.INDEX_SERVER_EVENT_SILENT;
    reloadRuntimeConfig();
    fs.rmSync(BASE, { recursive: true, force: true });
  });

  it('splits oversized entry into multiple index entries', () => {
    const sections = Array.from({ length: 5 }, (_, i) =>
      `## Section ${i + 1}\n\n${'x'.repeat(Math.ceil(bodyMaxLength / 3))}`
    );
    const oversizedBody = sections.join('\n\n');
    writeJson(path.join(DIR, 'big-entry.json'), makeEntry('big-entry', oversizedBody));

    const loader = new IndexLoader(DIR, new ClassificationService());
    const result = loader.load();

    // Should have multiple entries from the split, not just one truncated entry
    expect(result.entries.length).toBeGreaterThan(1);
    // No entry should have id 'big-entry' (the original oversized entry)
    expect(result.entries.find(e => e.id === 'big-entry')).toBeUndefined();
    // All entries should be parts
    for (const entry of result.entries) {
      expect(entry.id).toMatch(/^big-entry-part-\d+$/);
      expect(entry.body.length).toBeLessThanOrEqual(bodyMaxLength);
    }
  });

  it('writes split part files to disk', () => {
    const oversizedBody = '## A\n\n' + 'a'.repeat(bodyMaxLength) + '\n\n## B\n\n' + 'b'.repeat(bodyMaxLength);
    writeJson(path.join(DIR, 'disk-split.json'), makeEntry('disk-split', oversizedBody));

    const loader = new IndexLoader(DIR, new ClassificationService());
    loader.load();

    // Part files should exist on disk
    const files = fs.readdirSync(DIR).filter(f => f.startsWith('disk-split-part-'));
    expect(files.length).toBeGreaterThan(1);
    // Each part file should be valid JSON
    for (const f of files) {
      const content = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
      expect(content.id).toMatch(/^disk-split-part-\d+$/);
    }
  });

  it('archives the original oversized file', () => {
    const oversizedBody = 'x'.repeat(bodyMaxLength + 1000);
    writeJson(path.join(DIR, 'to-archive.json'), makeEntry('to-archive', oversizedBody));

    const loader = new IndexLoader(DIR, new ClassificationService());
    loader.load();

    // Original file should be renamed to .archived
    expect(fs.existsSync(path.join(DIR, 'to-archive.json'))).toBe(false);
    expect(fs.existsSync(path.join(DIR, 'to-archive.json.archived'))).toBe(true);
  });

  it('does not split when autoSplitOversized is disabled (truncates instead)', () => {
    delete process.env.INDEX_SERVER_AUTO_SPLIT_OVERSIZED;
    reloadRuntimeConfig();

    const oversizedBody = 'x'.repeat(bodyMaxLength + 1000);
    writeJson(path.join(DIR, 'no-split.json'), makeEntry('no-split', oversizedBody));

    const loader = new IndexLoader(DIR, new ClassificationService());
    const result = loader.load();

    // Should have exactly one entry — the truncated original
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].id).toBe('no-split');
    expect(result.entries[0].body.length).toBeLessThanOrEqual(bodyMaxLength);
    // No part files should exist on disk
    const partFiles = fs.readdirSync(DIR).filter(f => f.startsWith('no-split-part-'));
    expect(partFiles.length).toBe(0);
  });

  it('tracks split in salvage counts', () => {
    const oversizedBody = '## A\n\n' + 'a'.repeat(bodyMaxLength) + '\n\n## B\n\n' + 'b'.repeat(bodyMaxLength);
    writeJson(path.join(DIR, 'salvage-count.json'), makeEntry('salvage-count', oversizedBody));

    const loader = new IndexLoader(DIR, new ClassificationService());
    const result = loader.load();

    // Summary should report the auto-split salvage action
    expect(result.summary?.salvage).toBeDefined();
    expect(result.summary?.salvage?.bodySplit).toBeGreaterThanOrEqual(1);
  });

  it('split parts pass schema validation', () => {
    const sections = Array.from({ length: 4 }, (_, i) =>
      `## Section ${i + 1}\n\n${'x'.repeat(Math.ceil(bodyMaxLength / 2))}`
    );
    const oversizedBody = sections.join('\n\n');
    writeJson(path.join(DIR, 'valid-parts.json'), makeEntry('valid-parts', oversizedBody));

    const loader = new IndexLoader(DIR, new ClassificationService());
    const result = loader.load();

    // All split parts should pass validation (no errors for split parts)
    expect(result.entries.length).toBeGreaterThan(1);
    const splitErrors = result.errors.filter(e => e.file.includes('valid-parts'));
    expect(splitErrors.length).toBe(0);
  });

  it('does not interfere with normal-sized entries', () => {
    writeJson(path.join(DIR, 'normal.json'), makeEntry('normal', 'Short body'));
    const oversizedBody = 'x'.repeat(bodyMaxLength + 1000);
    writeJson(path.join(DIR, 'huge.json'), makeEntry('huge', oversizedBody));

    const loader = new IndexLoader(DIR, new ClassificationService());
    const result = loader.load();

    // Normal entry should be loaded as-is
    const normal = result.entries.find(e => e.id === 'normal');
    expect(normal).toBeDefined();
    expect(normal!.body).toBe('Short body');
    // Huge entry should be split
    const hugeParts = result.entries.filter(e => e.id.startsWith('huge-part-'));
    expect(hugeParts.length).toBeGreaterThanOrEqual(1);
  });
});
