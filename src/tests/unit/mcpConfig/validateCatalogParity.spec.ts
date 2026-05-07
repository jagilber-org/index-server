import { describe, expect, it } from 'vitest';
import { buildEnvCatalog, resolveDataPaths } from '../../../services/mcpConfig/flagCatalog';
import { validateConfigObject } from '../../../services/mcpConfig/validate';

// Regression for: setup wizard fails with "env contains unsupported INDEX_SERVER
// key: INDEX_SERVER_MESSAGING_DIR; INDEX_SERVER_AUDIT_LOG" when re-running
// against an existing user mcp.json that already had catalog-emitted keys
// (from prior installs, flag packs, or hand-edited configs).
//
// validate.ts uses DOCUMENTED_INDEX_SERVER_FLAGS as the read-side allow-list,
// so EVERY key the catalog can emit must be documented; otherwise upsertServer
// throws on read of any pre-existing config containing that key.

describe('mcpConfig validate ↔ catalog parity', () => {
  it('accepts a config whose env contains every catalog key (active + inactive)', () => {
    const root = 'C:/repo/index-server';
    const paths = resolveDataPaths(root);
    const catalog = buildEnvCatalog({
      profile: 'experimental',
      root,
      port: 8787,
      host: '127.0.0.1',
      tls: true,
      mutation: true,
      logLevel: 'debug',
    }, paths);
    const env: Record<string, string> = {};
    for (const entry of catalog) {
      if ('key' in entry) env[entry.key] = entry.value || '1';
    }
    const config = {
      servers: {
        'index-server': {
          command: 'node',
          args: ['dist/server/index-server.js'],
          env,
          type: 'stdio',
        },
      },
      inputs: [],
    };
    const result = validateConfigObject('vscode', config);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
