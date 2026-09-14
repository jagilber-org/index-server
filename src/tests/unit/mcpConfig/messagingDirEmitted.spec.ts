/**
 * Every generated client config must carry the SAME absolute
 * INDEX_SERVER_MESSAGING_DIR.
 *
 * Regression under test: the catalog entry was `active: false`, and only
 * `active` entries reach the emitted env (see activeEnvFromCatalog). The key was
 * therefore never written into any client config, so VS Code, Claude Code and
 * Copilot CLI each fell back to a cwd-relative default and stopped sharing a
 * store — silently.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { resolveDataPaths, buildEnvCatalog, MCP_PROFILES, type McpProfile } from '../../../services/mcpConfig/flagCatalog';
import { buildServerEntry, renderConfig, type ServerBuildConfig } from '../../../services/mcpConfig/formats';
import type { McpConfigFormat } from '../../../services/mcpConfig/paths';
import { DIR } from '../../../config/dirConstants';

const ROOT = path.resolve('/tmp/index-root');
// Derived from the canonical tuple, not hand-copied: the invariant is that
// EVERY emitted profile carries the same absolute path, so a profile added
// later must be covered here automatically.
const PROFILES: readonly McpProfile[] = MCP_PROFILES;
const FORMATS: McpConfigFormat[] = ['vscode', 'vscode-global', 'copilot-cli', 'claude'];

function catalogEntry(profile: McpProfile, key: string) {
  const paths = resolveDataPaths(ROOT);
  const catalog = buildEnvCatalog(
    { profile, port: 8787, host: '127.0.0.1', mutation: true, tls: false, logLevel: 'info' } as never,
    paths,
  );
  return catalog.find(
    (e): e is Extract<typeof e, { key: string }> => 'key' in e && e.key === key,
  );
}

function messagingEntry(profile: McpProfile) {
  return catalogEntry(profile, 'INDEX_SERVER_MESSAGING_DIR');
}

describe('config generators — INDEX_SERVER_MESSAGING_DIR', () => {
  it('resolves messaging as a sibling of instructions, not under data/', () => {
    const paths = resolveDataPaths(ROOT);
    expect(paths.messaging).toBe(paths.messaging.split(path.sep).join('/'));
    expect(paths.messaging.endsWith(`/${DIR.MESSAGING}`)).toBe(true);
    expect(paths.messaging).not.toContain('/data/messaging');
  });

  it('never nests the messaging store inside the instruction catalog', () => {
    const paths = resolveDataPaths(ROOT);
    expect(paths.messaging.startsWith(`${paths.instructions}/`)).toBe(false);
    expect(paths.messaging).not.toBe(paths.instructions);
  });

  it('is emitted as ACTIVE so it reaches the client env', () => {
    for (const profile of PROFILES) {
      const entry = messagingEntry(profile);
      expect(entry, `missing for profile ${profile}`).toBeDefined();
      expect(entry!.active, `inactive for profile ${profile}`).toBe(true);
    }
  });

  it('pins INDEX_SERVER_DIR as ACTIVE too, so the containment guard has a fixed parent', () => {
    // The messaging store is validated against INDEX_SERVER_DIR. If only the
    // child is pinned, the guard's PARENT operand varies per client: one process
    // sees a store as outside the catalog and writes to it while another sees
    // the same store as inside and refuses to boot. Both halves or neither.
    for (const profile of PROFILES) {
      const entry = catalogEntry(profile, 'INDEX_SERVER_DIR');
      expect(entry, `missing for profile ${profile}`).toBeDefined();
      expect(entry!.active, `inactive for profile ${profile}`).toBe(true);
    }
  });

  it('emits one identical absolute path for every profile', () => {
    const values = PROFILES.map(p => messagingEntry(p)!.value);
    expect(new Set(values).size).toBe(1);
    expect(path.isAbsolute(values[0].replace(/^([A-Za-z]:)/, '$1'))).toBe(true);
  });
});

/**
 * The catalog is only an intermediate. What ships to the user is the rendered
 * config file, so the contract is asserted on the generated text: every client
 * format must land on the same absolute store, or they silo again.
 */
describe('generated client configs — shared messaging store', () => {
  const ENTRY_RELATIVE = path.join('dist', 'server', 'index-server.js');

  function makeConfig(): ServerBuildConfig {
    return {
      serverName: 'index-server',
      profile: 'enhanced',
      root: ROOT,
      port: 8787,
      host: '127.0.0.1',
      tls: false,
      mutation: true,
      logLevel: 'info',
    } as ServerBuildConfig;
  }

  beforeEach(() => {
    // Pin the launch source so the entry does not depend on what exists on the
    // machine running the test.
    vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike): boolean =>
      path.resolve(String(p)) === path.join(ROOT, ENTRY_RELATIVE));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes the same absolute INDEX_SERVER_MESSAGING_DIR into every client format', () => {
    const paths = resolveDataPaths(ROOT);
    const emitted = FORMATS.map((format) => {
      const entry = buildServerEntry(format, makeConfig(), paths);
      const rendered = renderConfig(format, 'index-server', entry);
      const parsed = JSON.parse(rendered) as Record<string, Record<string, { env: Record<string, string> }>>;
      const rootKey = format === 'vscode' || format === 'vscode-global' ? 'servers' : 'mcpServers';
      return parsed[rootKey]['index-server'].env.INDEX_SERVER_MESSAGING_DIR;
    });

    for (const [i, value] of emitted.entries()) {
      expect(value, `missing for format ${FORMATS[i]}`).toBeDefined();
    }
    expect(new Set(emitted).size).toBe(1);
    expect(emitted[0]).toBe(paths.messaging);
    expect(path.isAbsolute(emitted[0].replace(/^([A-Za-z]:)/, '$1'))).toBe(true);
  });

  it('never points a generated config at a cwd-relative store', () => {
    for (const format of FORMATS) {
      const entry = buildServerEntry(format, makeConfig(), resolveDataPaths(ROOT));
      const value = entry.env?.INDEX_SERVER_MESSAGING_DIR;
      expect(value, `missing for format ${format}`).toBeTruthy();
      expect(value).not.toContain('/data/messaging');
    }
  });
});
