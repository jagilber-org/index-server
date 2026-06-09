/**
 * validate-configs.mjs unit tests (issue #388)
 *
 * Covers the four required scenarios from the AC:
 *   1. Existing entry-point file → entry marked ok, file-level ok=true.
 *   2. Missing entry-point file → entry marked not-ok with the resolved path
 *      mentioned in the note; file-level ok=false.
 *   3. npx-style command → skipped with a clear note; file-level ok=true
 *      (skipped entries do NOT fail validation).
 *   4. Non-node / non-npx command → out-of-scope skip; file-level ok=true.
 *
 * Bonus:
 *   5. Whole-script integration: spawn `node scripts/validate-configs.mjs
 *      <good.json> <bad.json>` and assert exit code 1 + bad file mentioned in
 *      stdout.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

// The validator is a .mjs module — dynamic import to avoid TS resolution of
// the .mjs extension under module: node16 (would need a .d.ts shim).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;
beforeAll(async () => {
  const scriptPath = path.resolve(__dirname, '..', '..', '..', 'scripts', 'validate-configs.mjs');
  mod = await import(pathToFileURL(scriptPath).href);
});

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'validate-configs.mjs');

let workDir: string;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-configs-'));
});

afterEach(() => {
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function writeConfig(name: string, payload: unknown): string {
  const filePath = path.join(workDir, name);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return filePath;
}

describe('validate-configs.mjs — entry-point existence checks (#388)', () => {
  it('existing entry-point file → entry ok, file ok', () => {
    // Stage a real "entry-point" file under workDir so the resolved path
    // genuinely exists.
    const entryRelative = path.join('dist', 'server', 'index-server.js');
    const entryAbsolute = path.join(workDir, entryRelative);
    fs.mkdirSync(path.dirname(entryAbsolute), { recursive: true });
    fs.writeFileSync(entryAbsolute, '// stub entry-point\n', 'utf8');

    const cfgPath = writeConfig('good.json', {
      mcpServers: {
        'index-server': {
          command: 'node',
          args: [entryRelative],
        },
      },
    });

    const result = mod.validateConfigFile(cfgPath);
    expect(result.parseError).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.ok).toBe(true);
    expect(result.entries[0]?.kind).toBe('file');
    expect(result.entries[0]?.resolvedPath).toBe(entryAbsolute);
    expect(result.entries[0]?.note).toBe('ok');
  });

  it('missing entry-point file → entry not-ok, file not-ok, note names the resolved path', () => {
    const missingRelative = path.join('dist', 'server', 'index-server.js');
    const cfgPath = writeConfig('bad.json', {
      mcpServers: {
        'index-server': {
          command: 'node',
          args: [missingRelative],
        },
      },
    });
    const expectedAbsolute = path.resolve(workDir, missingRelative);

    const result = mod.validateConfigFile(cfgPath);
    expect(result.ok).toBe(false);
    expect(result.entries[0]?.ok).toBe(false);
    expect(result.entries[0]?.note).toContain('entry-point does not exist');
    expect(result.entries[0]?.note).toContain(expectedAbsolute);
    expect(result.entries[0]?.resolvedPath).toBe(expectedAbsolute);

    // formatResult must surface the config file name and the failing entry.
    const rendered = mod.formatResult(result);
    expect(rendered).toContain(cfgPath);
    expect(rendered).toContain('✗');
    expect(rendered).toContain('index-server');
  });

  it('npx-style command → skipped with note, file remains ok', () => {
    const cfgPath = writeConfig('npx.json', {
      mcpServers: {
        'index-server': {
          command: 'npx',
          args: ['-y', '@jagilber-org/index-server'],
        },
      },
    });
    const result = mod.validateConfigFile(cfgPath);
    expect(result.ok).toBe(true);
    expect(result.entries[0]?.kind).toBe('npx');
    expect(result.entries[0]?.note).toMatch(/skipped.*npx/i);
    expect(result.entries[0]?.resolvedPath).toBeNull();
  });

  it('Windows npx.cmd is also recognized as npx', () => {
    expect(mod.isNpxCommand('npx')).toBe(true);
    expect(mod.isNpxCommand('npx.cmd')).toBe(true);
    expect(mod.isNpxCommand('NPX.EXE')).toBe(true);
    expect(mod.isNpxCommand('C:\\Program Files\\nodejs\\npx.cmd')).toBe(true);
    expect(mod.isNpxCommand('node')).toBe(false);
    expect(mod.isNpxCommand(undefined as unknown as string)).toBe(false);
  });

  it('non-node / non-npx command → out-of-scope skip', () => {
    const cfgPath = writeConfig('docker.json', {
      mcpServers: {
        'index-server': {
          command: 'docker',
          args: ['run', 'index-server:latest'],
        },
      },
    });
    const result = mod.validateConfigFile(cfgPath);
    expect(result.ok).toBe(true);
    expect(result.entries[0]?.kind).toBe('other');
    expect(result.entries[0]?.note).toMatch(/skipped.*not a node-style/i);
  });

  it('mixed file: one good + one missing → file ok=false, only missing flagged', () => {
    const goodRel = path.join('dist', 'good.js');
    fs.mkdirSync(path.join(workDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(workDir, goodRel), '// good\n', 'utf8');

    const cfgPath = writeConfig('mixed.json', {
      mcpServers: {
        'good-server': { command: 'node', args: [goodRel] },
        'bad-server': { command: 'node', args: ['dist/missing.js'] },
        'npx-server': { command: 'npx', args: ['-y', 'pkg'] },
      },
    });
    const result = mod.validateConfigFile(cfgPath);
    expect(result.ok).toBe(false);
    const byName = Object.fromEntries(result.entries.map((e: { server: string }) => [e.server, e]));
    expect(byName['good-server'].ok).toBe(true);
    expect(byName['bad-server'].ok).toBe(false);
    expect(byName['npx-server'].ok).toBe(true);
  });

  it('entry.cwd anchors relative args[0] resolution (not config-file dir)', () => {
    const cwdDir = path.join(workDir, 'somewhere', 'else');
    fs.mkdirSync(cwdDir, { recursive: true });
    fs.writeFileSync(path.join(cwdDir, 'entry.js'), '// stub\n', 'utf8');

    const cfgPath = writeConfig('cwd-anchored.json', {
      mcpServers: {
        'index-server': {
          command: 'node',
          args: ['entry.js'],
          cwd: cwdDir,
        },
      },
    });
    const result = mod.validateConfigFile(cfgPath);
    expect(result.ok).toBe(true);
    expect(result.entries[0]?.resolvedPath).toBe(path.join(cwdDir, 'entry.js'));
  });

  it('absolute args[0] is honored as-is', () => {
    const absEntry = path.join(workDir, 'abs-entry.js');
    fs.writeFileSync(absEntry, '// abs\n', 'utf8');
    const cfgPath = writeConfig('abs.json', {
      mcpServers: {
        'index-server': { command: 'node', args: [absEntry] },
      },
    });
    const result = mod.validateConfigFile(cfgPath);
    expect(result.ok).toBe(true);
    expect(result.entries[0]?.resolvedPath).toBe(absEntry);
  });

  it('parseConfigFile surfaces JSON errors and extractServers tolerates both keys', () => {
    const badJson = path.join(workDir, 'broken.json');
    fs.writeFileSync(badJson, '{ this is not json', 'utf8');
    expect(() => mod.parseConfigFile(badJson)).toThrow(/failed to parse/);

    expect(mod.extractServers({ servers: { a: {} } })).toEqual({ a: {} });
    expect(mod.extractServers({ mcpServers: { b: {} } })).toEqual({ b: {} });
    expect(mod.extractServers({})).toEqual({});
    expect(mod.extractServers(null)).toEqual({});
  });

  it('resolveEntryPoint: malformed entries return out-of-scope', () => {
    expect(mod.resolveEntryPoint(null, workDir).kind).toBe('other');
    expect(mod.resolveEntryPoint({ command: 'node', args: [] }, workDir).kind).toBe('other');
    expect(mod.resolveEntryPoint({ command: 'node', args: ['--inspect'] }, workDir).kind).toBe('other');
  });
});

describe('validate-configs.mjs — CLI integration (#388)', () => {
  it('CLI exits 1 when any config has a missing entry-point and prints both file paths', () => {
    const goodEntry = path.join('dist', 'good.js');
    fs.mkdirSync(path.join(workDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(workDir, goodEntry), '// stub\n', 'utf8');

    const goodCfg = writeConfig('cli-good.json', {
      mcpServers: { ok: { command: 'node', args: [goodEntry] } },
    });
    const badCfg = writeConfig('cli-bad.json', {
      mcpServers: { broken: { command: 'node', args: ['dist/does-not-exist.js'] } },
    });

    const result = spawnSync(process.execPath, [SCRIPT, goodCfg, badCfg], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(result.status, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(1);
    expect(result.stdout).toContain(goodCfg);
    expect(result.stdout).toContain(badCfg);
    expect(result.stdout).toContain('entry-point does not exist');
    expect(result.stdout).toMatch(/✗ broken/);
  });

  it('CLI exits 0 when all entries are ok or skipped (npx)', () => {
    const goodEntry = path.join('dist', 'good.js');
    fs.mkdirSync(path.join(workDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(workDir, goodEntry), '// stub\n', 'utf8');

    const cfg = writeConfig('cli-allgood.json', {
      mcpServers: {
        ok: { command: 'node', args: [goodEntry] },
        npx: { command: 'npx', args: ['-y', 'pkg'] },
      },
    });
    const result = spawnSync(process.execPath, [SCRIPT, cfg], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(result.status, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
  });

  it('CLI exits 2 on parse error / missing file', () => {
    const result = spawnSync(process.execPath, [SCRIPT, path.join(workDir, 'nonexistent.json')], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(result.status).toBe(2);
    expect(result.stderr + result.stdout).toContain('not found');
  });
});
