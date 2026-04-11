import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Global setup: seed deterministic dashboard fixtures before any tests run.
 * This ensures instruction list + log tail + editor regions always exist so we
 * can remove conditional skips in baseline specs.
 */
async function globalSetup() {
  const root = process.cwd();
  const script = path.join(root, 'scripts', 'seed-dashboard-fixtures.mjs');
  if (fs.existsSync(script)) {
    try {
      execFileSync(process.execPath, [script], { stdio: 'inherit', env: { ...process.env, DASH_SEEDED: '1' } });
      process.env.DASH_SEEDED = '1';
    } catch (e) {
      // Do not hard fail entire suite; log and continue (tests may skip gracefully)
      console.error('[global-setup] Seeding script failed:', e);
    }
  } else {
    console.warn('[global-setup] Seed script missing, continuing without deterministic fixtures');
  }
}

export default globalSetup;
