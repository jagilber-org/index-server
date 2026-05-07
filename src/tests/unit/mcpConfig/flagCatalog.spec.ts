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
});
