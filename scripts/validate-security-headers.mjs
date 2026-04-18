#!/usr/bin/env node
/**
 * validate-security-headers.mjs
 *
 * CI-friendly security header validation script.
 * Starts a DashboardServer, checks all required security headers,
 * and exits with code 0 (pass) or 1 (fail).
 *
 * Usage:
 *   node scripts/validate-security-headers.mjs              # starts ephemeral server
 *   node scripts/validate-security-headers.mjs http://host:port  # checks existing server
 *   INDEX_SERVER_ALLOW_INSECURE_TLS=1 node scripts/validate-security-headers.mjs https://localhost:8787
 *
 * Can also be imported as a module:
 *   import { validateSecurityHeaders } from './validate-security-headers.mjs';
 *   const result = await validateSecurityHeaders('http://localhost:8787');
 */
import http from 'http';
import https from 'https';

/**
 * @typedef {Object} HeaderCheck
 * @property {string} name - Header name
 * @property {'present'|'absent'|'contains'|'equals'|'matches'} check
 * @property {string} [value] - Expected value (for contains/equals)
 * @property {RegExp} [pattern] - Expected pattern (for matches)
 * @property {string} route - Route to test
 * @property {string} severity - L1/L2/M1/M2/I1/I2 from pen test
 */

/** @type {HeaderCheck[]} */
const HEADER_CHECKS = [
  // L1: Technology fingerprinting
  { name: 'x-powered-by', check: 'absent', route: '/health', severity: 'L1' },

  // Standard security headers
  { name: 'x-content-type-options', check: 'equals', value: 'nosniff', route: '/health', severity: 'L1' },
  { name: 'x-frame-options', check: 'equals', value: 'DENY', route: '/health', severity: 'M1' },
  { name: 'x-xss-protection', check: 'equals', value: '1; mode=block', route: '/health', severity: 'L2' },
  { name: 'referrer-policy', check: 'equals', value: 'strict-origin-when-cross-origin', route: '/health', severity: 'L2' },

  // M1: CSP directives
  { name: 'content-security-policy', check: 'contains', value: "frame-ancestors 'none'", route: '/health', severity: 'M1' },
  { name: 'content-security-policy', check: 'contains', value: "form-action 'self'", route: '/health', severity: 'M1' },
  { name: 'content-security-policy', check: 'contains', value: "default-src 'self'", route: '/health', severity: 'M1' },

  // M2: CSP nonce
  { name: 'content-security-policy', check: 'matches', pattern: /nonce-[A-Za-z0-9+/=]+/, route: '/health', severity: 'M2' },

  // I2: API cache-control
  { name: 'cache-control', check: 'contains', value: 'no-store', route: '/api/status', severity: 'I2' },
  { name: 'pragma', check: 'equals', value: 'no-cache', route: '/api/status', severity: 'I2' },
];

/**
 * Make an HTTP(S) GET request and return headers.
 * @param {string} url
 * @param {boolean} allowInsecureTls
 * @returns {Promise<{status: number, headers: Record<string, string>}>}
 */
