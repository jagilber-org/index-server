import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Set mutation env before imports
process.env.INDEX_SERVER_MUTATION = '1';
process.env.INDEX_SERVER_BOOTSTRAP_AUTOCONFIRM = '1';

import { ensureLoaded, invalidate, getInstructionsDir } from '../services/indexContext';
import { reloadRuntimeConfig } from '../config/runtimeConfig';
import type { InstructionEntry } from '../models/instruction';

// Side-effect: register promote_from_repo handler
import '../services/handlers.promote';
import { getHandler } from '../server/registry';

const TMP_BASE = path.join(process.cwd(), 'tmp', `promote-test-${Date.now()}`);

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath: string, data: unknown) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function makeMinimalInstruction(id: string, extra?: Partial<InstructionEntry>): Record<string, unknown> {
  return {
    id,
    title: `Test instruction: ${id}`,
    body: `Body content for ${id}`,
    priority: 50,
    audience: 'all',
    requirement: 'recommended',
    categories: ['test'],
    contentType: 'instruction',
    sourceHash: sha256(`Body content for ${id}`),
    schemaVersion: '4',
    version: '1.0.0',
    status: 'approved',
    owner: 'test',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...extra,
  };
}

// Track created instruction files for cleanup
const createdInstructionFiles: string[] = [];

function cleanupInstructionFiles() {
  for (const f of createdInstructionFiles) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignore */ }
  }
  createdInstructionFiles.length = 0;
}

/** Invoke the registered (async-wrapped) handler and return the inner result. */
async function callPromote(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const handler = getHandler('promote_from_repo')!;
  return await handler(params) as Record<string, unknown>;
}

