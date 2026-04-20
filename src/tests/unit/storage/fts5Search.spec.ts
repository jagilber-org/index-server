/**
 * FTS5 search tests for SqliteStore.
 * TDD RED phase: tests first.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SqliteStore } from '../../../services/storage/sqliteStore.js';
import type { InstructionEntry } from '../../../models/instruction.js';

function makeEntry(overrides: Partial<InstructionEntry> & { id: string }): InstructionEntry {
  const now = new Date().toISOString();
  return {
    title: `Test ${overrides.id}`,
    body: `Body for ${overrides.id}`,
    priority: 50,
    audience: 'all',
    requirement: 'recommended',
    categories: ['test'],
    contentType: 'instruction',
    sourceHash: 'abc',
    schemaVersion: '4',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as InstructionEntry;
}

describe('FTS5 Search (SqliteStore)', () => {
  let store: SqliteStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fts5-test-'));
    store = new SqliteStore(path.join(tmpDir, 'test.db'));
    store.write(makeEntry({ id: 'fts-1', title: 'Authentication Flow', body: 'JWT tokens for login and session management' }));
    store.write(makeEntry({ id: 'fts-2', title: 'Database Schema', body: 'SQLite tables and indexes for performance' }));
    store.write(makeEntry({ id: 'fts-3', title: 'Auth Middleware', body: 'Express authentication guard for API routes' }));
    store.write(makeEntry({ id: 'fts-4', title: 'Logging Guide', body: 'Winston logger configuration and best practices' }));
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds entries by keyword in title via FTS5', () => {
    const results = store.searchFts({ keywords: ['Authentication'] });
    expect(results.length).toBeGreaterThanOrEqual(1);
    const ids = results.map(r => r.id);
    expect(ids).toContain('fts-1');
  });

  it('finds multiple entries with shared token', () => {
    const results = store.searchFts({ keywords: ['authentication'] });
    expect(results.length).toBeGreaterThanOrEqual(2);
    const ids = results.map(r => r.id);
    expect(ids).toContain('fts-1');
    expect(ids).toContain('fts-3');
  });

  it('finds entries by keyword in body via FTS5', () => {
    const results = store.searchFts({ keywords: ['SQLite'] });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe('fts-2');
  });

  it('returns empty for non-matching keyword', () => {
    expect(store.searchFts({ keywords: ['zzz-nope-nothing'] }).length).toBe(0);
  });

  it('respects limit', () => {
    const results = store.searchFts({ keywords: ['Auth'], limit: 1 });
    expect(results.length).toBe(1);
  });

  it('returns results with positive score', () => {
    const results = store.searchFts({ keywords: ['authentication'] });
    results.forEach(r => expect(r.score).toBeGreaterThan(0));
  });

  it('multi-keyword OR search finds broader results', () => {
    const results = store.searchFts({ keywords: ['JWT', 'Winston'] });
    expect(results.length).toBeGreaterThanOrEqual(2);
    const ids = results.map(r => r.id);
    expect(ids).toContain('fts-1');
    expect(ids).toContain('fts-4');
  });

  it('contract search() still works (in-memory fallback)', () => {
    const results = store.search({ keywords: ['Auth'] });
    expect(results.length).toBeGreaterThanOrEqual(2);
  });
});
