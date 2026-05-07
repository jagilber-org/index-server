import { describe, expect, it } from 'vitest';
import { parseConfigText, removeConfigText, upsertConfigText } from '../../../services/mcpConfig/formats';

const existingJsonc = `{
  // workspace comment must survive
  "servers": {
    "existing-server": {
      "type": "stdio",
      "command": "node", // inline command comment must survive
      "args": [
        "existing.js",
      ],
    },
  },
  "inputs": []
}`;

const entry = {
  type: 'stdio',
  command: 'node',
  args: ['dist/server/index-server.js'],
  cwd: 'C:/repo/index-server',
  env: { INDEX_SERVER_PROFILE: 'default' },
};

describe('mcpConfig JSONC structural edits', () => {
  it.each(['vscode', 'vscode-global'] as const)(
    'preserves comments, trailing comma compatibility, and existing formatting on %s upsert',
    format => {
      const updated = upsertConfigText(format, existingJsonc, 'index-server', entry);
      expect(updated).toContain('// workspace comment must survive');
      expect(updated).toContain('// inline command comment must survive');
      expect(updated).toContain('"existing-server"');
      expect(updated).toContain('"index-server"');
      expect(parseConfigText(format, updated)).toHaveProperty('servers');
    },
  );

  it.each(['vscode', 'vscode-global'] as const)(
    'preserves comments and leaves valid JSONC after %s remove',
    format => {
      const updated = upsertConfigText(format, existingJsonc, 'index-server', entry);
      const removed = removeConfigText(format, updated, 'index-server');
      expect(removed).toContain('// workspace comment must survive');
      expect(removed).toContain('// inline command comment must survive');
      expect(removed).not.toContain('"index-server"');
      const parsed = parseConfigText(format, removed) as { servers?: Record<string, unknown> };
      expect(parsed.servers?.['existing-server']).toBeTruthy();
    },
  );

  it('fails loudly on malformed existing JSONC instead of overwriting', () => {
    expect(() => upsertConfigText('vscode', '{ "servers": {', 'index-server', entry)).toThrow(/Invalid JSONC/);
  });
});
