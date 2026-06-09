// Run with: node scripts/validate-configs.mjs
/**
 * validate-configs.mjs — Static validator for MCP config files (#388).
 *
 * For every server entry in every supplied config file:
 *   1. Parse the JSON (JSONC tolerated for VS Code-style files via `jsonc-parser`
 *      if available; falls back to strict JSON otherwise).
 *   2. Walk each server entry's `command` + `args` and resolve the entry-point
 *      to an absolute path (anchored on `entry.cwd` if set, else the config
 *      file's directory).
 *   3. Check the resolved file exists.
 *
 * Failures (missing entry-point) print the config file, server name, and the
 * resolved path. Process exits non-zero if any failed.
 *
 * `npx`-style commands are intentionally SKIPPED with a clear note: there is
 * no on-disk file to check at validation time — npx re-resolves the package
 * from the registry/cache at launch time. See `_npx` cache discussion in
 * resolveServerLaunch (#386). If a user wants npx launches verified live, use
 * `setup-wizard --verify` (#387) instead.
 *
 * Usage:
 *   node scripts/validate-configs.mjs [config.json ...]
 *   node scripts/validate-configs.mjs        # validate the in-repo fixtures
 *
 * Exit codes:
 *   0 — all entries OK (or only skipped-npx entries)
 *   1 — one or more entries failed the existence check
 *   2 — usage / parse error
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_TARGETS = [
  path.join(REPO_ROOT, 'tests', 'fixtures', 'mcp-config.dev.json'),
  path.join(REPO_ROOT, 'tests', 'fixtures', 'mcp-config.test.json'),
];

/**
 * Parse a JSON config file. Strict JSON only — the validator runs against
 * the shipped fixtures (plain JSON). VS Code JSONC files are out of scope
 * here; for those use `validateConfigObject()` from `src/services/mcpConfig`
 * which already understands JSONC.
 */
export function parseConfigFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(text);
  } catch (jsonErr) {
    throw new Error(`failed to parse ${filePath}: ${jsonErr.message}`);
  }
}

/**
 * Extract the servers map from a parsed MCP config. Supports both keys used
 * across flavors: `servers` (VS Code) and `mcpServers` (Claude / Copilot CLI).
 */
export function extractServers(config) {
  if (config && typeof config === 'object') {
    if (config.servers && typeof config.servers === 'object') return config.servers;
    if (config.mcpServers && typeof config.mcpServers === 'object') return config.mcpServers;
  }
  return {};
}

/**
 * Decide whether `command` is an npx-style invocation. We skip these because
 * there's no on-disk entry to check before launch — npx resolves at runtime.
 */
export function isNpxCommand(command) {
  if (typeof command !== 'string' || command.length === 0) return false;
  // Normalize both POSIX and Windows separators before taking the basename.
  // path.basename does not treat "\\" as a separator on POSIX runners, so a
  // Windows-style command like "C:\\Program Files\\nodejs\\npx.cmd" would
  // otherwise be returned whole and fail to match on Linux CI.
  const base = (command.replace(/\\/g, '/').split('/').pop() ?? '').toLowerCase();
  return base === 'npx' || base === 'npx.cmd' || base === 'npx.exe';
}

/**
 * Resolve the entry-point file an entry will try to execute. Returns:
 *   { kind: 'file',  resolvedPath }      for node-style launches
 *   { kind: 'npx',   resolvedPath: null } for npx launches (caller should skip)
 *   { kind: 'other', resolvedPath: null } for everything else (e.g. python,
 *                                          docker) — out of scope today
 */
export function resolveEntryPoint(entry, configFileDir) {
  if (!entry || typeof entry !== 'object') {
    return { kind: 'other', resolvedPath: null };
  }
  const command = entry.command;
  if (isNpxCommand(command)) {
    return { kind: 'npx', resolvedPath: null };
  }
  if (typeof command !== 'string') {
    return { kind: 'other', resolvedPath: null };
  }
  // Detect node-style launches: command is node (any variant) OR command is
  // an absolute path to a node binary. Heuristic — keep it permissive so a
  // wrapped `process.execPath` still gets validated.
  const base = path.basename(command).toLowerCase();
  const isNodeCommand = base === 'node' || base === 'node.exe';
  if (!isNodeCommand) {
    return { kind: 'other', resolvedPath: null };
  }
  const args = Array.isArray(entry.args) ? entry.args : [];
  const arg0 = args[0];
  if (typeof arg0 !== 'string' || arg0.length === 0 || arg0.startsWith('-')) {
    return { kind: 'other', resolvedPath: null };
  }
  const baseDir = typeof entry.cwd === 'string' && entry.cwd.length > 0
    ? entry.cwd
    : configFileDir;
  const resolvedPath = path.isAbsolute(arg0) ? arg0 : path.resolve(baseDir, arg0);
  return { kind: 'file', resolvedPath };
}

