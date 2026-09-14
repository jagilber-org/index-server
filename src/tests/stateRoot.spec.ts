/**
 * stateRoot.spec.ts — STATE_ROOT contract tests.
 *
 * Verifies that all config parsers that produce mutable-state paths resolve
 * under STATE_ROOT, not under CWD or INSTALL_ROOT.
 */
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { STATE_ROOT, CWD, INSTALL_ROOT } from '../config/configUtils.js';

describe('STATE_ROOT resolution', () => {
  it('is an absolute path', () => {
    expect(path.isAbsolute(STATE_ROOT)).toBe(true);
  });

  it('is not the current working directory', () => {
    expect(STATE_ROOT).not.toBe(CWD);
  });

  it('is not the install root', () => {
    expect(STATE_ROOT).not.toBe(INSTALL_ROOT);
  });

  it('ends with index-server', () => {
    expect(path.basename(STATE_ROOT)).toBe('index-server');
  });

  it('uses the platform user-data directory by default', () => {
    if (process.env.INDEX_SERVER_STATE_ROOT) return; // skip if overridden
    if (process.platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      expect(STATE_ROOT).toBe(path.join(localAppData, 'index-server'));
    } else {
      const xdgState = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
      expect(STATE_ROOT).toBe(path.join(xdgState, 'index-server'));
    }
  });
});

describe('config parsers anchor mutable state under STATE_ROOT', () => {
  const saved: Record<string, string | undefined> = {};
  const envKeys = [
    'INDEX_SERVER_FLAGS_FILE',
    'INDEX_SERVER_FEEDBACK_DIR',
    'INDEX_SERVER_MESSAGING_DIR',
    'INDEX_SERVER_SEMANTIC_CACHE_DIR',
    'INDEX_SERVER_EMBEDDING_PATH',
    'INDEX_SERVER_SQLITE_PATH',
    'INDEX_SERVER_STATE_DIR',
    'INDEX_SERVER_METRICS_DIR',
    'INDEX_SERVER_AUDIT_LOG',
    'INDEX_SERVER_TRACE_DIR',
  ];

  beforeEach(() => {
    for (const key of envKeys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('feature flags file resolves under STATE_ROOT', async () => {
    const { parseFeatureFlagsConfig } = await import('../config/featureConfig.js');
    const config = parseFeatureFlagsConfig();
    expect(config.file.startsWith(STATE_ROOT)).toBe(true);
  });

  it('feedback dir resolves under STATE_ROOT', async () => {
    const { parseFeedbackConfig } = await import('../config/featureConfig.js');
    const config = parseFeedbackConfig();
    expect(config.dir.startsWith(STATE_ROOT)).toBe(true);
  });

  it('messaging dir resolves under STATE_ROOT', async () => {
    const { parseMessagingConfig } = await import('../config/featureConfig.js');
    const config = parseMessagingConfig();
    expect(config.dir.startsWith(STATE_ROOT)).toBe(true);
  });

  it('semantic cache dir resolves under STATE_ROOT', async () => {
    const { parseSemanticConfig } = await import('../config/featureConfig.js');
    const config = parseSemanticConfig();
    expect(config.cacheDir.startsWith(STATE_ROOT)).toBe(true);
  });

  it('embedding path resolves under STATE_ROOT', async () => {
    const { parseSemanticConfig } = await import('../config/featureConfig.js');
    const config = parseSemanticConfig();
    expect(config.embeddingPath.startsWith(STATE_ROOT)).toBe(true);
  });

  it('sqlite path resolves under STATE_ROOT', async () => {
    const { parseStorageConfig } = await import('../config/featureConfig.js');
    const config = parseStorageConfig();
    expect(config.sqlitePath.startsWith(STATE_ROOT)).toBe(true);
  });

  it('metrics dir resolves under STATE_ROOT', async () => {
    const { parseMetricsConfig } = await import('../config/serverConfig.js');
    const config = parseMetricsConfig();
    expect(config.dir.startsWith(STATE_ROOT)).toBe(true);
  });

  it('trace dir resolves under STATE_ROOT', async () => {
    const { parseTracingConfig } = await import('../config/serverConfig.js');
    const config = parseTracingConfig(new Set(), 'info');
    expect(config.dir.startsWith(STATE_ROOT)).toBe(true);
  });
});
