import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DOCUMENTED_INDEX_SERVER_FLAGS } from '../../../services/mcpConfig/flagCatalog';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');

// Keys read only by tests / coverage tooling. They never appear in a user
// mcp.json, so they don't need to be in the validate.ts allow-list.
const TEST_ONLY_PREFIXES = [
  'INDEX_SERVER_TEST_',
  'INDEX_SERVER_COVERAGE_',
];

// Synthetic prefix tokens that show up because of dynamic
// `INDEX_SERVER_${suffix}` usage. These aren't real env keys.
const PREFIX_FRAGMENTS = new Set([
  'INDEX_SERVER_DASHBOARD_TLS_', // dynamic *_CERT/*_KEY/*_CA suffix builder
  'INDEX_SERVER_FLAG_',          // dynamic flag prefix
  'INDEX_SERVER_STRICT_',
  'INDEX_SERVER_TRACE_',
  'INDEX_SERVER_TRACE_BUFFER_',
]);

// Tokens that look like INDEX_SERVER_* but appear only inside string
// literals (filenames, doc references) and are never read from process.env.
const FALSE_POSITIVE_TOKENS = new Set([
  'INDEX_SERVER_TOOL_ACTIVATION_IMPROVEMENT_PLAN', // .md filename in a docstring
]);

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (/node_modules|dist|test-artifacts|test-results/.test(full)) continue;
      walk(full, files);
    } else if (/\.(ts|mjs|js)$/.test(entry.name) && !/\.spec\.|\.test\./.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function collectRuntimeFlags(): Set<string> {
  const flags = new Set<string>();
  // Match INDEX_SERVER_* only when preceded by a non-identifier char (or start
  // of string), so `__MCP_INDEX_SERVER_MEMO` (a global symbol name) doesn't
  // pollute the set.
  const re = /(?<![A-Za-z0-9_])INDEX_SERVER_[A-Z0-9_]+/g;
  for (const file of walk(SRC_ROOT)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(re)) {
      flags.add(match[0]);
    }
  }
  return flags;
}

function isExempt(key: string): boolean {
  if (PREFIX_FRAGMENTS.has(key)) return true;
  if (FALSE_POSITIVE_TOKENS.has(key)) return true;
  if (key.endsWith('_')) return true; // trailing-underscore prefix tokens
  for (const prefix of TEST_ONLY_PREFIXES) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

// Regression for: setup wizard threw "env contains unsupported INDEX_SERVER
// key: ..." when re-run against a config containing a real runtime flag the
// allow-list never enumerated. This guard scans the entire src/ tree and
// asserts every INDEX_SERVER_* key the runtime reads is in DOCUMENTED, so the
// validate.ts allow-list cannot fall behind any new feature flag.
describe('mcpConfig runtime ↔ DOCUMENTED parity (validate allow-list completeness)', () => {
  it('every INDEX_SERVER_* key referenced in src/ (excluding tests) is in DOCUMENTED_INDEX_SERVER_FLAGS', () => {
    const runtime = [...collectRuntimeFlags()].sort();
    const docs = new Set<string>(DOCUMENTED_INDEX_SERVER_FLAGS);
    const undocumented = runtime.filter(key => !docs.has(key) && !isExempt(key));
    expect(undocumented, `Runtime keys missing from DOCUMENTED_INDEX_SERVER_FLAGS:\n  ${undocumented.join('\n  ')}`).toEqual([]);
  });
});
