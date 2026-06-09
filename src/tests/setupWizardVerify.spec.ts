/**
 * Setup Wizard `--verify` flag (issue #387)
 *
 * Three covered scenarios per acceptance criteria:
 *   1. Success path  — wizard with `--verify`, valid local dist staged,
 *                      exits 0 and prints "Verify passed".
 *   2. Failure path  — verify helper invoked against a launch spec whose
 *                      resolved entry-point file does not exist; throws an
 *                      actionable Error naming the missing path.
 *   3. No --verify   — wizard without the flag MUST NOT spawn a server or
 *                      print verify output (no behavior change).
 *
 * The success path is the only one that actually spawns a server. The
 * failure path uses the underlying helper directly to keep the suite fast
 * and avoid relying on a broken-install scenario at the CLI level.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  checkLaunchEntryPoint,
  assertLaunchEntryExists,
  verifyServerLaunch,
  type LaunchSpec,
} from '../services/mcpConfig/launchEntryPoint';

const ROOT = path.resolve(__dirname, '..', '..');
const WIZARD_SCRIPT = path.join(ROOT, 'scripts', 'build', 'setup-wizard.mjs');
const IS_WINDOWS = process.platform === 'win32';
const REPO_ENTRY = path.join(ROOT, 'dist', 'server', 'index-server.js');

function stageLocalDist(tmpRoot: string): void {
  const linkPath = path.join(tmpRoot, 'dist');
  fs.symlinkSync(path.join(ROOT, 'dist'), linkPath, IS_WINDOWS ? 'junction' : 'dir');
}

function cleanupTmp(tmpRoot: string, tmpHome: string): void {
  try {
    const link = path.join(tmpRoot, 'dist');
    if (fs.existsSync(link)) fs.unlinkSync(link);
  } catch { /* ignore */ }
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
}

function runWizard(args: string[], tmpHome: string): { status: number | null; stdout: string; stderr: string } {
  const tmpAppData = path.join(tmpHome, 'AppData', 'Roaming');
  fs.mkdirSync(tmpAppData, { recursive: true });
  const result = spawnSync(
    process.execPath,
    [WIZARD_SCRIPT, '--non-interactive', ...args],
    {
      cwd: ROOT,
      env: { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome, APPDATA: tmpAppData },
      encoding: 'utf8',
      timeout: 90_000,
    },
  );
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

describe('Setup wizard --verify flag (issue #387)', () => {
  it(
    'success: --verify spawns server from generated config and reports health_check ok',
    () => {
      // Sanity: repo dist must exist (we run after `npm run build`).
      expect(fs.existsSync(REPO_ENTRY), `prereq: build dist first (${REPO_ENTRY})`).toBe(true);

      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wiz-verify-ok-home-'));
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wiz-verify-ok-root-'));
      try {
        // Stage local dist so resolveServerLaunch picks 'local' without nested install.
        stageLocalDist(tmpRoot);
        const { status, stdout, stderr } = runWizard(
          [
            '--target', 'vscode',
            '--scope', 'repo',
            '--root', tmpRoot,
            '--write',
            '--no-preview',
            '--no-deploy',
            '--verify',
          ],
          tmpHome,
        );
        const combined = `${stdout}\n${stderr}`;
        expect(status, `wizard exit non-zero. output:\n${combined}`).toBe(0);
        expect(combined).toContain('Verifying server launch');
        expect(combined).toMatch(/Verify passed.*health_check status=ok/);
      } finally {
        cleanupTmp(tmpRoot, tmpHome);
      }
    },
    120_000,
  );

  it(
    'failure: verify helper throws actionable error naming missing entry-point',
    async () => {
      const bogusEntry = path.join(os.tmpdir(), 'definitely-not-real-' + Date.now(), 'dist', 'server', 'index-server.js');
      const launch: LaunchSpec = {
        command: 'node',
        args: [bogusEntry],
        source: 'packaged',
      };

      const check = checkLaunchEntryPoint(launch, ROOT);
      expect(check.ok).toBe(false);
      expect(check.resolvedPath).toBe(bogusEntry);
      expect(check.reason).toContain(bogusEntry);

      expect(() => assertLaunchEntryExists(launch, ROOT)).toThrow(/setup-wizard verify/);
      expect(() => assertLaunchEntryExists(launch, ROOT)).toThrow(new RegExp(bogusEntry.replace(/[\\/]/g, '[\\\\/]')));

      // verifyServerLaunch must also surface the same error (with launch details).
      await expect(verifyServerLaunch(launch, { fallbackCwd: ROOT, timeoutMs: 5_000 })).rejects.toThrow(/setup-wizard verify/);
    },
    20_000,
  );

  it(
    'failure: verify reports stderr context when server starts but health_check fails',
    async () => {
      // Synthetic launch: a tiny node script that prints to stderr and exits
      // immediately — no MCP handshake possible. Exercises the error-message
      // formatting path (stderr tail, launch.args echo) without relying on
      // a corrupted real install.
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wiz-verify-fail-'));
      const stubPath = path.join(tmp, 'stub-server.js');
      fs.writeFileSync(
        stubPath,
        `process.stderr.write('FAKE_STDERR_TAIL_MARKER: stub server bailing\\n'); process.exit(1);\n`,
        'utf8',
      );
      const launch: LaunchSpec = {
        command: process.execPath,
        args: [stubPath],
        source: 'packaged',
      };
      try {
        await expect(verifyServerLaunch(launch, { fallbackCwd: ROOT, timeoutMs: 5_000 }))
          .rejects.toThrow(/setup-wizard verify failed/);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it(
    'no --verify: wizard does not spawn a server or print verify output (no behavior change)',
    () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wiz-noverify-home-'));
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wiz-noverify-root-'));
      try {
        stageLocalDist(tmpRoot);
        const { status, stdout, stderr } = runWizard(
          [
            '--target', 'vscode',
            '--scope', 'repo',
            '--root', tmpRoot,
            '--write',
            '--no-preview',
            '--no-deploy',
            // intentionally no --verify
          ],
          tmpHome,
        );
        const combined = `${stdout}\n${stderr}`;
        expect(status, `wizard exit non-zero. output:\n${combined}`).toBe(0);
        expect(combined).not.toContain('Verifying server launch');
        expect(combined).not.toMatch(/Verify passed/);
      } finally {
        cleanupTmp(tmpRoot, tmpHome);
      }
    },
    60_000,
  );

  it(
    'npx launch source skips entry-point existence check (returns ok with null path)',
    () => {
      // For npx-mode launches resolveServerLaunch already gates on isNpxReachable
      // (#386). checkLaunchEntryPoint is a no-op for them — the file doesn't
      // exist locally because npx resolves at runtime.
      const launch: LaunchSpec = {
        command: 'npx',
        args: ['-y', '@jagilber-org/index-server'],
        source: 'npx',
      };
      const check = checkLaunchEntryPoint(launch, ROOT);
      expect(check.ok).toBe(true);
      expect(check.resolvedPath).toBeNull();
      expect(() => assertLaunchEntryExists(launch, ROOT)).not.toThrow();
    },
  );
});
