/**
 * Optional lifecycle hooks (#447).
 *
 * Runs an operator-configured command after a committed instruction CRUD
 * mutation (create / update / remove / change). Off by default; enabled only
 * when at least one hook command is configured via `INDEX_SERVER_HOOK_ON_*`.
 *
 * Dispatched from the single audit hook point (`logAudit`, mutation kind) so
 * every mutation path is covered exactly once, independent of whether the
 * audit *file* is enabled.
 *
 * SECURITY BOUNDARY: the command string comes from trusted operator config
 * (env) ONLY. Instruction content and tool parameters are NEVER interpolated
 * into the command — the mutation context is passed to the hook exclusively via
 * environment variables and a stdin JSON payload, so hostile instruction data
 * cannot inject shell commands.
 */
import { spawn, spawnSync } from 'child_process';
import { getRuntimeConfig } from '../config/runtimeConfig';
import type { LifecycleHooksConfig } from '../config/featureConfig';
import { logWarn, logDebug } from './logger';

export type LifecycleOperation = 'create' | 'update' | 'remove' | 'change';

export interface LifecycleHookEvent {
  operation: LifecycleOperation;
  /** Originating audit action (e.g. 'add', 'remove', 'import', 'promote_from_repo'). */
  action: string;
  ids: string[];
  correlationId?: string;
  meta?: Record<string, unknown>;
}

// In-flight hook process counter for the concurrency bound.
let inFlight = 0;

/** @internal test hook — current in-flight hook process count. */
export function _getLifecycleHookInFlight(): number {
  return inFlight;
}

/** @internal test hook — reset the in-flight counter between specs. */
export function _resetLifecycleHookState(): void {
  inFlight = 0;
}

/**
 * Map a successful audit action + meta to a lifecycle operation, or `undefined`
 * when the action is not a committed instruction-CRUD change (errors, skips,
 * reads, admin, feedback, etc. never fire hooks).
 */
export function deriveLifecycleOperation(
  action: string,
  meta?: Record<string, unknown>,
): LifecycleOperation | undefined {
  const m = meta ?? {};
  switch (action) {
    case 'add': {
      // Only fire on a durable write — not skips, duplicate-at-write, or persist failures.
      if (m.skipped === true || m.mutation_persist_failed === true || m.duplicateAtWrite === true) return undefined;
      if (typeof m.created === 'boolean') return m.created ? 'create' : 'update';
      return undefined;
    }
    case 'remove':
      return (typeof m.removed === 'number' ? m.removed > 0 : true) ? 'remove' : undefined;
    case 'import':
      return ((Number(m.imported) || 0) + (Number(m.overwritten) || 0)) > 0 ? 'change' : undefined;
    case 'promote_from_repo':
      return 'change';
    default:
      return undefined;
  }
}

function resolveCommands(
  operation: LifecycleOperation,
  cfg: LifecycleHooksConfig,
): { command: string; hookName: string }[] {
  const out: { command: string; hookName: string }[] = [];
  const specific =
    operation === 'create' ? cfg.onCreate
      : operation === 'update' ? cfg.onUpdate
        : operation === 'remove' ? cfg.onRemove
          : undefined;
  if (specific) {
    out.push({ command: specific, hookName: `on${operation[0].toUpperCase()}${operation.slice(1)}` });
  }
  // onChange fires for every operation this module recognizes, deduped when it
  // is identical to the specific hook. NOT "every committed mutation": only the
  // four actions in deriveLifecycleOperation produce an operation at all, so
  // archive, restore, purge, patch, groom, normalize, enrich, repair and
  // governanceUpdate never reach here (#591).
  if (cfg.onChange && cfg.onChange !== specific) {
    out.push({ command: cfg.onChange, hookName: 'onChange' });
  }
  return out;
}

function buildHookContext(event: LifecycleHookEvent): string {
  return JSON.stringify({
    operation: event.operation,
    action: event.action,
    ids: event.ids,
    correlationId: event.correlationId ?? null,
    meta: event.meta ?? {},
    ts: new Date().toISOString(),
  });
}

function hookEnvironment(event: LifecycleHookEvent, contextJson: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    INDEX_SERVER_HOOK_OPERATION: event.operation,
    INDEX_SERVER_HOOK_ACTION: event.action,
    INDEX_SERVER_HOOK_IDS: event.ids.join(','),
    INDEX_SERVER_HOOK_CORRELATION_ID: event.correlationId ?? '',
    INDEX_SERVER_HOOK_CONTEXT: contextJson,
  };
}

/**
 * Synchronous dispatch used for true end-to-end blocking semantics. `logAudit`
 * is intentionally synchronous, so returning a Promise from this layer would
 * be discarded by mutation callers and would not delay their response.
 */
