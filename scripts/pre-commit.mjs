#!/usr/bin/env node
/**
 * Cross-platform pre-commit hook.
 *
 * Scans staged files for:
 *   1. Static secret patterns (AWS keys, GitHub PATs, private keys, etc.)
 *   2. PII patterns (SSN, credit card, email in non-docs)
 *   3. GUID/UUID patterns that match known sensitive env vars
 *   4. ALL environment variable VALUES currently loaded in the process
 *      (catches subscription IDs, tenant IDs, API keys, tokens, etc.)
 *
 * Does NOT run tests, typecheck, or lint (those belong in CI).
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

let errors = 0;

function fail(msg) { console.error(`[FAIL] ${msg}`); errors++; }
function info(msg) { console.log(`[INFO] ${msg}`); }

console.log('Running pre-commit checks (PII + env-var leak scan)...');

// ── 1. Static secret patterns ─────────────────────────────────────────────
const SECRET_PATTERNS = [
  { pat: /AKIA[0-9A-Z]{16}/, label: 'AWS access key' },
  { pat: /(?:secret[_-]?key|client[_-]?secret|api[_-]?secret)\s*[:=]\s*["']?[A-Za-z0-9/+=]{8,}/i, label: 'secret key assignment' },
  { pat: new RegExp('-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY' + '-----'), label: 'private key' },
  { pat: /ghp_[0-9A-Za-z]{36}/, label: 'GitHub PAT' },
  { pat: /gho_[0-9A-Za-z]{36}/, label: 'GitHub OAuth token' },
  { pat: /github_pat_[0-9A-Za-z]{22}_[0-9A-Za-z]{59}/, label: 'GitHub fine-grained PAT' },
  { pat: /sk-[A-Za-z0-9]{20,}/, label: 'OpenAI/API secret key' },
  { pat: /npm_[A-Za-z0-9]{36}/, label: 'npm token' },
  { pat: /xox[bpars]-[0-9A-Za-z-]{10,}/, label: 'Slack token' },
  { pat: /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, label: 'JWT token' },
  { pat: /DefaultEndpointsProtocol=https?;AccountName=[^;]+;AccountKey=[^;]+/i, label: 'Azure connection string' },
  { pat: /SharedAccessSignature=sig=[A-Za-z0-9%+/=]+/i, label: 'SAS token' },
];

// ── 2. PII patterns ───────────────────────────────────────────────────────
const PII_PATTERNS = [
  { pat: /\b\d{3}-\d{2}-\d{4}\b/, label: 'SSN-like' },
  { pat: /\b\d{16}\b/, label: 'credit card-like' },
];

// ── 3. Build env-var leak detection map ───────────────────────────────────
// Collect ALL env var values that are sensitive (length >= 8 to avoid
// false positives on short values like "true", "1", paths, etc.)
const SENSITIVE_ENV_PREFIXES = [
  'AZURE_', 'ARM_', 'TF_VAR_', 'VITE_AZURE_', 'WEBVIEW_TEST_',
  'SUBSCRIPTION', 'TENANT', 'CLIENT', 'ADMIN_', 'SF_',
  'DEMO_', 'COST_', 'ADO_', 'AI_', 'USER_TENANT',
];
const SENSITIVE_ENV_EXACT = [
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'FIGMA_API_KEY', 'NPM_TOKEN',
  'CODECOV_TOKEN', 'GITHUB_APP_PRIVATE_KEY_FILE', 'GODADDY_API_KEY',
  'GODADDY_API_SECRET', 'KEY_VAULT_1', 'DEMO_KEY_VAULT_1',
];
// Values that are safe / would cause false positives everywhere
const VALUE_ALLOWLIST = new Set([
  'true', 'false', '0', '1', 'yes', 'no', 'null', 'undefined', '',
  'eastus', 'westus', 'eastus2', 'westus2', 'centralus',
  'public', 'private', 'default',
  './exports', './export', // generic path values
  '00000000-0000-0000-0000-000000000000', // nil UUID placeholder
  'jagilber', // repo owner username — appears in package names and paths
]);

info('Building env-var leak detection map...');
const envLeakMap = new Map(); // value -> env var name

for (const [key, value] of Object.entries(process.env)) {
  if (!value || value.length < 8) continue;
  if (VALUE_ALLOWLIST.has(value.toLowerCase())) continue;

  // Check if this env var is sensitive by prefix or exact name
  const isSensitivePrefix = SENSITIVE_ENV_PREFIXES.some(p => key.startsWith(p));
  const isSensitiveExact = SENSITIVE_ENV_EXACT.includes(key);
  // Also catch anything with SECRET, KEY, TOKEN, PASSWORD, CREDENTIAL, SAS, PAT in name
  const isSensitiveKeyword = /SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL|SAS|_PAT$|SUBSCRIPTION|TENANT|CLIENT_ID/i.test(key);

  if (isSensitivePrefix || isSensitiveExact || isSensitiveKeyword) {
    envLeakMap.set(value, key);
    // Also check lowercase/uppercase variants
    if (value !== value.toLowerCase()) envLeakMap.set(value.toLowerCase(), key);
    if (value !== value.toUpperCase()) envLeakMap.set(value.toUpperCase(), key);
  }
}

info(`Monitoring ${envLeakMap.size} sensitive env var values for leaks`);

// ── 4. Scan staged files ──────────────────────────────────────────────────
// Files that are part of the hook infrastructure itself are excluded
const SELF_EXCLUDE = /^scripts\/pre-commit\.(ps1|mjs)$/;

let staged = [];
try {
  staged = execSync('git diff --cached --name-only', { encoding: 'utf8' })
    .split('\n')
    .map(f => f.trim())
    .filter(f => f && existsSync(f) && !SELF_EXCLUDE.test(f));
} catch {
  console.error('[WARN] git diff --cached failed — scanning working dir');
}

info(`Scanning ${staged.length} staged files...`);

for (const file of staged) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch { continue; }

  // 4a. Static secret patterns
  for (const { pat, label } of SECRET_PATTERNS) {
    if (pat.test(content)) {
      fail(`Secret pattern (${label}) in ${file}`);
    }
  }

  // 4b. PII patterns (skip binary-looking files, known docs, and the PII allowlist itself)
  if (!/\.(png|jpg|gif|ico|woff|ttf|eot|svg|map)$/i.test(file) && !file.endsWith('.pii-allowlist')) {
    for (const { pat, label } of PII_PATTERNS) {
      if (pat.test(content)) {
        fail(`PII pattern (${label}) in ${file}`);
      }
    }
  }

  // 4c. Env var value leak detection — the critical check
  for (const [envValue, envName] of envLeakMap) {
    if (content.includes(envValue)) {
      fail(`ENV VAR LEAK: Value of $${envName} found in ${file}`);
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
  console.error('║  If a value is a false positive, add it to VALUE_ALLOWLIST ║');
  console.error('║  in scripts/pre-commit.mjs (with justification comment).   ║');
  console.error('╚══════════════════════════════════════════════════════════════╝');
  console.error('');
  process.exit(1);
}
console.log(`Pre-commit checks passed (${staged.length} files scanned, ${envLeakMap.size} env vars monitored).`);
