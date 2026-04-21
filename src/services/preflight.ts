import fs from 'fs';
import path from 'path';
import { getRuntimeConfig } from '../config/runtimeConfig';

export interface PreflightCheckResult { name: string; ok: boolean; path?: string; error?: string }
export interface PreflightSummary { ok: boolean; checks: PreflightCheckResult[] }

// List of module specifiers or file probes required at runtime. Adjustable via env overrides.
const DEFAULT_MODULES = [ 'mime-db', 'ajv', 'ajv-formats' ];

function resolveModule(mod: string): PreflightCheckResult {
  try {
    const p = require.resolve(mod);
    return { name: mod, ok: true, path: p };
  } catch (e) {
    return { name: mod, ok: false, error: (e as Error).message };
  }
}

function checkMimeDbData(): PreflightCheckResult {
  try {
    // Some deployments strip nested data; ensure the db.json file exists beneath mime-db
    const base = path.dirname(require.resolve('mime-db'));
    const candidate = path.join(base, 'db.json');
    if (fs.existsSync(candidate)) return { name: 'mime-db:db.json', ok: true, path: candidate };
    return { name: 'mime-db:db.json', ok: false, error: 'db.json not found in resolved mime-db package directory' };
  } catch (e) {
    return { name: 'mime-db:db.json', ok: false, error: (e as Error).message };
  }
}

export function runPreflight(): PreflightSummary {
  const cfg = getRuntimeConfig().preflight;
  const modules = cfg.modules.length ? cfg.modules : DEFAULT_MODULES;
  const checks: PreflightCheckResult[] = [];

  for (const m of modules) checks.push(resolveModule(m));
  // Specialized data file check for mime-db
  if (modules.includes('mime-db')) checks.push(checkMimeDbData());

  const ok = checks.every(c => c.ok);
  return { ok, checks };
}

export function emitPreflightAndMaybeExit(): void {
  try {
    const summary = runPreflight();
    const line = JSON.stringify({ level: summary.ok ? 'info' : 'error', event: 'startup-preflight', ok: summary.ok, checks: summary.checks });
    // stderr to avoid contaminating stdout protocol
    try { process.stderr.write(line + '\n'); } catch { /* ignore */ }
    if (!summary.ok) {
      const cfg = getRuntimeConfig().preflight;
      if (cfg.strict) {
        try { process.stderr.write('[startup] Preflight failed (strict mode) – exiting early.\n'); } catch { /* ignore */ }
        process.exit(1);
      } else {
        try { process.stderr.write('[startup] Preflight reported missing optional dependencies (continuing).\n'); } catch { /* ignore */ }
      }
    }
  } catch (e) {
    try { process.stderr.write(`[startup] preflight_unexpected ${(e as Error).message}\n`); } catch { /* ignore */ }
  }
}
