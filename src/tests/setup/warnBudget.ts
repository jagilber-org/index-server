/**
 * Vitest setup file: per-process WARN/ERROR budget (opt-in).
 *
 * Activation:  set INDEX_SERVER_WARN_BUDGET=1 (default budget) or pass an
 *              integer max-repeat: INDEX_SERVER_WARN_BUDGET=10
 *
 * Behaviour: wraps logger.logWarn / logger.logError to count emissions per
 * fingerprint. After the test run, fails the suite if any single
 * fingerprint exceeded the budget. Off by default so existing 971 tests
 * are unaffected; CI's primary log-hygiene enforcement is the
 * crawl-logs.mjs gate that runs after the suite. This file is for
 * interactive debugging when investigating noise.
 *
 * Wire it in by adding to vitest config setupFiles when needed:
 *   setupFiles: ['./src/tests/setup/warnBudget.ts']
 */
import { afterAll, beforeAll } from 'vitest';

const ENV = 'INDEX_SERVER_WARN_BUDGET';
const allowlist: RegExp[] = [
  /EXPERIMENTAL: SQLite (storage )?backend/,
];
const counts = new Map<string, { level: 'WARN' | 'ERROR'; count: number; sample: string }>();
let budget = 0;

function fingerprint(msg: unknown): string {
  if (typeof msg !== 'string') return '<non-string>';
  return msg
    .replace(/\b\d{4}-\d{2}-\d{2}T[\d:.Z+-]+\b/g, '<ts>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<hash>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}
function isAllowlisted(msg: string): boolean {
  return allowlist.some(rx => rx.test(msg));
}
function bump(level: 'WARN' | 'ERROR', msg: unknown) {
  const sig = fingerprint(msg);
  if (typeof msg === 'string' && isAllowlisted(msg)) return;
  const cur = counts.get(sig);
  if (cur) cur.count++;
  else counts.set(sig, { level, count: 1, sample: typeof msg === 'string' ? msg : String(msg) });
}

beforeAll(async () => {
  const raw = process.env[ENV];
  if (!raw || raw === '0') return;
  budget = /^\d+$/.test(raw) ? parseInt(raw, 10) : 25;

  // Best-effort instrumentation: tap the logger module if it exposes
  // logWarn/logError. Use a soft import so a non-existent path does not
  // break the test run.
  try {
    const mod = await import('../../services/logger.js');
    const orig = { warn: mod.logWarn, error: mod.logError };
    (mod as unknown as { logWarn: typeof mod.logWarn }).logWarn = ((m: unknown, ...rest: unknown[]) => {
      bump('WARN', m);
      return orig.warn(m as string, ...rest);
    }) as typeof mod.logWarn;
    (mod as unknown as { logError: typeof mod.logError }).logError = ((m: unknown, ...rest: unknown[]) => {
      bump('ERROR', m);
      return orig.error(m as string, ...rest);
    }) as typeof mod.logError;
  } catch {
    // Logger not loadable in this context; budget falls back to console capture.
  }

  const origConsoleWarn = console.warn.bind(console);
  const origConsoleError = console.error.bind(console);
  console.warn = (...args: unknown[]) => { bump('WARN', args[0]); return origConsoleWarn(...args); };
  console.error = (...args: unknown[]) => { bump('ERROR', args[0]); return origConsoleError(...args); };
});

afterAll(() => {
  if (budget === 0) return;
  const offenders = [...counts.entries()]
    .filter(([, v]) => v.count > budget)
    .sort((a, b) => b[1].count - a[1].count);
  if (offenders.length === 0) return;
  const lines = offenders.map(([sig, v]) =>
    `  ${v.count}× [${v.level}] ${sig.slice(0, 120)}\n      first: ${v.sample.slice(0, 200)}`
  ).join('\n');
  // Throwing in afterAll fails the suite — the message lands in vitest output.
  throw new Error(
    `[warnBudget] ${offenders.length} signature(s) exceeded budget=${budget}:\n${lines}`,
  );
});