function runHookBlocking(
  command: string,
  hookName: string,
  event: LifecycleHookEvent,
  cfg: LifecycleHooksConfig,
): void {
  if (inFlight >= cfg.maxConcurrent) {
    logWarn('[lifecycle-hooks] skipped: max concurrency reached', {
      hook: hookName,
      operation: event.operation,
      maxConcurrent: cfg.maxConcurrent,
    });
    return;
  }
  inFlight += 1;
  const contextJson = buildHookContext(event);
  try {
    const result = spawnSync(command, {
      shell: true,
      timeout: cfg.timeoutMs,
      windowsHide: true,
      env: hookEnvironment(event, contextJson),
      input: contextJson,
      encoding: 'utf8',
      stdio: ['pipe', 'ignore', 'pipe'],
      maxBuffer: 64 * 1024,
    });
    if (result.error) {
      logWarn('[lifecycle-hooks] hook process error', {
        hook: hookName,
        operation: event.operation,
        error: result.error.message,
      });
    } else if (result.status === 0) {
      logDebug(`[lifecycle-hooks] ${hookName} ok (op=${event.operation}, ids=${event.ids.length})`);
    } else {
      logWarn('[lifecycle-hooks] hook exited non-zero', {
        hook: hookName,
        operation: event.operation,
        code: result.status,
        signal: result.signal,
        stderr: String(result.stderr ?? '').slice(0, 500),
      });
    }
  } catch (err) {
    logWarn('[lifecycle-hooks] failed to spawn hook', {
      hook: hookName,
      operation: event.operation,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    inFlight = Math.max(0, inFlight - 1);
  }
}

function runHook(
  command: string,
  hookName: string,
  event: LifecycleHookEvent,
  cfg: LifecycleHooksConfig,
): Promise<void> {
  if (inFlight >= cfg.maxConcurrent) {
    logWarn('[lifecycle-hooks] skipped: max concurrency reached', {
      hook: hookName,
      operation: event.operation,
      maxConcurrent: cfg.maxConcurrent,
    });
    return Promise.resolve();
  }
  inFlight += 1;
  return new Promise<void>((resolve) => {
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      inFlight = Math.max(0, inFlight - 1);
      resolve();
    };
    const contextJson = buildHookContext(event);
    try {
      const child = spawn(command, {
        shell: true, // operator-trusted command string; data is passed via env/stdin only
        timeout: cfg.timeoutMs,
        windowsHide: true,
        env: hookEnvironment(event, contextJson),
        stdio: ['pipe', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr?.on('data', (d: Buffer) => { if (stderr.length < 2000) stderr += String(d); });
      child.on('error', (err: Error) => {
        logWarn('[lifecycle-hooks] hook process error', { hook: hookName, operation: event.operation, error: err.message });
        done();
      });
      child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
        if (code === 0) {
          logDebug(`[lifecycle-hooks] ${hookName} ok (op=${event.operation}, ids=${event.ids.length})`);
        } else {
          logWarn('[lifecycle-hooks] hook exited non-zero', {
            hook: hookName,
            operation: event.operation,
            code,
            signal,
            stderr: stderr.slice(0, 500),
          });
        }
        done();
      });
      // Also provide the context on stdin as JSON for hooks that prefer to read it there.
      try { child.stdin?.end(contextJson); } catch { /* ignore stdin close races */ }
    } catch (err) {
      logWarn('[lifecycle-hooks] failed to spawn hook', {
        hook: hookName,
        operation: event.operation,
        error: err instanceof Error ? err.message : String(err),
      });
      done();
    }
  });
}

/**
 * Dispatch the configured hook(s) for a lifecycle event.
 *
 * Blocking mode executes each selected command synchronously before this
 * function returns. Non-blocking mode starts each command and returns without
 * awaiting completion; child failures are handled internally.
 */
export function dispatchLifecycleHooks(
  event: LifecycleHookEvent,
  cfg: LifecycleHooksConfig,
): void {
  const commands = resolveCommands(event.operation, cfg);
  if (commands.length === 0) return;
  if (cfg.blocking) {
    for (const command of commands) {
      runHookBlocking(command.command, command.hookName, event, cfg);
    }
    return;
  }
  const runs = commands.map((c) => runHook(c.command, c.hookName, event, cfg));
  // Fire-and-forget: errors are already handled inside runHook and never surface.
  void runs;
}

/**
 * Entry point called from `logAudit` for mutation-kind entries. Resolves the
 * operation from the audit action, then dispatches configured hooks. Never
 * throws — a hook failure must never corrupt index state or the mutation result.
 */
export function notifyLifecycleHooks(
  action: string,
  ids: string[] | undefined,
  meta?: Record<string, unknown>,
  correlationId?: string,
): void {
  try {
    const cfg = getRuntimeConfig().lifecycleHooks;
    if (!cfg.enabled) return;
    const operation = deriveLifecycleOperation(action, meta);
    if (!operation) return;
    return dispatchLifecycleHooks({ operation, action, ids: ids ?? [], correlationId, meta }, cfg);
  } catch (err) {
    logWarn('[lifecycle-hooks] dispatch failed to start', {
      action,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
