#!/usr/bin/env node
/**
 * Cross-platform pre-commit hook.
 *
 * Scans target files for:
 *   1. Static secret patterns (AWS keys, GitHub PATs, private keys, etc.)
 *   2. Curated PII and sensitive infrastructure patterns with allowlists
 *   3. Exact sensitive environment variable values present in the shell
 *
 * Does NOT run tests, typecheck, or lint (those belong in CI).
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let errors = 0;

function fail(msg) { console.error(`[FAIL] ${msg}`); errors += 1; }
function info(msg) { console.log(`[INFO] ${msg}`); }

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
  const allowlistPath = path.join(__dirname, '..', '.pii-allowlist');
  if (!existsSync(allowlistPath)) {
    return [];
  }

  return readFileSync(allowlistPath, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

function getTargetFiles(candidateFiles) {
  const selfExclude = /^scripts\/pre-commit\.(ps1|mjs)$/;
  if (candidateFiles.length > 0) {
    return candidateFiles.filter(file => file && existsSync(file) && !selfExclude.test(file));
  }

  try {
    return execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' })
      .split('\n')
      .map(file => file.trim())
      .filter(file => file && existsSync(file) && !selfExclude.test(file));
  } catch {
    return [];
  }
}

function getRegexMatches(line, pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return Array.from(line.matchAll(new RegExp(pattern.source, flags)));
}

console.log('Running pre-commit checks (PII + env-var leak scan)...');

const piiAllowlist = loadPiiAllowlist();
const PII_FILE_ALLOWLIST = new Set(['package-lock.json', 'security-scan.mjs', 'test_results.txt']);

// ── 1. Static secret patterns ─────────────────────────────────────────────
const SECRET_PATTERNS = [
  { pat: /AKIA[0-9A-Z]{16}/, label: 'AWS access key' },
  { pat: /(?:secret[_-]?key|client[_-]?secret|api[_-]?secret)\s*[:=]\s*["']?[A-Za-z0-9/+=]{8,}/i, label: 'secret key assignment' },
  { pat: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/, label: 'private key' },
  { pat: /ghp_[0-9A-Za-z]{36}/, label: 'GitHub PAT' },
  { pat: /gho_[0-9A-Za-z]{36}/, label: 'GitHub OAuth token' },
  { pat: /github_pat_[0-9A-Za-z]{22}_[0-9A-Za-z]{59}/, label: 'GitHub fine-grained PAT' },
  { pat: /sk-[A-Za-z0-9]{20,}/, label: 'OpenAI/API secret key' },
  { pat: /npm_[A-Za-z0-9]{36}/, label: 'npm token' },
  { pat: /xox[bpars]-[0-9A-Za-z-]{10,}/, label: 'Slack token' },
  { pat: /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, label: 'JWT token' },
];

// ── 2. Curated PII and sensitive infrastructure patterns ─────────────────
const PII_PATTERNS = [
  { pat: /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, label: 'Email address' },
  { pat: /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})\b/g, label: 'US phone number' },
  { pat: /\b\d{3}-\d{2}-\d{4}\b/g, label: 'SSN' },
  { pat: /(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)/g, label: 'Public IPv4 address' },
  { pat: /\b(?:\d[ -]?){13,19}\b/g, label: 'Credit card number', requiresLuhn: true },
  { pat: /DefaultEndpointsProtocol=https?;AccountName=[^;]+;AccountKey=[^;]+/gi, label: 'Azure connection string' },
  { pat: /(?:SharedAccessSignature=[^;\s]+|[?&]sig=[A-Za-z0-9%+/=]+)/g, label: 'SAS token' },
  { pat: /\b[a-fA-F0-9]{40}\b/g, label: 'Certificate thumbprint' },
];

// ── 3. Build env-var leak detection map ───────────────────────────────────
const SENSITIVE_ENV_PREFIXES = [
  'AZURE_', 'ARM_', 'AWS_', 'TF_VAR_', 'VITE_AZURE_', 'WEBVIEW_TEST_',
  'NPM_', 'OPENAI_', 'ANTHROPIC_', 'SUBSCRIPTION', 'TENANT', 'CLIENT',
  'ADMIN_', 'SF_', 'DEMO_', 'COST_', 'ADO_', 'AI_', 'USER_TENANT',
  'SECRET_', 'TOKEN_', 'PASSWORD_', 'KEY_', 'CONNECTION_',
];
const SENSITIVE_ENV_EXACT = [
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'FIGMA_API_KEY', 'NPM_TOKEN', 'GITHUB_TOKEN',
  'CODECOV_TOKEN', 'GITHUB_APP_PRIVATE_KEY_FILE', 'GODADDY_API_KEY', 'GODADDY_API_SECRET',
  'AZURE_CLIENT_SECRET', 'AZURE_TENANT_ID', 'AZURE_SUBSCRIPTION_ID', 'AZURE_STORAGE_CONNECTION_STRING',
  'KEY_VAULT_1', 'DEMO_KEY_VAULT_1',
];
const VALUE_ALLOWLIST = new Set([
  'true', 'false', '0', '1', 'yes', 'no', 'null', 'undefined', '',
  'main', 'master', 'eastus', 'westus', 'eastus2', 'westus2', 'centralus',
  'public', 'private', 'default', './exports', './export',
  '00000000-0000-0000-0000-000000000000', 'jagilber',
]);

info('Building env-var leak detection map...');
const envLeakMap = new Map();

for (const [key, value] of Object.entries(process.env)) {
  if (!value || value.length < 8) {
    continue;
  }

  if (VALUE_ALLOWLIST.has(value.toLowerCase())) {
    continue;
  }

  const isSensitive =
    SENSITIVE_ENV_PREFIXES.some(prefix => key.startsWith(prefix)) ||
    SENSITIVE_ENV_EXACT.includes(key) ||
    /SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL|SAS|_PAT$|SUBSCRIPTION|TENANT|CLIENT_ID/i.test(key);

  if (isSensitive) {
    envLeakMap.set(value, key);
  }
}

info(`Monitoring ${envLeakMap.size} sensitive env var values for leaks`);

// ── 4. Scan target files ──────────────────────────────────────────────────
const targets = getTargetFiles(process.argv.slice(2));
info(`Scanning ${targets.length} staged files...`);

for (const file of targets) {
  const normalized = file.replace(/\\/g, '/');
  if ((/(^|\/)\.env$/).test(normalized) || (/(^|\/)\.env\.(?!example$|sample$|template$|test$)[^/]+$/).test(normalized)) {
    fail(`Forbidden sensitive file path committed: ${file}`);
    continue;
  }

  if (testIsBinaryFile(file)) {
    continue;
  }

  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  for (const { pat, label } of SECRET_PATTERNS) {
    if (pat.test(content)) {
      fail(`Secret pattern (${label}) in ${file}`);
    }
  }

  const basename = path.basename(file);
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;

    if (!PII_FILE_ALLOWLIST.has(basename) && !/#\s*pii-allowlist/.test(line)) {
      for (const pattern of PII_PATTERNS) {
        for (const match of getRegexMatches(line, pattern.pat)) {
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

          fail(`PII pattern (${pattern.label}) in ${file}:${lineNumber} -> ${value}`);
        }
      }
    }

    if (line.includes('env-leak-allowlist')) {
      continue;
    }

    for (const [envValue, envName] of envLeakMap.entries()) {
      if (line.includes(envValue)) {
        fail(`ENV VAR LEAK: Value of $${envName} found in ${file}:${lineNumber}`);
      }
    }
  }
}

// ── Result ────────────────────────────────────────────────────────────────
if (errors > 0) {
  console.error('');
  console.error('╔══════════════════════════════════════════════════════════════╗');
  console.error('║  PRE-COMMIT BLOCKED — sensitive content detected!          ║');
  console.error('╠══════════════════════════════════════════════════════════════╣');
  console.error(`║  ${errors} issue(s) found. Fix before committing.`);
  console.error('║                                                            ║');
  console.error('║  Use .pii-allowlist, # pii-allowlist, or env-leak-allowlist║');
  console.error('║  only for intentional false positives with rationale.      ║');
  console.error('╚══════════════════════════════════════════════════════════════╝');
  console.error('');
  process.exit(1);
}
console.log(`Pre-commit checks passed (${targets.length} files scanned, ${envLeakMap.size} env vars monitored).`);
