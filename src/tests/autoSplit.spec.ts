/**
 * TDD Red Tests: Auto-split of oversized instructions on index startup.
 * When agents write instructions directly to disk (bypassing MCP tools),
 * the index loader should detect oversized entries and split them into
 * cross-linked, categorized sub-instructions instead of silently truncating.
 *
 * Constitution: Q-7 (schema-contract), A-3 (indexContext single source of truth).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getRuntimeConfig, reloadRuntimeConfig } from '../config/runtimeConfig';

const TMP_DIR = path.join(process.cwd(), 'tmp', 'auto-split');

describe('auto-split oversized instructions on startup', () => {
  let bodyMaxLength: number;

  beforeAll(() => {
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_DIR = TMP_DIR;
    process.env.INDEX_SERVER_AUTO_SPLIT_OVERSIZED = '1';
    reloadRuntimeConfig();
    bodyMaxLength = getRuntimeConfig().index.bodyMaxLength;
  });

  afterAll(() => {
    delete process.env.INDEX_SERVER_AUTO_SPLIT_OVERSIZED;
  });

  beforeEach(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
  });

  it('splits an oversized entry into multiple files on index load', async () => {
    // Create an oversized instruction file directly on disk (simulating agent bypass)
    const sections = Array.from({ length: 5 }, (_, i) =>
      `## Section ${i + 1}\n\n${'x'.repeat(Math.ceil(bodyMaxLength / 3))}`
    );
    const oversizedBody = sections.join('\n\n');
    const entry = {
      id: 'split-target',
      title: 'Oversized Entry to Split',
      body: oversizedBody,
      priority: 50,
      audience: 'all',
      requirement: 'optional',
      categories: ['test'],
      schemaVersion: '0.6.2'
    };
    fs.writeFileSync(path.join(TMP_DIR, 'split-target.json'), JSON.stringify(entry, null, 2));

    // Dynamically import the auto-split module
    const { splitOversizedEntry } = await import('../services/autoSplit.js');

    const parts = splitOversizedEntry(entry, bodyMaxLength);
    expect(parts.length).toBeGreaterThan(1);
    // Each part should be within limits
    for (const p of parts) {
      expect(p.body.length).toBeLessThanOrEqual(bodyMaxLength);
    }
  });

  it('preserves categories and metadata in split parts', async () => {
    const longBody = '## Part A\n\n' + 'a'.repeat(bodyMaxLength) + '\n\n## Part B\n\n' + 'b'.repeat(bodyMaxLength / 2);
    const entry = {
      id: 'split-meta',
      title: 'Metadata Preservation',
      body: longBody,
      priority: 60,
      audience: 'group',
      requirement: 'recommended',
      categories: ['governance', 'testing'],
      schemaVersion: '0.6.2'
    };

    const { splitOversizedEntry } = await import('../services/autoSplit.js');
    const parts = splitOversizedEntry(entry, bodyMaxLength);

    for (const p of parts) {
      expect(p.priority).toBe(60);
      expect(p.audience).toBe('group');
      expect(p.requirement).toBe('recommended');
      // Categories preserved + original id category added
      expect(p.categories).toContain('governance');
      expect(p.categories).toContain('testing');
    }
  });

  it('adds cross-link references between split parts', async () => {
    const longBody = '## Section 1\n\n' + 'x'.repeat(bodyMaxLength) + '\n\n## Section 2\n\n' + 'y'.repeat(bodyMaxLength / 2);
    const entry = {
      id: 'split-crosslink',
      title: 'Cross-Link Test',
      body: longBody,
      priority: 50,
      audience: 'all',
      requirement: 'optional',
      categories: ['test'],
      schemaVersion: '0.6.2'
    };

    const { splitOversizedEntry } = await import('../services/autoSplit.js');
    const parts = splitOversizedEntry(entry, bodyMaxLength);

    expect(parts.length).toBeGreaterThan(1);
    // Each part's body should reference sibling instruction IDs
    for (const part of parts) {
      const otherIds = parts.filter(p => p.id !== part.id).map(p => p.id);
      for (const otherId of otherIds) {
        expect(part.body).toContain(otherId);
      }
    }
  });

  it('generates sequential IDs from the original entry ID', async () => {
    const longBody = '## A\n\n' + 'a'.repeat(bodyMaxLength) + '\n\n## B\n\n' + 'b'.repeat(bodyMaxLength / 2);
    const entry = {
      id: 'my-big-instruction',
      title: 'Big Instruction',
      body: longBody,
      priority: 50,
      audience: 'all',
      requirement: 'optional',
      categories: ['test'],
      schemaVersion: '0.6.2'
    };

    const { splitOversizedEntry } = await import('../services/autoSplit.js');
    const parts = splitOversizedEntry(entry, bodyMaxLength);

    expect(parts.length).toBeGreaterThan(1);
    for (let i = 0; i < parts.length; i++) {
      expect(parts[i].id).toBe(`my-big-instruction-part-${i + 1}`);
    }
  });

  it('does not split entries already within body limit', async () => {
    const entry = {
      id: 'normal-size',
      title: 'Normal',
      body: 'Short body',
      priority: 50,
      audience: 'all',
      requirement: 'optional',
      categories: ['test'],
      schemaVersion: '0.6.2'
    };

    const { splitOversizedEntry } = await import('../services/autoSplit.js');
    const parts = splitOversizedEntry(entry, bodyMaxLength);

    expect(parts.length).toBe(1);
    expect(parts[0].id).toBe('normal-size');
    expect(parts[0].body).toBe('Short body');
  });

  it('config flag autoSplitOversized is read from runtime config', () => {
    const cfg = getRuntimeConfig();
    expect(cfg.index).toHaveProperty('autoSplitOversized');
    expect(cfg.index.autoSplitOversized).toBe(true);
  });
});
