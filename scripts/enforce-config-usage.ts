#!/usr/bin/env ts-node
/**
 * Enforcement script to prevent ad-hoc process.env access outside the approved configuration layer.
 *
 * Policy:
 *  - All new environment variable reads must flow through src/config/runtimeConfig.ts
 *  - Allowed direct usages (bootstrap/infra):
 *      - src/config/runtimeConfig.ts (the loader itself)
 *      - vite/vitest config files (coverage instrumentation edge cases)
 *      - playwright.config.ts (external tool integration)
 *      - scripts/ and deployment scripts (initial process wiring)
 *  - Temporary grace: tests may still set process.env (writes) for simulation, but reads should prefer getRuntimeConfig().
 *  - Reads of process.env in tests are flagged unless on allowlist or clearly writing only (assignment LHS or delete operator).
 *
 * Exit codes:
 *  0 = OK
 *  1 = Violations found
 */
import fs from 'fs';
import path from 'path';

interface Violation { file: string; line: number; code: string; reason: string; }

const repoRoot = path.resolve(__dirname, '..');

// Directories to scan
const scanDirs = [
  path.join(repoRoot, 'src'),
];

// File allowlist (exact path endings)
const allowPatterns = [
  /src\\config\\runtimeConfig\.ts$/,
  /vitest\.config\.ts$/,
  /playwright\.config\.ts$/,
];

// Regex to find process.env usages
const envRegex = /process\.env\.([A-Z0-9_]+)/g;

// Allowed variable name prefixes (temporary grace for legacy tests/utilities).
// TODO(guard-allowlist): reduce this list as files migrate to runtimeConfig.
const varAllowPrefixes: string[] = [
  'NODE_',           // Node built-ins like NODE_ENV
  'INDEX_SERVER_TEST_',       // Test-only handshake timing overrides
  'TEST_',           // Legacy test dirs / wait helpers
  'INDEX_SERVER_DASHBOARD_',  // Dashboard integration tests
  'INDEX_SERVER_RUN_',        // Feature-gated red suites
  'SKIP_',           // CI skip toggles
  'DIST_',           // Dist readiness tuning
  'FEEDBACK_',       // Feedback subsystem harness
];

// Explicitly allowed variable names that do not fit the prefix matrix.
const varAllowExact = new Set<string>([
  'CI',
  'INDEX_SERVER_DIR',
  'TEST_INDEX_SERVER_DIR',
  'HANDSHAKE_HARD_FAIL_MS',
  'INDEX_SERVER_MUTATION',
  'INDEX_SERVER_FORCE_REBUILD',
  'INDEX_SERVER_DASHBOARD',
  'VITEST_MAX_WORKERS',
]);

function isAllowFile(file: string): boolean { return allowPatterns.some(r => r.test(file)); }

function walk(dir: string, out: string[]){
  for(const entry of fs.readdirSync(dir)){
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if(stat.isDirectory()){
      // Skip node_modules, dist, snapshots, data, logs
      if(/node_modules|dist|snapshots|data|logs|backup/i.test(full)) continue;
      walk(full, out);
    } else if(/\.(ts|js)$/.test(entry)) {
      out.push(full);
    }
  }
}

function analyzeFile(file: string): Violation[] {
  if(isAllowFile(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const violations: Violation[] = [];
  lines.forEach((line, idx) => {
    if(!line.includes('process.env')) return;
    // Ignore obvious writes: process.env.FOO =, delete process.env.FOO
    if(/process\.env\.[A-Z0-9_]+\s*=/.test(line) || /delete\s+process\.env\.[A-Z0-9_]+/.test(line)) return;
    let m: RegExpExecArray | null;
    envRegex.lastIndex = 0;
    while((m = envRegex.exec(line))){
      const varName = m[1];
  if(varAllowExact.has(varName)) continue;
  if(varAllowPrefixes.some(prefix => varName.startsWith(prefix))) continue;
      // Suggest consolidated alternative naming if not obviously consolidated.
      const suggestion = `Route '${varName}' through runtimeConfig (INDEX_SERVER_* consolidated vars) or add allowlist justification.`;
      violations.push({ file, line: idx+1, code: line.trim(), reason: suggestion });
    }
  });
  return violations;
}

function main(){
  const files: string[] = [];
  for(const d of scanDirs) if(fs.existsSync(d)) walk(d, files);
  const allViolations: Violation[] = [];
  for(const f of files){
    allViolations.push(...analyzeFile(f));
  }
  if(allViolations.length){
    console.error(`\nConfiguration Usage Enforcement Failed: ${allViolations.length} violation(s)\n`);
    for(const v of allViolations){
      console.error(`${v.file}:${v.line}\n  ${v.code}\n  -> ${v.reason}\n`);
    }
    console.error('Add exemptions ONLY if absolutely necessary by updating allowPatterns in scripts/enforce-config-usage.ts');
    process.exit(1);
  } else {
    console.log('Configuration usage enforcement passed (no disallowed direct process.env reads).');
  }
}

if(require.main === module){
  main();
}
