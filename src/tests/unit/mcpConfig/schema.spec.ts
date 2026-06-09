import { describe, expect, it } from 'vitest';
import { validateConfigObject } from '../../../services/mcpConfig/validate';
import type { McpConfigFormat } from '../../../services/mcpConfig/paths';

const validByFormat: Record<McpConfigFormat, Record<string, unknown>> = {
  vscode: {
    servers: {
      'index-server': {
        type: 'stdio',
        command: 'node',
        args: ['dist/server/index-server.js'],
        cwd: 'C:/repo/index-server',
        env: { INDEX_SERVER_PROFILE: 'default', INDEX_SERVER_MUTATION: '1' },
      },
    },
    inputs: [],
  },
  'vscode-global': {
    servers: {
      'index-server': {
        type: 'stdio',
        command: 'node',
        args: ['C:/repo/index-server/dist/server/index-server.js'],
        cwd: 'C:/repo/index-server',
        env: { INDEX_SERVER_PROFILE: 'default' },
      },
    },
    inputs: [],
  },
  'copilot-cli': {
    mcpServers: {
      'index-server': {
        command: 'node',
        args: ['C:/repo/index-server/dist/server/index-server.js'],
        env: { INDEX_SERVER_PROFILE: 'default' },
      },
    },
  },
  claude: {
    mcpServers: {
      'index-server': {
        command: 'node',
        args: ['C:/repo/index-server/dist/server/index-server.js'],
        env: { INDEX_SERVER_PROFILE: 'default' },
      },
    },
  },
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('mcpConfig schema validation matrix', () => {
  it.each(Object.entries(validByFormat) as Array<[McpConfigFormat, Record<string, unknown>]>)(
    'accepts a valid %s config',
    (format, config) => {
      expect(validateConfigObject(format, config).errors).toEqual([]);
      expect(validateConfigObject(format, config).ok).toBe(true);
    },
  );

  it.each(Object.entries(validByFormat) as Array<[McpConfigFormat, Record<string, unknown>]>)(
    'rejects missing required server args for %s',
    (format, config) => {
      const invalid = clone(config);
      const rootKey = format === 'vscode' || format === 'vscode-global' ? 'servers' : 'mcpServers';
      delete ((invalid[rootKey] as Record<string, Record<string, unknown>>)['index-server']).args;
      expect(validateConfigObject(format, invalid).ok).toBe(false);
    },
  );

  it.each(Object.entries(validByFormat) as Array<[McpConfigFormat, Record<string, unknown>]>)(
    'rejects extra top-level keys for %s',
    (format, config) => {
      const invalid = { ...clone(config), unexpectedTopLevelKey: true };
      expect(validateConfigObject(format, invalid).ok).toBe(false);
    },
  );

  it.each(Object.entries(validByFormat) as Array<[McpConfigFormat, Record<string, unknown>]>)(
    'rejects bad env value types for %s',
    (format, config) => {
      const invalid = clone(config);
      const rootKey = format === 'vscode' || format === 'vscode-global' ? 'servers' : 'mcpServers';
      ((invalid[rootKey] as Record<string, { env: Record<string, unknown> }>)['index-server']).env.INDEX_SERVER_MUTATION = 1;
      expect(validateConfigObject(format, invalid).ok).toBe(false);
    },
  );

  it.each(Object.entries(validByFormat) as Array<[McpConfigFormat, Record<string, unknown>]>)(
    'rejects undocumented INDEX_SERVER_* env keys for %s',
    (format, config) => {
      const invalid = clone(config);
      const rootKey = format === 'vscode' || format === 'vscode-global' ? 'servers' : 'mcpServers';
      ((invalid[rootKey] as Record<string, { env: Record<string, unknown> }>)['index-server']).env.INDEX_SERVER_NOT_IN_CATALOG = '1';
      expect(validateConfigObject(format, invalid).ok).toBe(false);
    },
  );

  it('accepts mixed stdio + http servers in a vscode mcp.json (real-world)', () => {
    const config = {
      servers: {
        'index-server': {
          type: 'stdio',
          command: 'node',
          args: ['C:/mcp/index-server/dist/server/index-server.js'],
          env: { INDEX_SERVER_PROFILE: 'default' },
        },
        'microsoft-learn': {
          type: 'http',
          url: 'https://learn.microsoft.com/api/mcp',
        },
        'github-sse': {
          type: 'sse',
          url: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer xyz' },
        },
        'foreign-stdio-with-extras': {
          type: 'stdio',
          command: 'node',
          args: ['server.js'],
          gallery: true,
          dev: { watch: 'src/**/*.ts' },
        },
      },
      inputs: [],
    };
    const result = validateConfigObject('vscode', config);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('accepts mixed stdio + http servers in a copilot-cli config', () => {
    const config = {
      mcpServers: {
        'index-server': {
          command: 'node',
          args: ['dist/server/index-server.js'],
          env: { INDEX_SERVER_PROFILE: 'default' },
        },
        'microsoft-learn': {
          type: 'http',
          url: 'https://learn.microsoft.com/api/mcp',
        },
      },
    };
    const result = validateConfigObject('copilot-cli', config);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('accepts mixed stdio + http servers in a claude config', () => {
    const config = {
      mcpServers: {
        'index-server': {
          command: 'node',
          args: ['dist/server/index-server.js'],
        },
        'remote-mcp': {
          type: 'http',
          url: 'https://example.com/api/mcp',
        },
      },
    };
    const result = validateConfigObject('claude', config);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('rejects an http server missing url', () => {
    const config = {
      servers: {
        'broken-http': { type: 'http' },
      },
      inputs: [],
    };
    expect(validateConfigObject('vscode', config).ok).toBe(false);
  });

  it('rejects an entry whose type is neither stdio nor http nor sse', () => {
    const config = {
      servers: {
        'weird': { type: 'websocket', url: 'wss://example.com' },
      },
      inputs: [],
    };
    expect(validateConfigObject('vscode', config).ok).toBe(false);
  });
});
