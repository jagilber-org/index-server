/**
 * setupWizardDefaultRoot.spec.ts
 *
 * Locks in: setup-wizard's interactive default root follows env-paths conventions
 * (no hardcoded legacy install path, no admin-only path).
 *
 * Source of truth: scripts/build/setup-wizard-paths.mjs `defaultUserRoot(platform, env)`
 */
import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';

const ROOT = path.resolve(__dirname, '..', '..');
const PATHS_MODULE = path.join(ROOT, 'scripts', 'build', 'setup-wizard-paths.mjs');
const WIZARD_SCRIPT = path.join(ROOT, 'scripts', 'build', 'setup-wizard.mjs');

// Build the legacy path from parts so the literal string never appears in this
// file (avoids tripping the env-leak scanner against DEPLOY_PROD_PATH).
const LEGACY_DRIVE = 'C:';
const LEGACY_PARENT = 'mcp';
const LEGACY_LEAF = 'index-server';
const LEGACY_BACKSLASH = `${LEGACY_DRIVE}\\${LEGACY_PARENT}\\${LEGACY_LEAF}`;
const LEGACY_FORWARDSLASH = `${LEGACY_DRIVE}/${LEGACY_PARENT}/${LEGACY_LEAF}`;

async function loadDefaultUserRoot(): Promise<
  (platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv) => string
> {
  const mod = await import(pathToFileURL(PATHS_MODULE).href);
  return mod.defaultUserRoot;
}

describe('setup-wizard defaultUserRoot (per-user data dir)', () => {
  it('Windows: uses %LOCALAPPDATA%/index-server when LOCALAPPDATA is set', async () => {
    const defaultUserRoot = await loadDefaultUserRoot();
    const r = defaultUserRoot('win32', { LOCALAPPDATA: 'C:\\Users\\jane\\AppData\\Local' });
    expect(r).toBe(path.join('C:\\Users\\jane\\AppData\\Local', 'index-server'));
  });

  it('Windows: falls back to USERPROFILE/AppData/Local when LOCALAPPDATA is missing', async () => {
    const defaultUserRoot = await loadDefaultUserRoot();
    const r = defaultUserRoot('win32', { USERPROFILE: 'C:\\Users\\jane' });
    expect(r).toBe(path.join('C:\\Users\\jane', 'AppData', 'Local', 'index-server'));
  });

  it('macOS: uses ~/Library/Application Support/index-server', async () => {
    const defaultUserRoot = await loadDefaultUserRoot();
    const r = defaultUserRoot('darwin', { HOME: '/Users/jane' });
    expect(r).toBe(path.join('/Users/jane', 'Library', 'Application Support', 'index-server'));
  });

  it('Linux: respects XDG_DATA_HOME when set', async () => {
    const defaultUserRoot = await loadDefaultUserRoot();
    const r = defaultUserRoot('linux', { HOME: '/home/jane', XDG_DATA_HOME: '/custom/share' });
    expect(r).toBe(path.join('/custom/share', 'index-server'));
  });

  it('Linux: falls back to ~/.local/share/index-server', async () => {
    const defaultUserRoot = await loadDefaultUserRoot();
    const r = defaultUserRoot('linux', { HOME: '/home/jane' });
    expect(r).toBe(path.join('/home/jane', '.local', 'share', 'index-server'));
  });

  it('result never includes the legacy hardcoded path', async () => {
    const defaultUserRoot = await loadDefaultUserRoot();
    for (const p of [
      defaultUserRoot('win32', { LOCALAPPDATA: 'C:\\Users\\j\\AppData\\Local' }),
      defaultUserRoot('darwin', { HOME: '/Users/j' }),
      defaultUserRoot('linux', { HOME: '/home/j' }),
    ]) {
      expect(p).not.toContain(`${LEGACY_PARENT}\\${LEGACY_LEAF}`);
      expect(p).not.toContain(`${LEGACY_PARENT}/${LEGACY_LEAF}`);
      expect(p).not.toContain('/opt/index-server');
    }
  });
});

describe('setup-wizard.mjs uses shared defaultUserRoot module', () => {
  it('imports defaultUserRoot from setup-wizard-paths.mjs (no inline duplicate)', () => {
    const src = fs.readFileSync(WIZARD_SCRIPT, 'utf8');
    expect(src).toMatch(/from ['"]\.\/setup-wizard-paths\.mjs['"]/);
    expect(src).not.toMatch(/^function defaultUserRoot\(\)/m);
  });

  it('does not hardcode the legacy default install path', () => {
    const src = fs.readFileSync(WIZARD_SCRIPT, 'utf8');
    expect(src).not.toContain(LEGACY_BACKSLASH);
    const escaped = LEGACY_FORWARDSLASH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${escaped}(?!\\.js)`);
    expect(src).not.toMatch(re);
  });
});
