/**
 * Contract tests for the five archive lifecycle tools introduced in
 * spec 006-archive-lifecycle Phase D (D5):
 *   - index_archive (mutation)
 *   - index_restore (mutation)
 *   - index_purgeArchive (mutation, admin-gated)
 *   - index_listArchived (read)
 *   - index_getArchived (read)
 *
 * Verifies registry entry, STABLE/MUTATION classification, TOOL_TIERS,
 * and that index_dispatch advertises the new actions in its enum + that
 * includeArchived/onlyArchived params are present and marked mutually
 * exclusive.
 */

import { describe, it, expect } from 'vitest';
import { getToolRegistry, STABLE, MUTATION } from '../../../services/toolRegistry.js';
import '../../../services/toolHandlers.js';

const ARCHIVE_TOOLS = [
  'index_archive',
  'index_restore',
  'index_purgeArchive',
  'index_listArchived',
  'index_getArchived',
] as const;

interface RegEntry {
  name: string;
  inputSchema?: Record<string, unknown>;
}

function buildIndex(): Map<string, RegEntry> {
  const m = new Map<string, RegEntry>();
  for (const e of getToolRegistry({ tier: 'admin' })) m.set(e.name, e as RegEntry);
  return m;
}

describe('archive lifecycle tools — registry contract', () => {
  const idx = buildIndex();

  it('all five tools appear in the admin-tier registry with an input schema', () => {
    for (const t of ARCHIVE_TOOLS) {
      const e = idx.get(t);
      expect(e, `${t} missing from registry`).toBeDefined();
      expect(e!.inputSchema).toBeDefined();
      expect((e!.inputSchema as { type?: string }).type).toBe('object');
    }
  });

  it('mutation tools are in MUTATION, read tools in STABLE, and never both', () => {
    expect(MUTATION.has('index_archive')).toBe(true);
    expect(MUTATION.has('index_restore')).toBe(true);
    expect(MUTATION.has('index_purgeArchive')).toBe(true);
    expect(STABLE.has('index_listArchived')).toBe(true);
    expect(STABLE.has('index_getArchived')).toBe(true);
    for (const t of ARCHIVE_TOOLS) {
      const both = MUTATION.has(t) && STABLE.has(t);
      expect(both, `${t} classified twice`).toBe(false);
    }
  });

  it('all archive tools appear in admin tier (implicit via getToolRegistry filter above)', () => {
    // The first test only queried tier='admin'; this just asserts non-empty result for each.
    for (const t of ARCHIVE_TOOLS) {
      expect(idx.has(t), `${t} not at admin tier`).toBe(true);
    }
  });

  it('index_archive schema requires ids array', () => {
    const e = idx.get('index_archive')!;
    const s = e.inputSchema as { required?: string[]; properties?: Record<string, unknown> };
    expect(s.required).toContain('ids');
    expect(s.properties?.ids).toBeDefined();
    expect(s.properties?.reason).toBeDefined();
  });

  it('index_restore schema exposes restoreMode enum', () => {
    const s = idx.get('index_restore')!.inputSchema as { properties?: Record<string, { enum?: string[] }> };
    expect(s.properties?.restoreMode?.enum).toEqual(expect.arrayContaining(['reject', 'overwrite']));
  });

  it('index_purgeArchive schema exposes force and dryRun flags', () => {
    const s = idx.get('index_purgeArchive')!.inputSchema as { properties?: Record<string, unknown> };
    expect(s.properties?.force).toBeDefined();
    expect(s.properties?.dryRun).toBeDefined();
  });

  it('index_remove schema exposes mode enum (archive|purge) + purge alias', () => {
    const s = idx.get('index_remove')!.inputSchema as { properties?: Record<string, { enum?: string[]; type?: string }> };
    expect(s.properties?.mode?.enum).toEqual(expect.arrayContaining(['archive', 'purge']));
    expect(s.properties?.purge?.type).toBe('boolean');
  });

  it('index_dispatch advertises the 5 new actions', () => {
    const s = idx.get('index_dispatch')!.inputSchema as { properties?: Record<string, { enum?: string[] }> };
    const actionEnum = s.properties?.action?.enum ?? [];
    for (const a of ['archive', 'restore', 'purgeArchive', 'listArchived', 'getArchived']) {
      expect(actionEnum, `action enum missing ${a}`).toContain(a);
    }
  });

  it('index_dispatch exposes includeArchived/onlyArchived mutex declaration', () => {
    const s = idx.get('index_dispatch')!.inputSchema as { properties?: Record<string, unknown>; not?: { required?: string[] } };
    expect(s.properties?.includeArchived).toBeDefined();
    expect(s.properties?.onlyArchived).toBeDefined();
    expect(s.not?.required).toEqual(expect.arrayContaining(['includeArchived', 'onlyArchived']));
  });
});
