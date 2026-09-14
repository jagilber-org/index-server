/**
 * Issue #578: network-privacy.md must agree with applyProfileDefaults.
 *
 * Verifies that the documented default values for network-relevant variables
 * match what the code actually sets via applyProfileDefaults(). Prevents
 * the doc from drifting silently after a profile-default change.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { loadRuntimeConfig } from '../../config/runtimeConfig';

const NETWORK_VARS = [
  'INDEX_SERVER_DASHBOARD',
  'INDEX_SERVER_SEMANTIC_ENABLED',
  'INDEX_SERVER_SEMANTIC_LOCAL_ONLY',
] as const;

/** Read a repo-root-relative document. */
function readDoc(rel: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../', rel), 'utf-8');
}

function getProfileDefaults(profile: string): Record<string, string | undefined> {
  for (const k of NETWORK_VARS) { delete process.env[k]; }
  process.env.INDEX_SERVER_PROFILE = profile;
  loadRuntimeConfig();
  const result: Record<string, string | undefined> = {};
  for (const k of NETWORK_VARS) { result[k] = process.env[k]; }
  return result;
}

describe('issue #578: network-privacy.md agrees with applyProfileDefaults', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of [...NETWORK_VARS, 'INDEX_SERVER_PROFILE']) {
      savedEnv[k] = process.env[k];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v !== undefined) process.env[k] = v; else delete process.env[k];
    }
  });

  it('default profile enables dashboard', () => {
    const defaults = getProfileDefaults('default');
    expect(defaults.INDEX_SERVER_DASHBOARD).toBe('1');
  });

  it('default profile does not enable semantic search', () => {
    const defaults = getProfileDefaults('default');
    expect(defaults.INDEX_SERVER_SEMANTIC_ENABLED).toBeUndefined();
  });

  it('enhanced profile enables semantic with remote downloads', () => {
    const defaults = getProfileDefaults('enhanced');
    expect(defaults.INDEX_SERVER_DASHBOARD).toBe('1');
    expect(defaults.INDEX_SERVER_SEMANTIC_ENABLED).toBe('1');
    expect(defaults.INDEX_SERVER_SEMANTIC_LOCAL_ONLY).toBe('0');
  });

  it('network-privacy.md documents dashboard default as 1 (on)', () => {
    const docPath = path.resolve(__dirname, '../../../docs/network-privacy.md');
    const doc = fs.readFileSync(docPath, 'utf-8');
    const match = doc.match(/\|\s*`INDEX_SERVER_DASHBOARD`\s*\|\s*`(\d)`/);
    expect(match, 'dashboard default row must exist in network-privacy.md').toBeTruthy();
    expect(match![1]).toBe('1');
  });

  it('network-privacy.md per-profile table matches code for default profile', () => {
    const doc = readDoc('docs/network-privacy.md');

    // Anchor to the per-profile section. The previous version of this case
    // matched /`INDEX_SERVER_DASHBOARD`\s*\|\s*`1`/ against the WHOLE file,
    // which resolves to the same row the case above already checks — so the
    // per-profile table had no coverage at all despite appearing to have two
    // assertions.
    const section = doc.slice(doc.indexOf('### Per-profile defaults'));
    expect(section.length, 'Per-profile defaults section must exist').toBeGreaterThan(0);

    const dashRow = section.match(/\|\s*`INDEX_SERVER_DASHBOARD`\s*\|\s*`1`/);
    expect(dashRow, 'per-profile table must document dashboard as 1').toBeTruthy();

    const semRow = section.match(/\|\s*`INDEX_SERVER_SEMANTIC_ENABLED`\s*\|\s*`0`\s*\(off\)/);
    expect(semRow, 'per-profile table must document semantic as 0 for default').toBeTruthy();
  });

  // ── The claims #578 was actually filed against ──────────────────────────
  //
  // PR #602 rewrote docs/network-privacy.md, but the same assertions lived in
  // PRIVACY.md and THIRD-PARTY-LICENSES.md, which it did not touch. PRIVACY.md
  // is the file README.md points readers to for exactly this question, and
  // README.md ships in the npm tarball while PRIVACY.md and docs/ do not — so
  // the package advertised a privacy policy it did not contain and that
  // contradicted the code.
  //
  // These assert on ABSENCE of the false claim. A doc can be reworded freely;
  // it just cannot go back to saying the outbound paths are all off by default,
  // or that a default install opens no listener.

  it('no document claims all three outbound paths are disabled by default', () => {
    for (const rel of ['PRIVACY.md', 'docs/network-privacy.md']) {
      expect(
        readDoc(rel),
        `${rel} still claims all three outbound paths are off by default; the dashboard is on for every profile`,
      ).not.toMatch(/All three are disabled by default/i);
    }
  });

  it('no document claims the default configuration opens no network listener', () => {
    // The dashboard listens on 127.0.0.1 by default on every profile.
    expect(
      readDoc('PRIVACY.md'),
      'PRIVACY.md still asserts "no network listeners" for the default configuration',
    ).not.toMatch(/no network listeners and no outbound connections/i);
  });

  it('PRIVACY.md does not state INDEX_SERVER_DASHBOARD=0 as the default', () => {
    // Directly contradicts docs/network-privacy.md, which documents `1`.
    expect(
      readDoc('PRIVACY.md'),
      'PRIVACY.md and network-privacy.md must not state opposite defaults for the same variable',
    ).not.toMatch(/`INDEX_SERVER_DASHBOARD=0`\s*\(default\)/);
  });

  it('semantic-search defaults are stated as profile-dependent, not absolute', () => {
    // True only for the `default` profile; the setup wizard hands out `enhanced`.
    expect(
      readDoc('THIRD-PARTY-LICENSES.md'),
      'THIRD-PARTY-LICENSES.md states semantic search is disabled by default without qualifying the profile',
    ).not.toMatch(/Disabled by default \(`INDEX_SERVER_SEMANTIC_ENABLED=0`\)/);
  });

  it('the listening-port verification recipe does not tell readers to expect none', () => {
    // A reader running this recipe on a default install sees 127.0.0.1:8787 and,
    // per the old text, concludes something is wrong. The recipe must describe
    // what correct behaviour looks like.
    expect(
      readDoc('docs/network-privacy.md'),
      'the verification recipe still says an empty listener list is expected',
    ).not.toMatch(/Expected output: empty \(no listening ports/);
  });
});