describe('promote_from_repo', () => {
  beforeEach(() => {
    // Clean temp repo dir
    if (fs.existsSync(TMP_BASE)) fs.rmSync(TMP_BASE, { recursive: true, force: true });
    fs.mkdirSync(TMP_BASE, { recursive: true });
    invalidate();
    reloadRuntimeConfig();
  });

  afterEach(() => {
    // Cleanup temp dir
    try {
      if (fs.existsSync(TMP_BASE)) fs.rmSync(TMP_BASE, { recursive: true, force: true });
    } catch { /* ignore */ }
    // Cleanup any instructions written to the Index
    cleanupInstructionFiles();
    invalidate();
  });

  it('is registered as a handler', () => {
    const handler = getHandler('promote_from_repo');
    expect(handler).toBeDefined();
    expect(typeof handler).toBe('function');
  });

  it('returns error for missing repoPath', async () => {
    const result = await callPromote({ repoPath: '' });
    expect(result.error).toBeDefined();
  });

  it('returns error for non-existent repoPath', async () => {
    const result = await callPromote({ repoPath: path.join(TMP_BASE, 'nonexistent') });
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe('string');
    expect((result.error as string)).toContain('does not exist');
  });

  it('handles empty repo (no promotion map, no instructions)', async () => {
    const repoDir = path.join(TMP_BASE, 'empty-repo');
    ensureDir(repoDir);

    const result = await callPromote({ repoPath: repoDir });
    expect(result.total).toBe(0);
    expect(result.promoted).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  describe('promotion-map.json', () => {
    it('promotes sources listed in promotion-map.json', async () => {
      const repoDir = path.join(TMP_BASE, 'map-repo');
      ensureDir(repoDir);

      // Create content file
      const constitutionContent = '# My Constitution\nRules for the repo.';
      fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(repoDir, 'docs', 'constitution.md'), constitutionContent);

      // Create promotion map
      const promotionMap = {
        description: 'Test promotion map',
        sources: [
          {
            path: 'docs/constitution.md',
            instructionId: 'test-promote-constitution',
            title: 'Test Constitution',
            category: 'governance',
            priority: 5,
            requirement: 'mandatory',
            contentType: 'instruction',
            classification: 'internal',
          },
        ],
      };
      writeJson(path.join(repoDir, '.specify', 'config', 'promotion-map.json'), promotionMap);

      const result = await callPromote({ repoPath: repoDir });
      expect(result.promoted).toContain('test-promote-constitution');
      expect(result.total).toBe(1);
      expect(result.repoId).toBe('map-repo');

      // Track for cleanup
      const instrDir = getInstructionsDir();
      createdInstructionFiles.push(path.join(instrDir, 'test-promote-constitution.json'));

      // Verify entry exists in index (writeEntry updates in-memory state)
      const st = ensureLoaded();
      const entry = st.byId.get('test-promote-constitution');
      expect(entry).toBeDefined();
      expect(entry!.title).toBe('Test Constitution');
      expect(entry!.body).toBe(constitutionContent);
      expect(entry!.sourceWorkspace).toBe('map-repo');
      expect(entry!.categories).toContain('governance');
      expect(entry!.categories).toContain('map-repo');
    });

    it('skips sources with missing files', async () => {
      const repoDir = path.join(TMP_BASE, 'missing-file-repo');
      ensureDir(repoDir);

      const promotionMap = {
        sources: [
          {
            path: 'nonexistent.md',
            instructionId: 'test-promote-missing',
            title: 'Missing File',
            category: 'docs',
            priority: 50,
            requirement: 'optional',
            contentType: 'instruction',
            classification: 'internal',
          },
        ],
      };
      writeJson(path.join(repoDir, '.specify', 'config', 'promotion-map.json'), promotionMap);

      const result = await callPromote({ repoPath: repoDir });
      expect(result.total).toBe(0);
      expect(result.promoted).toEqual([]);
    });
  });

  describe('instructions/*.json', () => {
    it('promotes valid instruction JSON files', async () => {
      const repoDir = path.join(TMP_BASE, 'instr-repo');
      ensureDir(repoDir);

      const instr = makeMinimalInstruction('test-promote-instr-file');
      writeJson(path.join(repoDir, 'instructions', 'test-promote-instr-file.json'), instr);

      const result = await callPromote({ repoPath: repoDir });
      expect(result.promoted).toContain('test-promote-instr-file');

      // Track for cleanup
      createdInstructionFiles.push(path.join(getInstructionsDir(), 'test-promote-instr-file.json'));

      // Verify in index (writeEntry updates in-memory state)
      const st = ensureLoaded();
      expect(st.byId.has('test-promote-instr-file')).toBe(true);
    });

    it('skips files starting with underscore', async () => {
      const repoDir = path.join(TMP_BASE, 'underscore-repo');
      ensureDir(repoDir);

      writeJson(path.join(repoDir, 'instructions', '_manifest.json'), { id: 'should-skip' });
      writeJson(path.join(repoDir, 'instructions', 'test-promote-valid.json'),
        makeMinimalInstruction('test-promote-valid'));

      const result = await callPromote({ repoPath: repoDir });
      expect(result.promoted).toContain('test-promote-valid');
      expect(result.promoted).not.toContain('should-skip');

      createdInstructionFiles.push(path.join(getInstructionsDir(), 'test-promote-valid.json'));
    });

    it('skips malformed JSON files (missing title+body)', async () => {
      const repoDir = path.join(TMP_BASE, 'malformed-repo');
      ensureDir(repoDir);

      // File missing required fields
      writeJson(path.join(repoDir, 'instructions', 'bad-entry.json'), { id: 'bad', foo: 'bar' });

      const result = await callPromote({ repoPath: repoDir });
      // Missing title+body means it's silently skipped during scan (not promoted)
      expect(result.promoted).not.toContain('bad');
    });
  });

  describe('scope filtering', () => {
    it('filters by governance scope', async () => {
      const repoDir = path.join(TMP_BASE, 'scope-repo');
      ensureDir(repoDir);

      fs.writeFileSync(path.join(repoDir, 'governance.md'), '# Governance');
      fs.writeFileSync(path.join(repoDir, 'spec.md'), '# Spec');

      const promotionMap = {
        sources: [
          { path: 'governance.md', instructionId: 'test-promote-gov', title: 'Gov', category: 'governance', priority: 5, requirement: 'mandatory', contentType: 'instruction', classification: 'internal' },
          { path: 'spec.md', instructionId: 'test-promote-spec', title: 'Spec', category: 'spec', priority: 10, requirement: 'recommended', contentType: 'instruction', classification: 'internal' },
        ],
      };
      writeJson(path.join(repoDir, '.specify', 'config', 'promotion-map.json'), promotionMap);

      const result = await callPromote({ repoPath: repoDir, scope: 'governance' });
      expect(result.promoted).toContain('test-promote-gov');
      expect(result.promoted).not.toContain('test-promote-spec');

      createdInstructionFiles.push(path.join(getInstructionsDir(), 'test-promote-gov.json'));
    });
  });

  describe('content hash dedup', () => {
    it('skips unchanged entries on second promote', async () => {
      const repoDir = path.join(TMP_BASE, 'dedup-repo');
      ensureDir(repoDir);

      const instr = makeMinimalInstruction('test-promote-dedup');
      writeJson(path.join(repoDir, 'instructions', 'test-promote-dedup.json'), instr);

      // First promote
      const r1 = await callPromote({ repoPath: repoDir });
      expect(r1.promoted).toContain('test-promote-dedup');

      createdInstructionFiles.push(path.join(getInstructionsDir(), 'test-promote-dedup.json'));

      // Second promote — should skip (hash unchanged, in-memory state already updated)
      const r2 = await callPromote({ repoPath: repoDir });
      expect(r2.skipped).toContain('test-promote-dedup');
      expect(r2.promoted).not.toContain('test-promote-dedup');
    });

    it('re-promotes when file content changes', async () => {
      const repoDir = path.join(TMP_BASE, 'dedup-change-repo');
      ensureDir(repoDir);

      const instr = makeMinimalInstruction('test-promote-dedup-change');
      writeJson(path.join(repoDir, 'instructions', 'test-promote-dedup-change.json'), instr);

      await callPromote({ repoPath: repoDir });
      createdInstructionFiles.push(path.join(getInstructionsDir(), 'test-promote-dedup-change.json'));

      // Modify the file
      const modified = { ...instr, body: 'Updated body content' };
      writeJson(path.join(repoDir, 'instructions', 'test-promote-dedup-change.json'), modified);

      const r2 = await callPromote({ repoPath: repoDir });
      expect(r2.promoted).toContain('test-promote-dedup-change');
    });
  });

  describe('force flag', () => {
    it('re-promotes even when hash matches', async () => {
      const repoDir = path.join(TMP_BASE, 'force-repo');
      ensureDir(repoDir);

      const instr = makeMinimalInstruction('test-promote-forced');
      writeJson(path.join(repoDir, 'instructions', 'test-promote-forced.json'), instr);

      await callPromote({ repoPath: repoDir });
      createdInstructionFiles.push(path.join(getInstructionsDir(), 'test-promote-forced.json'));

      const r2 = await callPromote({ repoPath: repoDir, force: true });
      expect(r2.promoted).toContain('test-promote-forced');
      expect(r2.skipped).not.toContain('test-promote-forced');
    });
  });

  describe('dryRun mode', () => {
    it('returns preview without writing', async () => {
      const repoDir = path.join(TMP_BASE, 'dryrun-repo');
      ensureDir(repoDir);

      const instr = makeMinimalInstruction('test-promote-dryrun');
      writeJson(path.join(repoDir, 'instructions', 'test-promote-dryrun.json'), instr);

      const result = await callPromote({ repoPath: repoDir, dryRun: true });

      // Should NOT have actually written
      expect(result.promoted).toEqual([]);
      const entries = result.dryRunEntries as Array<{ id: string; title: string; action: string }>;
      expect(entries).toBeDefined();
      expect(entries.length).toBeGreaterThan(0);
      expect(entries[0].id).toBe('test-promote-dryrun');
      expect(entries[0].action).toBe('add');

      // Verify not in Index
      const st = ensureLoaded();
      expect(st.byId.has('test-promote-dryrun')).toBe(false);
    });
  });

  describe('repoId override', () => {
    it('uses custom repoId in categories and sourceWorkspace', async () => {
      const repoDir = path.join(TMP_BASE, 'repoid-repo');
      ensureDir(repoDir);

      const instr = makeMinimalInstruction('test-promote-repoid');
      writeJson(path.join(repoDir, 'instructions', 'test-promote-repoid.json'), instr);

      const result = await callPromote({ repoPath: repoDir, repoId: 'custom-repo-name' });
      expect(result.repoId).toBe('custom-repo-name');
      expect(result.promoted).toContain('test-promote-repoid');

      createdInstructionFiles.push(path.join(getInstructionsDir(), 'test-promote-repoid.json'));

      const st = ensureLoaded();
      const entry = st.byId.get('test-promote-repoid');
      expect(entry).toBeDefined();
      expect(entry!.sourceWorkspace).toBe('custom-repo-name');
      expect(entry!.categories).toContain('custom-repo-name');
    });
  });
});
