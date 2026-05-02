/**
 * Coverage test for issue #282 fix #2: ensure key INDEX_SERVER_* env vars
 * referenced by `src/config/*.ts` are surfaced in the dashboard FLAG_REGISTRY.
 *
 * Drift detection — when a new env var is added to a config module, this test
 * fails and forces an entry in `handlers.dashboardConfig.FLAG_REGISTRY`.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { FLAG_REGISTRY } from '../services/handlers.dashboardConfig';

// Names referenced solely by tests, deprecated, or intentionally hidden from the dashboard.
const EXCLUDED = new Set<string>([
  // Path / boot internals
  'INDEX_SERVER_ROOT',
  'INDEX_SERVER_HOME',
  'INDEX_SERVER_DATA_DIR',
  'INDEX_SERVER_LOGS_DIR',
  'INDEX_SERVER_WORKSPACE',
  'INDEX_SERVER_INIT_FEATURES',
  'INDEX_SERVER_REFERENCE_MODE',
  'INDEX_SERVER_SHARED_SERVER_SENTINEL',
  // Test-only
  'INDEX_SERVER_TEST_MODE',
  'INDEX_SERVER_TEST_PORT',
  'INDEX_SERVER_COVERAGE_FAST',
  'INDEX_SERVER_COVERAGE_HARD_MIN',
  'INDEX_SERVER_COVERAGE_TARGET',
  'INDEX_SERVER_COVERAGE_STRICT',
  'INDEX_SERVER_TRACE_QUERY_DIAG',
  // Feature-flag namespace marker (matched by prefix scan, not a real var)
  'INDEX_SERVER_FLAG_',
  'INDEX_SERVER_FLAG_RESPONSE_ENVELOPE_V1',
  'INDEX_SERVER_FLAG_TOOLS_EXTENDED',
  'INDEX_SERVER_FLAG_TOOLS_ADMIN',
  'INDEX_SERVER_FEATURES',
  // Internal cache / governance / atomic-write knobs (operator should not flip)
  'INDEX_SERVER_CACHE_MODE',
  'INDEX_SERVER_MEMOIZE',
  'INDEX_SERVER_MEMOIZE_HASH',
  'INDEX_SERVER_ALWAYS_RELOAD',
  'INDEX_SERVER_BUFFER_RING_APPEND',
  'INDEX_SERVER_BUFFER_RING_PRELOAD',
  'INDEX_SERVER_GOV_HASH_HARDENING',
  'INDEX_SERVER_GOV_HASH_CANON_VARIANTS',
  'INDEX_SERVER_GOV_HASH_IMPORT_SET_SIZE',
  'INDEX_SERVER_ATOMIC_WRITE_RETRIES',
  'INDEX_SERVER_ATOMIC_WRITE_BACKOFF_MS',
  'INDEX_SERVER_PREFLIGHT_MODULES',
  'INDEX_SERVER_PREFLIGHT_STRICT',
]);

function scanEnvVars(rootDir: string): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /\.ts$/.test(entry.name)) {
        const txt = fs.readFileSync(full, 'utf8');
        const re = /INDEX_SERVER_[A-Z][A-Z0-9_]+/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(txt)) !== null) found.add(m[0]);
      }
    }
  };
  walk(rootDir);
  return found;
}

describe('FLAG_REGISTRY env-var catalog coverage (issue #282 fix #2)', () => {
  it('every INDEX_SERVER_* env var referenced in src/config/ is registered or excluded', () => {
    const configDir = path.join(process.cwd(), 'src', 'config');
    const referenced = scanEnvVars(configDir);
    const registered = new Set(FLAG_REGISTRY.map(f => f.name));
    const missing: string[] = [];
    for (const name of referenced) {
      if (EXCLUDED.has(name)) continue;
      if (!registered.has(name)) missing.push(name);
    }
    if (missing.length > 0) {
      // Surface the diff loudly so the failure message tells contributors exactly what to add.
      throw new Error(
        `FLAG_REGISTRY missing entries for env vars referenced in src/config/:\n  - ${missing.join('\n  - ')}\n` +
        `Add them to src/services/handlers.dashboardConfig.ts FLAG_REGISTRY, or extend the EXCLUDED list in this test with rationale.`
      );
    }
    expect(missing).toEqual([]);
  });

  it('FLAG_REGISTRY has no duplicate names', () => {
    const seen = new Set<string>();
    const dups: string[] = [];
    for (const f of FLAG_REGISTRY) {
      if (seen.has(f.name)) dups.push(f.name);
      seen.add(f.name);
    }
    expect(dups).toEqual([]);
  });

  it('catalog covers semantic, storage, feedback, messaging, dashboard TLS, and event buffer flags', () => {
    const names = new Set(FLAG_REGISTRY.map(f => f.name));
    const required = [
      'INDEX_SERVER_SEMANTIC_ENABLED',
      'INDEX_SERVER_SEMANTIC_MODEL',
      'INDEX_SERVER_EMBEDDING_PATH',
      'INDEX_SERVER_AUTO_EMBED_ON_IMPORT',
      'INDEX_SERVER_STORAGE_BACKEND',
      'INDEX_SERVER_SQLITE_PATH',
      'INDEX_SERVER_FEEDBACK_DIR',
      'INDEX_SERVER_MESSAGING_DIR',
      'INDEX_SERVER_DASHBOARD_TLS',
      'INDEX_SERVER_EVENT_BUFFER_SIZE',
      'INDEX_SERVER_MAX_CONNECTIONS',
      'INDEX_SERVER_REQUEST_TIMEOUT',
    ];
    for (const r of required) expect(names, `expected ${r}`).toContain(r);
  });
});
