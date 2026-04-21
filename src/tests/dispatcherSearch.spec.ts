import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { instructionActions } from '../services/handlers.instructions';
import { invalidate } from '../services/indexContext';
import { reloadRuntimeConfig } from '../config/runtimeConfig';

function writeInstruction(dir: string, entry: Record<string, unknown>): void {
  fs.writeFileSync(path.join(dir, `${entry.id}.json`), JSON.stringify(entry, null, 2));
}

function sourceHashFor(label: string): string {
  return crypto.createHash('sha256').update(label, 'utf8').digest('hex');
}

describe('index_dispatch search action', () => {
  const previousDir = process.env.INDEX_SERVER_DIR;
  let tmpDir = '';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'index-dispatch-search-'));
    process.env.INDEX_SERVER_DIR = tmpDir;
    reloadRuntimeConfig();
    invalidate();

    writeInstruction(tmpDir, {
      id: 'service-mesh-runbook',
      title: 'Mesh Traffic Guide',
      body: 'Traffic policy guidance for proxies and ingress controllers.',
      semanticSummary: 'Platform traffic operations handbook',
      priority: 10,
      audience: 'all',
      requirement: 'recommended',
      categories: ['networking', 'platform'],
      contentType: 'instruction',
      sourceHash: sourceHashFor('service-mesh-runbook'),
      schemaVersion: '1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z'
    });

    writeInstruction(tmpDir, {
      id: 'opaque-cert-guide',
      title: 'Opaque Guide',
      body: 'Proxy rollout safety checks.',
      semanticSummary: 'Cluster certificate rotation playbook',
      priority: 10,
      audience: 'all',
      requirement: 'recommended',
      categories: ['certificates', 'operations'],
      contentType: 'instruction',
      sourceHash: sourceHashFor('opaque-cert-guide'),
      schemaVersion: '1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z'
    });

    writeInstruction(tmpDir, {
      id: 'template-repo-far-match',
      title: 'Governance Notes',
      body: 'Template migration notes for maintainers. Repo lifecycle guidance appears separately. Constitution review steps are in the appendix.',
      priority: 10,
      audience: 'all',
      requirement: 'recommended',
      categories: ['governance', 'templates'],
      contentType: 'instruction',
      sourceHash: sourceHashFor('template-repo-far-match'),
      schemaVersion: '1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z'
    });

    writeInstruction(tmpDir, {
      id: 'template-repo-close-match',
      title: 'Governance Notes',
      body: 'Template repo governance constitution checklist for maintainers.',
      priority: 10,
      audience: 'all',
      requirement: 'recommended',
      categories: ['governance', 'templates'],
      contentType: 'instruction',
      sourceHash: sourceHashFor('template-repo-close-match'),
      schemaVersion: '1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z'
    });
  });

  afterEach(() => {
    invalidate();
    if (previousDir === undefined) delete process.env.INDEX_SERVER_DIR;
    else process.env.INDEX_SERVER_DIR = previousDir;
    reloadRuntimeConfig();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds an instruction by exact id query', async () => {
    const result = await instructionActions.search({ q: 'service-mesh-runbook', limit: 5 }) as {
      count: number;
      items: Array<{ id: string }>;
    };

    expect(result.count).toBeGreaterThan(0);
    expect(result.items[0]?.id).toBe('service-mesh-runbook');
  });

  it('normalizes separators for q-based searches', async () => {
    const result = await instructionActions.search({ q: 'service mesh runbook', limit: 5 }) as {
      count: number;
      items: Array<{ id: string }>;
    };

    expect(result.count).toBeGreaterThan(0);
    expect(result.items.some((item) => item.id === 'service-mesh-runbook')).toBe(true);
  });

  it('searches semanticSummary content for dispatcher search action', async () => {
    const result = await instructionActions.search({ q: 'certificate rotation', limit: 5 }) as {
      count: number;
      items: Array<{ id: string }>;
    };

    expect(result.count).toBeGreaterThan(0);
    expect(result.items[0]?.id).toBe('opaque-cert-guide');
  });

  it('keeps q as a first-class phrase query with split-word fallback ranking', async () => {
    const result = await instructionActions.search({ q: 'template repo constitution', limit: 5 }) as {
      count: number;
      autoTokenized?: boolean;
      query: { keywords: string[] };
      items: Array<{ id: string }>;
    };

    expect(result.count).toBeGreaterThan(1);
    expect(result.autoTokenized).toBe(true);
    expect(result.query.keywords).toEqual(['template', 'repo', 'constitution']);
    expect(result.items[0]?.id).toBe('template-repo-close-match');
  });
});
