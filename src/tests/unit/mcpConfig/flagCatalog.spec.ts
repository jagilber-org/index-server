import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DOCUMENTED_INDEX_SERVER_FLAGS, buildEnvCatalog, resolveDataPaths } from '../../../services/mcpConfig/flagCatalog';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function extractFlags(text: string): string[] {
  return [...new Set(text.match(/\bINDEX_SERVER_[A-Z0-9_]+\b/g) ?? [])].sort();
}

describe('mcpConfig flag catalog drift guard', () => {
  it('contains every INDEX_SERVER_* key documented in configuration docs', () => {
    const docs = ['configuration.md', 'runtime_config_mapping.md']
      .map(file => fs.readFileSync(path.join(ROOT, 'docs', file), 'utf8'))
      .join('\n');
    const documented = extractFlags(docs);
    expect(documented.length).toBeGreaterThan(0);
    const missing = documented.filter(flag => !DOCUMENTED_INDEX_SERVER_FLAGS.includes(flag as never));
    expect(missing).toEqual([]);
  });

  // Inverse of the documented⊆catalog check: every catalog key must also be
  // in DOCUMENTED_INDEX_SERVER_FLAGS, because validate.ts uses DOCUMENTED as
  // the allow-list when reading user mcp.json files. If the catalog ever
  // emits a key that DOCUMENTED doesn't include, upsertServer will throw
  // "env contains unsupported INDEX_SERVER key: …" the next time a user runs
  // `index-server --setup` against an existing config that contains it.
  it('lists every catalog key in DOCUMENTED_INDEX_SERVER_FLAGS (validate.ts allow-list parity)', () => {
    const paths = resolveDataPaths('C:/repo/index-server');
    const catalog = buildEnvCatalog({
      profile: 'experimental',
      root: 'C:/repo/index-server',
      port: 8787,
      host: '127.0.0.1',
      tls: true,
      mutation: true,
      logLevel: 'debug',
    }, paths);
    const catalogKeys = catalog.flatMap(entry => 'key' in entry ? [entry.key] : []);
    const undocumented = catalogKeys.filter(key => !DOCUMENTED_INDEX_SERVER_FLAGS.includes(key as never));
    expect(undocumented).toEqual([]);
  });

  it('surfaces every documented key through buildEnvCatalog metadata', () => {
    const paths = resolveDataPaths('C:/repo/index-server');
    const catalog = buildEnvCatalog({
      profile: 'experimental',
      root: 'C:/repo/index-server',
      port: 8787,
      host: '127.0.0.1',
      tls: true,
      mutation: true,
      logLevel: 'debug',
    }, paths);
    const catalogKeys = catalog.flatMap(entry => 'key' in entry ? [entry.key] : []);
    const missing = DOCUMENTED_INDEX_SERVER_FLAGS.filter(flag => !catalogKeys.includes(flag));
    expect(missing).toEqual([]);
  });

  it('records profile defaults, MCP env visibility, and validation metadata for each variable', () => {
    const paths = resolveDataPaths('C:/repo/index-server');
    const variables = buildEnvCatalog({
      profile: 'default',
      root: 'C:/repo/index-server',
      port: 8787,
      host: '127.0.0.1',
      tls: false,
      mutation: true,
      logLevel: 'info',
    }, paths).filter(entry => 'key' in entry);

    for (const variable of variables) {
      const record = variable as unknown as Record<string, unknown>;
      expect(record).toHaveProperty('defaultByProfile');
      expect(record).toHaveProperty('mcpEnvVisibility');
      expect(record).toHaveProperty('validate');
    }
  });

  it('honors explicit storageBackend / semanticEnabled / backupsDir overrides on the default profile', () => {
    const paths = resolveDataPaths('C:/repo/index-server');
    const catalog = buildEnvCatalog({
      profile: 'default',
      root: 'C:/repo/index-server',
      port: 8787,
      host: '127.0.0.1',
      tls: false,
      mutation: true,
      logLevel: 'info',
      storageBackend: 'sqlite',
      semanticEnabled: true,
      backupsDir: 'D:/backups/index-server',
    }, paths);
    const byKey = Object.fromEntries(
      catalog.flatMap(e => 'key' in e ? [[e.key, e]] : [])
    ) as Record<string, { value: string; active: boolean }>;
    expect(byKey.INDEX_SERVER_STORAGE_BACKEND.value).toBe('sqlite');
    expect(byKey.INDEX_SERVER_STORAGE_BACKEND.active).toBe(true);
    expect(byKey.INDEX_SERVER_SEMANTIC_ENABLED.value).toBe('1');
    expect(byKey.INDEX_SERVER_SEMANTIC_ENABLED.active).toBe(true);
    expect(byKey.INDEX_SERVER_SEMANTIC_LOCAL_ONLY.value).toBe('0');
    expect(byKey.INDEX_SERVER_BACKUPS_DIR.value).toBe('D:/backups/index-server');
    expect(byKey.INDEX_SERVER_BACKUPS_DIR.active).toBe(true);
  });

  it('honors explicit semantic disable on enhanced profile (json + no semantic)', () => {
    const paths = resolveDataPaths('C:/repo/index-server');
    const catalog = buildEnvCatalog({
      profile: 'enhanced',
      root: 'C:/repo/index-server',
      port: 8787,
      host: '127.0.0.1',
      tls: true,
      mutation: true,
      logLevel: 'info',
      storageBackend: 'json',
      semanticEnabled: false,
    }, paths);
    const byKey = Object.fromEntries(
      catalog.flatMap(e => 'key' in e ? [[e.key, e]] : [])
    ) as Record<string, { value: string; active: boolean }>;
    expect(byKey.INDEX_SERVER_SEMANTIC_ENABLED.value).toBe('0');
    expect(byKey.INDEX_SERVER_SEMANTIC_ENABLED.active).toBe(false);
    expect(byKey.INDEX_SERVER_SEMANTIC_LOCAL_ONLY.value).toBe('1');
    expect(byKey.INDEX_SERVER_STORAGE_BACKEND.value).toBe('json');
    expect(byKey.INDEX_SERVER_STORAGE_BACKEND.active).toBe(false);
  });

  it('falls back to profile-derived defaults when overrides are absent', () => {
    const paths = resolveDataPaths('C:/repo/index-server');
    const catalog = buildEnvCatalog({
      profile: 'experimental',
      root: 'C:/repo/index-server',
      port: 8787,
      host: '127.0.0.1',
      tls: true,
      mutation: true,
      logLevel: 'debug',
    }, paths);
    const byKey = Object.fromEntries(
      catalog.flatMap(e => 'key' in e ? [[e.key, e]] : [])
    ) as Record<string, { value: string; active: boolean }>;
    expect(byKey.INDEX_SERVER_STORAGE_BACKEND.value).toBe('sqlite');
    expect(byKey.INDEX_SERVER_SEMANTIC_ENABLED.value).toBe('1');
    expect(byKey.INDEX_SERVER_BACKUPS_DIR.active).toBe(false);
  });
});