/**
 * Validate one config file. Returns a structured result with one record
 * per server entry plus a top-level ok flag.
 */
export function validateConfigFile(filePath) {
  const result = {
    file: filePath,
    ok: true,
    parseError: null,
    entries: [],
  };
  let config;
  try {
    config = parseConfigFile(filePath);
  } catch (err) {
    result.ok = false;
    result.parseError = err.message;
    return result;
  }
  const servers = extractServers(config);
  const configDir = path.dirname(filePath);
  for (const [name, entry] of Object.entries(servers)) {
    const resolved = resolveEntryPoint(entry, configDir);
    const record = {
      server: name,
      command: entry?.command ?? null,
      kind: resolved.kind,
      resolvedPath: resolved.resolvedPath,
      ok: true,
      note: null,
    };
    if (resolved.kind === 'npx') {
      record.note = 'skipped — npx command, entry-point not statically resolvable';
    } else if (resolved.kind === 'other') {
      record.note = 'skipped — not a node-style launch (out of scope for entry-point check)';
    } else if (resolved.kind === 'file' && resolved.resolvedPath) {
      if (!fs.existsSync(resolved.resolvedPath)) {
        record.ok = false;
        record.note = `entry-point does not exist: ${resolved.resolvedPath}`;
        result.ok = false;
      } else {
        record.note = 'ok';
      }
    }
    result.entries.push(record);
  }
  return result;
}

/**
 * Render a validateConfigFile() result as multi-line human-readable text.
 */
export function formatResult(result) {
  const lines = [];
  lines.push(`▸ ${result.file}`);
  if (result.parseError) {
    lines.push(`  ✗ parse error: ${result.parseError}`);
    return lines.join('\n');
  }
  if (result.entries.length === 0) {
    lines.push('  (no servers defined)');
    return lines.join('\n');
  }
  for (const entry of result.entries) {
    const icon = entry.ok ? '✓' : '✗';
    const tail = entry.resolvedPath ? ` → ${entry.resolvedPath}` : '';
    lines.push(`  ${icon} ${entry.server} [${entry.kind}] ${entry.note}${tail}`);
  }
  return lines.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`Usage: node scripts/validate-configs.mjs [config.json ...]

Validates that every server entry in each supplied MCP config file resolves
to an entry-point file that exists on disk. Useful as a CI sanity check
against shipped fixtures and as a local pre-commit gate.

If no config files are supplied, the in-repo fixtures are validated:
${DEFAULT_TARGETS.map((p) => '  ' + p).join('\n')}

Exit codes:
  0 — all entries OK (or only skipped-npx / non-node entries)
  1 — one or more entries reference a missing entry-point
  2 — usage / parse error
`);
    process.exit(0);
  }

  const targets = argv.length > 0 ? argv.map((p) => path.resolve(p)) : DEFAULT_TARGETS;
  let anyFailed = false;
  let anyParseError = false;
  for (const target of targets) {
    if (!fs.existsSync(target)) {
      console.error(`✗ ${target} — file not found`);
      anyParseError = true;
      continue;
    }
    const result = validateConfigFile(target);
    console.log(formatResult(result));
    if (result.parseError) anyParseError = true;
    if (!result.ok) anyFailed = true;
  }
  if (anyParseError) process.exit(2);
  process.exit(anyFailed ? 1 : 0);
}

// Only run main() when invoked as the entry script (not when imported by tests).
// import.meta.url is a file:// URL; process.argv[1] may be the script path or
// a hoisted vitest worker — checking equality is the standard ESM pattern.
const invokedDirectly = (() => {
  try {
    return fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '');
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  main().catch((err) => {
    console.error('validate-configs: unexpected error', err);
    process.exit(2);
  });
}