function httpGet(url, allowInsecureTls = false) {
  const mod = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    const requestOptions = url.startsWith('https') && allowInsecureTls
      ? { rejectUnauthorized: false } // nosemgrep: semgrep.tree-scan.reject-unauthorized-false, problem-based-packs.insecure-transport.js-node.bypass-tls-verification.bypass-tls-verification -- opt-in flag for validating self-signed cert servers // lgtm[js/disabling-certificate-validation]
      : undefined;
    mod.get(url, requestOptions, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Validate security headers against a running server.
 * @param {string} baseUrl - e.g. 'http://127.0.0.1:8989'
 * @param {{ allowInsecureTls?: boolean }} [options]
 * @returns {Promise<{pass: boolean, failures: string[], checks: number}>}
 */
export async function validateSecurityHeaders(baseUrl, options = {}) {
  const allowInsecureTls = options.allowInsecureTls === true;
  const failures = [];
  const checkedRoutes = new Set();

  // Pre-fetch responses for each unique route
  /** @type {Map<string, {status: number, headers: Record<string, string>}>} */
  const responses = new Map();
  for (const check of HEADER_CHECKS) {
    if (!checkedRoutes.has(check.route)) {
      checkedRoutes.add(check.route);
      try {
        const res = await httpGet(`${baseUrl}${check.route}`, allowInsecureTls);
        responses.set(check.route, res);
      } catch (e) {
        failures.push(`[${check.severity}] Failed to reach ${check.route}: ${e.message}`);
      }
    }
  }

  for (const check of HEADER_CHECKS) {
    const res = responses.get(check.route);
    if (!res) continue;

    const headerValue = res.headers[check.name];

    switch (check.check) {
      case 'absent':
        if (headerValue !== undefined) {
          failures.push(`[${check.severity}] ${check.name} should be absent on ${check.route}, got: ${headerValue}`);
        }
        break;
      case 'present':
        if (headerValue === undefined) {
          failures.push(`[${check.severity}] ${check.name} missing on ${check.route}`);
        }
        break;
      case 'equals':
        if (headerValue !== check.value) {
          failures.push(`[${check.severity}] ${check.name} on ${check.route}: expected "${check.value}", got "${headerValue}"`);
        }
        break;
      case 'contains':
        if (!headerValue || !headerValue.includes(check.value)) {
          failures.push(`[${check.severity}] ${check.name} on ${check.route}: expected to contain "${check.value}", got "${headerValue ?? '(missing)'}"`);
        }
        break;
      case 'matches':
        if (!headerValue || !check.pattern.test(headerValue)) {
          failures.push(`[${check.severity}] ${check.name} on ${check.route}: expected to match ${check.pattern}, got "${headerValue ?? '(missing)'}"`);
        }
        break;
    }
  }

  return {
    pass: failures.length === 0,
    failures,
    checks: HEADER_CHECKS.length,
  };
}

// CLI mode: run directly
const isMain = process.argv[1]?.endsWith('validate-security-headers.mjs');
if (isMain) {
  const targetUrl = process.argv[2];
  const allowInsecureTls = process.env.INDEX_SERVER_ALLOW_INSECURE_TLS === '1';

  if (targetUrl) {
    // Validate against an existing server
    console.log(`Validating security headers against ${targetUrl}...`);
    const result = await validateSecurityHeaders(targetUrl, { allowInsecureTls });
    console.log(`Checked ${result.checks} headers: ${result.pass ? 'PASS' : 'FAIL'}`);
    if (!result.pass) {
      for (const f of result.failures) console.error(`  ✗ ${f}`);
      process.exit(1);
    }
    console.log('All security header checks passed.');
    process.exit(0);
  }

  // Start ephemeral server and validate
  console.log('Starting ephemeral DashboardServer for validation...');
  try {
    // Dynamic import to handle both built and source scenarios
    const { DashboardServer } = await import('../dist/dashboard/server/DashboardServer.js');
    const srv = new DashboardServer({
      host: '127.0.0.1',
      port: 0,
      enableWebSockets: false,
      enableCors: false,
    });
    const info = await srv.start();
    console.log(`Server started at ${info.url}`);

    const result = await validateSecurityHeaders(info.url, { allowInsecureTls });
    console.log(`Checked ${result.checks} headers: ${result.pass ? 'PASS' : 'FAIL'}`);
    if (!result.pass) {
      for (const f of result.failures) console.error(`  ✗ ${f}`);
    } else {
      console.log('All security header checks passed.');
    }

    info.close();
    process.exit(result.pass ? 0 : 1);
  } catch (e) {
    console.error('Failed to start ephemeral server:', e.message);
    console.error('Ensure "npm run build" has been run first.');
    process.exit(1);
  }
}
