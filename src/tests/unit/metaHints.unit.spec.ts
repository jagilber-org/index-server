/**
 * Tests for _meta hints in search and dispatch responses.
 *
 * Verifies that search and dispatch read-action responses include
 * _meta.afterRetrieval hints directing clients to usage_track and feedback_submit.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { handleInstructionsSearch } from '../../services/handlers.search';
import { ensureLoaded, writeEntry, invalidate } from '../../services/indexContext';

// indexContext import creates the directory as a side effect; check for actual files
const instructionsDir = join(process.cwd(), 'instructions');
const hasInstructions = existsSync(instructionsDir) &&
  readdirSync(instructionsDir).filter(f => f.endsWith('.json')).length > 0;

// Seed a test instruction so search has something to find
function seedInstruction() {
  invalidate();
  const existing = ensureLoaded();
  if (!existing.list.some((e: { id: string }) => e.id === 'meta-hint-test-001')) {
    writeEntry({
      id: 'meta-hint-test-001',
      title: 'Meta hint test instruction for coverage',
      body: 'This instruction exists so the search handler returns results.',
      version: '1.0.0',
      priority: 50,
      audience: 'all',
      requirement: 'optional',
      categories: ['test'],
      contentType: 'instruction',
      sourceHash: 'test-hash-meta-hint',
      schemaVersion: '4',
    } as unknown as Parameters<typeof writeEntry>[0]);
    invalidate();
  }
}

describe.skipIf(!hasInstructions)('_meta hints in search responses', () => {
  beforeEach(() => {
    seedInstruction();
  });

  it('should include _meta.afterRetrieval in successful search results', async () => {
    // Search for terms that match the seeded instruction title
    const result = await handleInstructionsSearch({ keywords: ['coverage'] });
    // If seed didn't persist, try existing index entries
    if (result.totalMatches === 0) {
      const fallback = await handleInstructionsSearch({ keywords: ['instruction'] });
      expect(fallback.totalMatches).toBeGreaterThan(0);
      expect(fallback).toHaveProperty('_meta');
      expect(fallback._meta).toHaveProperty('afterRetrieval');
      expect(Array.isArray(fallback._meta!.afterRetrieval)).toBe(true);
      expect(fallback._meta!.afterRetrieval.length).toBeGreaterThan(0);
      return;
    }
    expect(result).toHaveProperty('_meta');
    expect(result._meta).toHaveProperty('afterRetrieval');
    expect(Array.isArray(result._meta!.afterRetrieval)).toBe(true);
    expect(result._meta!.afterRetrieval.length).toBeGreaterThan(0);
  });

  it('_meta.afterRetrieval should mention usage_track', async () => {
    const result = await handleInstructionsSearch({ keywords: ['instruction'] });
    expect(result.totalMatches).toBeGreaterThan(0);
    const joined = result._meta!.afterRetrieval.join(' ');
    expect(joined).toContain('usage_track');
  });

  it('_meta.afterRetrieval should mention feedback_submit', async () => {
    const result = await handleInstructionsSearch({ keywords: ['instruction'] });
    expect(result.totalMatches).toBeGreaterThan(0);
    const joined = result._meta!.afterRetrieval.join(' ');
    expect(joined).toContain('feedback_submit');
  });

  it('should NOT include _meta when search returns zero results', async () => {
    const result = await handleInstructionsSearch({ keywords: ['zzzznonexistent99999'] });
    expect(result.totalMatches).toBe(0);
    // Zero-result responses get hints, not _meta
    expect(result._meta).toBeUndefined();
  });
});

describe.skipIf(!hasInstructions)('_meta hints in dispatch responses', () => {
  beforeEach(() => {
    seedInstruction();
  });

  it('dispatch get action should include _meta.afterRetrieval', async () => {
    // Import dispatcher dynamically to ensure handler registration
    await import('../../services/instructions.dispatcher.js');
    const { getHandler } = await import('../../server/registry.js');
    const dispatch = getHandler('index_dispatch');
    expect(dispatch).toBeDefined();

    const result = (await dispatch!({ action: 'get', id: 'meta-hint-test-001' })) as Record<string, unknown>;
    expect(result).toHaveProperty('_meta');
    const meta = result._meta as { afterRetrieval: string[] };
    expect(meta).toHaveProperty('afterRetrieval');
    expect(meta.afterRetrieval.some((h: string) => h.includes('usage_track'))).toBe(true);
  });

  it('dispatch list action should include _meta.afterRetrieval', async () => {
    await import('../../services/instructions.dispatcher.js');
    const { getHandler } = await import('../../server/registry.js');
    const dispatch = getHandler('index_dispatch');

    const result = (await dispatch!({ action: 'list' })) as Record<string, unknown>;
    expect(result).toHaveProperty('_meta');
    const meta = result._meta as { afterRetrieval: string[] };
    expect(meta.afterRetrieval.some((h: string) => h.includes('usage_track'))).toBe(true);
  });
});
