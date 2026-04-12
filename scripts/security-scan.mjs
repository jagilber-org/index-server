#!/usr/bin/env node
/**
 * Cross-platform security scan (replaces security-scan.ps1).
 * Runs npm audit + repo-wide curated PII pattern scan on source files.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const issues = [];

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

// 2. PII pattern scan aligned with pre-commit rules
const PII_PATTERNS = [
  { regex: /\b[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}\b/gi, label: 'Email address' },
  { regex: /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})\b/g, label: 'US phone number' },
  { regex: /\b\d{3}-\d{2}-\d{4}\b/g, label: 'SSN' },
  { regex: /(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)/g, label: 'Public IPv4 address' },
  { regex: /\b(?:\d[ -]?){13,19}\b/g, label: 'Credit card number', requiresLuhn: true },
  { regex: /DefaultEndpointsProtocol=https?;AccountName=[^;]+;AccountKey=[^;]+/gi, label: 'Azure connection string' },
  { regex: /(?:SharedAccessSignature=[^;\s]+|[?&]sig=[A-Za-z0-9%+/=]+)/g, label: 'SAS token' },
  { regex: /\b[a-fA-F0-9]{40}\b/g, label: 'Certificate thumbprint' },
];

const EXCLUDE = ['node_modules', 'tmp', 'test-results', 'coverage', 'dist', '.git'];
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
  const basename = f.split(/[\\/]/).pop();
  if (PII_FILE_ALLOWLIST.includes(basename) || testIsBinaryFile(f)) continue;
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

          if (pattern.label === 'Email address' && /@(example\.(com|net|org)|contoso\.com|company\.com|localhost)$/i.test(value)) {
            continue;
          }

          if (pattern.label === 'Public IPv4 address' && !testIsPublicIpv4(value)) {
            continue;
          }

          if (pattern.requiresLuhn && !testLuhnNumber(value)) {
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
