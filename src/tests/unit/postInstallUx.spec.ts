/**
 * Post-Install UX Regression Tests
 *
 * Covers: profile-aware defaults, auto-backup fix, DATA_MESSAGING isolation,
 * and walkthrough media file paths.
 *
 * Red/green: all tests written to fail before the fix, pass after.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { reloadRuntimeConfig, getRuntimeConfig, VALID_PROFILES } from '../../config/runtimeConfig';
import { DIR } from '../../config/dirConstants';

// ── Env var save / restore helper ─────────────────────────────────────────────
const savedEnv: Record<string, string | undefined> = {};

/** Set env vars and record originals for cleanup. */
function setEnv(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) {
    if (!(k in savedEnv)) savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
}

/** Delete env vars and record originals for cleanup. */
function clearEnv(...keys: string[]) {
  for (const k of keys) {
    if (!(k in savedEnv)) savedEnv[k] = process.env[k];
    delete process.env[k];
  }
}

function restoreEnv() {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  // Clear saved state for next test
  for (const k of Object.keys(savedEnv)) delete savedEnv[k];
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. DIR Constants — DATA_MESSAGING exists
// ══════════════════════════════════════════════════════════════════════════════
describe('dirConstants — DATA_MESSAGING', () => {
  it('should define DATA_MESSAGING under data/', () => {
    expect(DIR.DATA_MESSAGING).toBeDefined();
    expect(DIR.DATA_MESSAGING).toContain('data');
    expect(DIR.DATA_MESSAGING).toContain('messaging');
  });

  it('should NOT be equal to DATA (isolated from root data/)', () => {
    expect(DIR.DATA_MESSAGING).not.toBe(DIR.DATA);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. featureConfig — Messaging dir uses DATA_MESSAGING
// ══════════════════════════════════════════════════════════════════════════════
describe('featureConfig — messaging dir isolation', () => {
  afterEach(() => {
    restoreEnv();
    reloadRuntimeConfig();
  });

  it('default messaging dir should end with data/messaging, not just data/', () => {
    clearEnv('INDEX_SERVER_MESSAGING_DIR', 'INDEX_SERVER_PROFILE');
    reloadRuntimeConfig();
    const cfg = getRuntimeConfig();
    const normalized = cfg.messaging.dir.replace(/\\/g, '/');
    expect(normalized).toMatch(/data\/messaging$/);
  });

  it('explicit INDEX_SERVER_MESSAGING_DIR overrides the default', () => {
    setEnv({ INDEX_SERVER_MESSAGING_DIR: '/custom/msg' });
    clearEnv('INDEX_SERVER_PROFILE');
    reloadRuntimeConfig();
    const cfg = getRuntimeConfig();
    const normalized = cfg.messaging.dir.replace(/\\/g, '/');
    expect(normalized).toContain('/custom/msg');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. Auto-backup defaults to true when mutation is enabled
// ══════════════════════════════════════════════════════════════════════════════
describe('runtimeConfig — auto-backup default', () => {
  afterEach(() => {
    restoreEnv();
    reloadRuntimeConfig();
  });

  it('auto-backup should be true when mutation is enabled and AUTO_BACKUP is unset', () => {
    setEnv({ INDEX_SERVER_MUTATION: '1' });
    clearEnv('INDEX_SERVER_AUTO_BACKUP', 'INDEX_SERVER_PROFILE');
    reloadRuntimeConfig();
    const cfg = getRuntimeConfig();
    expect(cfg.mutation.autoBackupEnabled).toBe(true);
  });

  it('auto-backup should be false when mutation is disabled and AUTO_BACKUP is unset', () => {
    clearEnv('INDEX_SERVER_MUTATION', 'INDEX_SERVER_AUTO_BACKUP', 'INDEX_SERVER_PROFILE');
    reloadRuntimeConfig();
    const cfg = getRuntimeConfig();
    expect(cfg.mutation.autoBackupEnabled).toBe(false);
  });

  it('explicit AUTO_BACKUP=0 overrides even when mutation is enabled', () => {
    setEnv({ INDEX_SERVER_MUTATION: '1', INDEX_SERVER_AUTO_BACKUP: '0' });
    clearEnv('INDEX_SERVER_PROFILE');
    reloadRuntimeConfig();
    const cfg = getRuntimeConfig();
    expect(cfg.mutation.autoBackupEnabled).toBe(false);
  });

  it('explicit AUTO_BACKUP=1 works when mutation is disabled', () => {
    clearEnv('INDEX_SERVER_MUTATION');
    setEnv({ INDEX_SERVER_AUTO_BACKUP: '1' });
    clearEnv('INDEX_SERVER_PROFILE');
    reloadRuntimeConfig();
    const cfg = getRuntimeConfig();
    expect(cfg.mutation.autoBackupEnabled).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. Profile system — VALID_PROFILES export & profile defaults
// ══════════════════════════════════════════════════════════════════════════════
describe('runtimeConfig — profile system', () => {
  afterEach(() => {
    restoreEnv();
    reloadRuntimeConfig();
  });

  it('should export VALID_PROFILES with all three profiles', () => {
    expect(VALID_PROFILES).toContain('default');
    expect(VALID_PROFILES).toContain('enhanced');
    expect(VALID_PROFILES).toContain('experimental');
    expect(VALID_PROFILES).toHaveLength(3);
  });

  it('default profile should store "default" in config', () => {
    clearEnv('INDEX_SERVER_PROFILE');
    reloadRuntimeConfig();
    const cfg = getRuntimeConfig();
    expect(cfg.profile).toBe('default');
  });

  it('invalid profile should fallback to "default"', () => {
    setEnv({ INDEX_SERVER_PROFILE: 'bogus' });
    reloadRuntimeConfig();
    const cfg = getRuntimeConfig();
    expect(cfg.profile).toBe('default');
  });

  // ── Enhanced profile ──────────────────────────────────────────────────────
  describe('enhanced profile defaults', () => {
    beforeEach(() => {
      // Clear all vars that the profile would set, so we test profile defaults only
      clearEnv(
        'INDEX_SERVER_SEMANTIC_ENABLED',
        'INDEX_SERVER_SEMANTIC_LOCAL_ONLY',
        'INDEX_SERVER_LOG_FILE',
        'INDEX_SERVER_MUTATION',
        'INDEX_SERVER_DASHBOARD_TLS',
        'INDEX_SERVER_METRICS_FILE_STORAGE',
        'INDEX_SERVER_FEATURES',
        'INDEX_SERVER_DASHBOARD',
        'INDEX_SERVER_STORAGE_BACKEND',
        'INDEX_SERVER_LOG_LEVEL',
        'INDEX_SERVER_AUTO_BACKUP',
      );
      setEnv({ INDEX_SERVER_PROFILE: 'enhanced' });
      reloadRuntimeConfig();
    });

    it('should enable semantic search', () => {
      expect(getRuntimeConfig().semantic.enabled).toBe(true);
    });

    it('should allow remote model download (localOnly=false)', () => {
      expect(getRuntimeConfig().semantic.localOnly).toBe(false);
    });

    it('should enable file logging', () => {
      expect(getRuntimeConfig().logging.file).toBeDefined();
    });

    it('should enable mutation', () => {
      expect(getRuntimeConfig().mutationEnabled).toBe(true);
    });

    it('should enable dashboard TLS', () => {
      expect(getRuntimeConfig().dashboard.http.tls.enabled).toBe(true);
    });

    it('should enable metrics file storage', () => {
      expect(getRuntimeConfig().metrics.fileStorage).toBe(true);
    });

    it('should enable dashboard', () => {
      expect(getRuntimeConfig().dashboard.http.enable).toBe(true);
    });

    it('should NOT use sqlite (stays json)', () => {
      expect(getRuntimeConfig().storage.backend).toBe('json');
    });
  });

  // ── Experimental profile ──────────────────────────────────────────────────
  describe('experimental profile defaults', () => {
    beforeEach(() => {
      clearEnv(
        'INDEX_SERVER_SEMANTIC_ENABLED',
        'INDEX_SERVER_SEMANTIC_LOCAL_ONLY',
        'INDEX_SERVER_LOG_FILE',
        'INDEX_SERVER_MUTATION',
        'INDEX_SERVER_DASHBOARD_TLS',
        'INDEX_SERVER_METRICS_FILE_STORAGE',
        'INDEX_SERVER_FEATURES',
        'INDEX_SERVER_DASHBOARD',
        'INDEX_SERVER_STORAGE_BACKEND',
        'INDEX_SERVER_LOG_LEVEL',
        'INDEX_SERVER_AUTO_BACKUP',
      );
      setEnv({ INDEX_SERVER_PROFILE: 'experimental' });
      reloadRuntimeConfig();
    });

    it('should use sqlite storage backend', () => {
      expect(getRuntimeConfig().storage.backend).toBe('sqlite');
    });

    it('should set log level to debug', () => {
      expect(getRuntimeConfig().logLevel).toBe('debug');
    });

    it('should enable semantic search', () => {
      expect(getRuntimeConfig().semantic.enabled).toBe(true);
    });

    it('should enable mutation', () => {
      expect(getRuntimeConfig().mutationEnabled).toBe(true);
    });

    it('should enable dashboard', () => {
      expect(getRuntimeConfig().dashboard.http.enable).toBe(true);
    });
  });

  // ── Explicit env var overrides profile defaults ───────────────────────────
  describe('explicit env vars override profile defaults', () => {
    it('explicit MUTATION=0 overrides enhanced profile default', () => {
      setEnv({ INDEX_SERVER_PROFILE: 'enhanced', INDEX_SERVER_MUTATION: '0' });
      clearEnv('INDEX_SERVER_SEMANTIC_ENABLED', 'INDEX_SERVER_LOG_FILE',
        'INDEX_SERVER_DASHBOARD_TLS', 'INDEX_SERVER_FEATURES',
        'INDEX_SERVER_DASHBOARD', 'INDEX_SERVER_METRICS_FILE_STORAGE',
        'INDEX_SERVER_SEMANTIC_LOCAL_ONLY', 'INDEX_SERVER_STORAGE_BACKEND',
        'INDEX_SERVER_LOG_LEVEL', 'INDEX_SERVER_AUTO_BACKUP');
      reloadRuntimeConfig();
      // MUTATION was explicitly set before profile defaults run,
      // so applyProfileDefaults won't overwrite it
      expect(getRuntimeConfig().mutationEnabled).toBe(false);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. Walkthrough media paths — must be file paths, not inline markdown
// ══════════════════════════════════════════════════════════════════════════════
describe('VSIX walkthrough media paths', () => {
  const extPkgPath = path.resolve(__dirname, '../../../release/vscode-extension/package.json');
  const extDir = path.dirname(extPkgPath);

  it('package.json should exist in release/vscode-extension', () => {
    expect(fs.existsSync(extPkgPath)).toBe(true);
  });

  it('all walkthrough media.markdown values should be file paths, not inline markdown', () => {
    const pkg = JSON.parse(fs.readFileSync(extPkgPath, 'utf8'));
    const walkthroughs = pkg.contributes?.walkthroughs ?? [];
    for (const wt of walkthroughs) {
      for (const step of wt.steps ?? []) {
        const md = step.media?.markdown;
        if (!md) continue;
        // Must be a relative path ending in .md, not inline markdown starting with ## or #
        expect(md, `step "${step.id}" has inline markdown instead of file path`).toMatch(/\.md$/);
        expect(md, `step "${step.id}" starts with # (inline markdown)`).not.toMatch(/^#/);
      }
    }
  });

  it('all referenced walkthrough .md files should exist on disk', () => {
    const pkg = JSON.parse(fs.readFileSync(extPkgPath, 'utf8'));
    const walkthroughs = pkg.contributes?.walkthroughs ?? [];
    for (const wt of walkthroughs) {
      for (const step of wt.steps ?? []) {
        const md = step.media?.markdown;
        if (!md || !md.endsWith('.md')) continue;
        const fullPath = path.resolve(extDir, md);
        expect(fs.existsSync(fullPath), `missing walkthrough file: ${fullPath}`).toBe(true);
      }
    }
  });
});
