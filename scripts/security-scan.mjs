#!/usr/bin/env node
/**
 * Cross-platform security scan (replaces security-scan.ps1).
 * Runs npm audit + repo-wide curated PII pattern scan on source files.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const issues = [];
const NPM_BIN = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function testIsBinaryFile(filePath) {
  try {
    return readFileSync(filePath).subarray(0, 8000).includes(0);
  } catch {
    return true;
  }
}

function testLuhnNumber(value) {
  const digits = value.replace(/[^0-9]/g, '');
  if (digits.length < 13 || digits.length > 19) {
    return false;
  }

  let sum = 0;
  let shouldDouble = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number.parseInt(digits[index], 10);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

function testIsPublicIpv4(value) {
  const octets = value.split('.');
  if (octets.length !== 4) {
    return false;
  }

  for (const octet of octets) {
    if (!/^\d+$/.test(octet)) {
      return false;
    }

    const number = Number.parseInt(octet, 10);
    if (number < 0 || number > 255) {
      return false;
    }
  }

  return !/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|255\.|224\.)/.test(value);
}

function loadPiiAllowlist() {
  const allowlistPath = join(process.cwd(), '.pii-allowlist');
  if (!existsSync(allowlistPath)) {
    return [];
  }

  return readFileSync(allowlistPath, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

function getRegexMatches(line, pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return Array.from(line.matchAll(new RegExp(pattern.source, flags)));
}

function runNpmAuditJson() {
  try {
    return JSON.parse(execFileSync(NPM_BIN, ['audit', '--json'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }));
  } catch (error) {
    const stdout = error && typeof error === 'object' && 'stdout' in error
      ? String(error.stdout || '')
      : '';
    if (stdout.trim()) {
      try {
        return JSON.parse(stdout);
      } catch {
        // Fall through to warning below.
      }
    }
    console.warn('Warning: npm audit exited with error — check manually if needed');
    return null;
  }
}

// 1. Dependency audit
console.log('Running security scan...');
const audit = runNpmAuditJson();
if (audit) {
  const total = audit?.metadata?.vulnerabilities?.total ?? 0;
  if (total > 0) issues.push(`Vulnerabilities found: ${total}`);
}

// 2. PII pattern scan aligned with pre-commit rules
const PII_PATTERNS = [
  { regex: /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, label: 'Email address' },
  { regex: /(?<!\d)(?:\+?1[-.\s])?(?:\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4})(?!\d)/g, label: 'US phone number' },
  { regex: /\b\d{3}-\d{2}-\d{4}\b/g, label: 'SSN' },
  { regex: /(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)/g, label: 'Public IPv4 address' },
  { regex: /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g, label: 'Credit card number', requiresLuhn: true },
  { regex: /DefaultEndpointsProtocol=https?;AccountName=[^;]+;AccountKey=[^;]+/gi, label: 'Azure connection string' },
  { regex: /(?:SharedAccessSignature=[^;\s]+|[?&]sig=[A-Za-z0-9%+/=]+)/g, label: 'SAS token' },
  { regex: /\b[a-fA-F0-9]{40}\b/g, label: 'Certificate thumbprint' },
];

// Generated/runtime state lives outside the source review surface for this manual scan.
const EXCLUDE = ['node_modules', 'tmp', 'test-results', 'coverage', 'dist', '.git', 'data', 'metrics', 'backups', '.private', '.squad', '.squad-templates'];
const EXTENSIONS = new Set([
  '.ts', '.js', '.mjs', '.cjs',
  '.md', '.txt', '.json',
  '.yml', '.yaml',
  '.ps1', '.psm1', '.psd1',
]);
const PII_FILE_ALLOWLIST = [
  'credential-pii-system-overview.md',
  'elk.bundled.js',
  'mermaid.min.js',
  'package-lock.json',
  'security-scan.mjs',
  'test_results.txt',
];
// Generated instruction manifests and materialized test artifacts contain stable IDs that
// can trip the manual scan's heuristic detectors without representing actionable secrets.
const PII_PATH_ALLOWLIST = [
  /(?:^|\/)instructions\/_manifest\.json$/,
  /(?:^|\/)instructions\/(?:conc-sem|crud-test)-\d+-.*\.json$/,
  /(?:^|\/)instructions\/unit_p0_materialize_\d+\.json$/,
];
const piiAllowlist = loadPiiAllowlist();

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
  const relPath = relative(process.cwd(), f).replace(/\\/g, '/');
  const basename = f.split(/[\\/]/).pop();
  if (PII_FILE_ALLOWLIST.includes(basename) || PII_PATH_ALLOWLIST.some(pattern => pattern.test(relPath)) || testIsBinaryFile(f)) continue;
  try {
    const text = readFileSync(f, 'utf8');
    const lines = text.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const lineNumber = index + 1;
      if (/#\s*pii-allowlist/.test(line)) {
        continue;
      }

      for (const pattern of PII_PATTERNS) {
        for (const match of getRegexMatches(line, pattern.regex)) {
          const value = match[0];

          if (pattern.label === 'Email address' && /^(git@github\.com|.*@(example\.(com|net|org)|example\.local|contoso\.com|company\.com|localhost|users\.noreply\.github\.com))$/i.test(value)) {
            continue;
          }

          if (pattern.label === 'Public IPv4 address' && !testIsPublicIpv4(value)) {
            continue;
          }

          if (pattern.label === 'Certificate thumbprint' && /^0{40}$/.test(value)) {
            continue;
          }

          if (pattern.requiresLuhn && !testLuhnNumber(value)) {
            continue;
          }

          if (pattern.label === 'Credit card number' && /^0(?:[ -]?0)+$/.test(value)) {
            continue;
          }

          if (pattern.label === 'SAS token' && /scripts\/pre-commit\.(mjs|ps1)$/.test(relPath)) {
            continue;
          }

          if (piiAllowlist.some(entry => new RegExp(entry).test(value))) {
            continue;
          }

          issues.push(`PII-like pattern [${pattern.label}] in ${f}:${lineNumber} -> ${value}`);
        }
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
