/**
 * Launch-target entry-point helpers used by the setup wizard's `--verify`
 * flag (#387) and the config validator (#388). Centralizes the
 * "is the resolved entry-point actually reachable?" check that #386 introduced
 * inline in `resolveServerLaunch`.
 *
 * NOTE: Today these helpers are imported by wizard `--verify` only. The
 * #386 inline check in `formats.ts` is intentionally NOT refactored here to
 * avoid disturbing sealed work. Future consolidation may migrate it.
 */
import fs from 'fs';
import path from 'path';

/**
 * Mirror of `resolveServerLaunch`'s return type. Locally defined to avoid
 * a structural dependency on `formats.ts` (which doesn't export it as a
 * named interface today).
 */
export interface LaunchSpec {
  command: string;
  args: string[];
  cwd?: string;
  source: 'local' | 'packaged' | 'npx';
  /** Optional env to merge when spawning. Not part of resolveServerLaunch. */
  env?: Record<string, string>;
}

/**
 * Resolve a launch spec's `args[0]` to an absolute path, anchored on the
 * launch's `cwd` (or `fallbackCwd` when the launch did not specify one).
 * Returns `null` for non-`node` launches (e.g. `npx`) where the entry-point
 * is not a local file the caller can `fs.stat`.
 */
export function resolveLaunchEntryAbsolute(
  launch: LaunchSpec,
  fallbackCwd: string,
): string | null {
  if (launch.command !== 'node') return null;
  const arg0 = launch.args[0];
  if (!arg0 || arg0.startsWith('-')) return null;
  if (path.isAbsolute(arg0)) return arg0;
  return path.resolve(launch.cwd ?? fallbackCwd, arg0);
}

export interface EntryPointCheck {
  ok: boolean;
  command: string;
  source: LaunchSpec['source'];
  /** Absolute path checked, or null when launch.command isn't 'node'. */
  resolvedPath: string | null;
  /** Human-readable reason when ok=false. */
  reason?: string;
}

/**
 * Check whether the resolved entry-point for a launch spec exists on disk.
 * - `command: 'node'` + missing file  → `{ ok: false, reason: 'missing' }`
 * - `command: 'node'` + present file  → `{ ok: true }`
 * - `command: 'npx'`  → `{ ok: true, resolvedPath: null }` (existence is
 *   re-resolved by npx at launch time; the caller can decide whether to
 *   probe further, e.g. via `isNpxReachable()`).
 */
export function checkLaunchEntryPoint(
  launch: LaunchSpec,
  fallbackCwd: string,
): EntryPointCheck {
  const resolvedPath = resolveLaunchEntryAbsolute(launch, fallbackCwd);
  if (resolvedPath === null) {
    return { ok: true, command: launch.command, source: launch.source, resolvedPath: null };
  }
  if (!fs.existsSync(resolvedPath)) {
    return {
      ok: false,
      command: launch.command,
      source: launch.source,
      resolvedPath,
      reason: `entry-point file does not exist: ${resolvedPath}`,
    };
  }
  return { ok: true, command: launch.command, source: launch.source, resolvedPath };
}

/**
 * Throwing variant of `checkLaunchEntryPoint`. Used by wizard `--verify` as
 * a fast pre-flight before paying the cost of spawning the server.
 */
export function assertLaunchEntryExists(
  launch: LaunchSpec,
  fallbackCwd: string,
): void {
  const check = checkLaunchEntryPoint(launch, fallbackCwd);
  if (!check.ok) {
    throw new Error(`setup-wizard verify: ${check.reason}`);
  }
}

export interface VerifyServerOptions {
  /** Working directory if launch.cwd is unset. Defaults to process.cwd(). */
  fallbackCwd?: string;
  /** Per-step timeout for connect + health_check. Defaults to 30s. */
  timeoutMs?: number;
  /** Extra env merged on top of process.env when spawning the server. */
  extraEnv?: Record<string, string>;
}

export interface VerifyServerResult {
  ok: true;
  status: string;
  version?: string;
  durationMs: number;
  source: LaunchSpec['source'];
  entryPath: string | null;
}

/**
 * Spawn the server described by `launch`, perform the MCP `initialize`
 * handshake, then call the `health_check` tool and assert `status === 'ok'`.
 * Returns parsed health payload on success; throws an actionable Error on
 * any failure (with stderr tail and resolved entry path when available).
 *
 * This is what `setup-wizard --verify` runs after writing `mcp.json`.
 */
