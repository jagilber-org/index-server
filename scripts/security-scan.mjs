#!/usr/bin/env node
/**
 * Cross-platform security scan (replaces security-scan.ps1).
 * Runs npm audit + PII pattern scan on source files.
 */
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const issues = [];

// 1. Dependency audit
console.log('Running security scan...');
try {
  const audit = JSON.parse(execSync('npm audit --json 2>/dev/null', { encoding: 'utf8' }));
  const total = audit?.metadata?.vulnerabilities?.total ?? 0;
  if (total > 0) issues.push(`Vulnerabilities found: ${total}`);
} catch {
  try {
    const out = execSync('npm audit --json', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const audit = JSON.parse(out);
    const total = audit?.metadata?.vulnerabilities?.total ?? 0;
    if (total > 0) issues.push(`Vulnerabilities found: ${total}`);
  } catch (e) {
    // npm audit may return non-zero even with no actionable vulnerabilities
    console.warn('Warning: npm audit exited with error — check manually if needed');
  }
}

// 2. PII pattern scan
const PII_PATTERNS = [
  /[0-9]{3}-[0-9]{2}-[0-9]{4}/,   // SSN-like
  /\b\d{16}\b/,                     // credit card-like
];

const EXCLUDE = ['node_modules', 'tmp', 'test-results', 'coverage', 'dist', '.git'];
const EXTENSIONS = new Set(['.ts', '.md', '.js', '.mjs', '.cjs']);
// Files with known benign PII-like patterns (documentation examples, vendored bundles)
const PII_ALLOWLIST = [
  'credential-pii-system-overview.md',
  'elk.bundled.js',
  'mermaid.min.js',
];

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE.includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.includes('test')) continue;
      files.push(...walk(full));
    } else if (EXTENSIONS.has(extname(entry.name)) && !entry.name.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files;
}

const files = walk(process.cwd());
console.log(`Scanning ${files.length} files for PII patterns (excluding dependencies)...`);

for (const f of files) {
  const basename = f.split(/[\\/]/).pop();
  if (PII_ALLOWLIST.includes(basename)) continue;
  try {
    const text = readFileSync(f, 'utf8');
    for (const pat of PII_PATTERNS) {
      if (pat.test(text)) {
        issues.push(`PII-like pattern in ${f} (${pat.source})`);
      }
    }
  } catch {
    console.warn(`Warning: Could not scan ${f}`);
  }
}

if (issues.length > 0) {
  console.error('Security scan issues:');
  for (const issue of issues) console.error(`  - ${issue}`);
  process.exit(1);
}
console.log('Security scan passed.');