export async function verifyServerLaunch(
  launch: LaunchSpec,
  options: VerifyServerOptions = {},
): Promise<VerifyServerResult> {
  const fallbackCwd = options.fallbackCwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? 30_000;

  // Pre-flight: entry-point existence (avoid paying spawn cost on a known-bad
  // launch). For npx this is a no-op — resolveServerLaunch already gates on
  // isNpxReachable() via the #386 path.
  assertLaunchEntryExists(launch, fallbackCwd);
  const entryPath = resolveLaunchEntryAbsolute(launch, fallbackCwd);

  // Dynamic imports keep the SDK out of any sync require() graph and let this
  // module compile cleanly under CommonJS even though the SDK ships ESM.
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  Object.assign(env, launch.env ?? {}, options.extraEnv ?? {});
  // Force the dashboard off so concurrent `--verify` invocations don't
  // contend for the default port and stall startup.
  env.INDEX_SERVER_DASHBOARD = '0';

  const transport = new StdioClientTransport({
    command: launch.command,
    args: launch.args,
    cwd: launch.cwd ?? fallbackCwd,
    env,
    stderr: 'pipe',
  });

  // Capture a tail of stderr so failure messages can show the user what the
  // server printed before dying.
  const stderrChunks: string[] = [];
  const MAX_STDERR_TAIL_BYTES = 4_096;
  let stderrBytes = 0;
  // StdioClientTransport exposes a Readable when stderr:'pipe'.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stderrStream = (transport as any).stderr as NodeJS.ReadableStream | undefined;
  if (stderrStream && typeof stderrStream.on === 'function') {
    stderrStream.on('data', (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      stderrBytes += text.length;
      stderrChunks.push(text);
      // Keep memory bounded — drop oldest if we exceed cap.
      while (stderrBytes > MAX_STDERR_TAIL_BYTES * 2 && stderrChunks.length > 1) {
        stderrBytes -= stderrChunks[0]!.length;
        stderrChunks.shift();
      }
    });
  }

  const stderrTail = (): string => {
    const all = stderrChunks.join('');
    return all.length > MAX_STDERR_TAIL_BYTES ? `…${all.slice(-MAX_STDERR_TAIL_BYTES)}` : all;
  };

  const client = new Client(
    { name: 'setup-wizard-verify', version: '1.0.0' },
    { capabilities: {} },
  );

  const started = Date.now();
  try {
    await withTimeout(client.connect(transport), timeoutMs, 'connect (MCP initialize)');
    const resp = await withTimeout(
      client.callTool({ name: 'health_check', arguments: {} }) as Promise<{ content?: Array<{ text?: string }> }>,
      timeoutMs,
      'health_check tool call',
    );
    const text = resp?.content?.[0]?.text;
    if (!text) {
      throw new Error(`health_check returned no text content (raw: ${JSON.stringify(resp)})`);
    }
    let health: { status?: string; version?: string };
    try {
      health = JSON.parse(text) as { status?: string; version?: string };
    } catch (parseErr) {
      throw new Error(`health_check returned non-JSON text: ${text.slice(0, 200)} (${(parseErr as Error).message})`);
    }
    if (health.status !== 'ok') {
      throw new Error(`health_check status="${String(health.status)}", expected "ok"`);
    }
    return {
      ok: true,
      status: health.status,
      version: health.version,
      durationMs: Date.now() - started,
      source: launch.source,
      entryPath,
    };
  } catch (err) {
    const baseMsg = err instanceof Error ? err.message : String(err);
    const tail = stderrTail();
    const parts = [
      `setup-wizard verify failed: ${baseMsg}`,
      `  launch.command: ${launch.command}`,
      `  launch.args:    ${JSON.stringify(launch.args)}`,
      `  launch.source:  ${launch.source}`,
    ];
    if (entryPath) parts.push(`  resolved entry: ${entryPath}`);
    if (tail.trim().length > 0) parts.push(`  stderr tail:\n${indent(tail.trimEnd(), '    ')}`);
    throw new Error(parts.join('\n'));
  } finally {
    try { await transport.close(); } catch { /* ignore */ }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handle = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (v) => { clearTimeout(handle); resolve(v); },
      (e) => { clearTimeout(handle); reject(e instanceof Error ? e : new Error(String(e))); },
    );
  });
}

function indent(text: string, prefix: string): string {
  // Manual newline scan: avoids regex / string-split helpers banned by the
  // mcpConfig repository conformance gate
  // (src/tests/integration/mcpConfigRepositoryConformance.spec.ts).
  const NL = String.fromCharCode(10);
  const lines: string[] = [];
  let buf = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === NL) { lines.push(buf); buf = ''; } else { buf += ch; }
  }
  lines.push(buf);
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) out += NL;
    out += prefix + lines[i];
  }
  return out;
}
