/**
 * Transport-independent guard sequence for tool invocation (issue #605).
 *
 * Every entry point that can reach a registered tool handler MUST run this
 * sequence first. It exists because the same three checks were written once,
 * inline, in the stdio `tools/call` handler (`sdkServer.ts`), and a second
 * live entry point — `POST /mcp/rpc` (`dashboard/server/HttpTransport.ts`) —
 * grew without any of them:
 *
 *   1. declared-tool gate  (#592) — the callable surface MUST equal the
 *      declared surface, with a byte-identical refusal for "undeclared" and
 *      "not registered" so `tools/call` is not an enumeration oracle.
 *   2. handler lookup      — same refusal shape as (1), deliberately.
 *   3. schema pre-validation (#581 / PR #601) — INPUT_SCHEMAS enforced at the
 *      transport boundary, minus the self-validating tools below.
 *
 * Keeping the sequence here rather than duplicating it is the actual fix: the
 * recurring bug shape is "a second entry point grew without the first one's
 * checks", and a third transport is expected. Authentication is NOT part of
 * this function — it is transport-shaped (stdio inherits the pipe; HTTP needs
 * a middleware) and belongs at the transport edge.
 */
import { isDeclaredTool } from '../services/toolRegistry';
import { validateParams } from '../services/validationService';
import { logInfo } from '../services/logger';
import { logAudit } from '../services/auditLog';
import type { Handler } from './registry';

/**
 * Tools whose own parameter validation is strictly richer than the generic
 * INPUT_SCHEMA check, and which therefore opt out of pre-validation.
 *
 * `index_dispatch` is the one such tool. Its own refusals carry `hint`,
 * `validActions`, `schema` and worked `examples`, and distinguish
 * `unknown_action` (-32601) from `missing_action` (-32602). Generic schema
 * validation would intercept both and replace them with "Invalid enum value",
 * which is strictly LESS information than callers get today.
 *
 * This is not a validation hole: the dispatcher validates `action` itself
 * before doing any work, and per-action parameter checks live in the handlers
 * it routes to. Keep this minimal: every entry is a tool whose schema is NOT
 * enforced at the transport boundary, so an addition must be justified by the
 * tool producing a better error, not merely a different one.
 */
export const SELF_VALIDATING_TOOLS = new Set<string>(['index_dispatch']);

/** JSON-RPC shaped refusal produced by the guard. */
export interface ToolGuardRejection {
  code: number;
  message: string;
  data: { message: string; method: string; errors?: unknown[] };
  /** Which check refused — for transport-side logging/status mapping only. Never put this on the wire. */
  reason: 'tool_not_declared' | 'tool_not_registered' | 'invalid_params';
}

export type ToolGuardResult =
  | { ok: true; name: string; args: Record<string, unknown>; handler: Handler }
  | { ok: false; error: ToolGuardRejection };

export interface ToolGuardOptions {
  /** Handler lookup. stdio passes `getHandler`; the HTTP leader passes `getLocalHandler`. */
  lookup: (name: string) => Handler | undefined;
  /** Audit kind recorded for refusals (`'read'` for stdio, `'http'` for the RPC route). */
  auditKind?: 'mutation' | 'read' | 'http' | 'feedback';
  /** Transport label included in the INFO log line. */
  transport?: string;
}

/** Refusal text shared by the undeclared and unregistered cases — deliberately identical (#592). */
function unknownTool(name: string, reason: ToolGuardRejection['reason']): ToolGuardRejection {
  return {
    code: -32601,
    message: `Unknown tool: ${name}`,
    data: { message: `Unknown tool: ${name}`, method: name },
    reason,
  };
}

/**
 * Run the declared-tool gate, handler lookup and schema pre-validation for one
 * tool invocation.
 *
 * @param name - Tool name taken from the request
 * @param args - Caller-supplied arguments (may be empty)
 * @param options - Handler lookup plus audit/logging context
 * @returns The resolved handler, or a JSON-RPC shaped refusal
 */
export function guardToolInvocation(
  name: string,
  args: Record<string, unknown>,
  options: ToolGuardOptions,
): ToolGuardResult {
  const auditKind = options.auditKind ?? 'read';
  const transport = options.transport ?? 'stdio';

  // 1. Declared-tool gate (#592). Membership is checked against the FULL
  // registry, not the flag-resolved tier — tiers govern tools/list visibility,
  // so extended and admin tools stay callable with the tier flags off.
  //
  // INFO, not ERROR: this is the expected outcome of untrusted input, not a
  // server fault, and it is client-triggerable at unbounded rate over the
  // wire. The durable record goes to the audit log, where it cannot be flushed
  // by volume (A-5).
  if (!isDeclaredTool(name)) {
    logInfo('[rpc] tools/call rejected undeclared tool', { tool: name, reason: 'tool_not_declared', transport });
    try { logAudit('tool_not_declared', undefined, { tool: name, reason: 'tool_not_declared', transport }, auditKind); } catch { /* audit must never break the refusal */ }
    return { ok: false, error: unknownTool(name, 'tool_not_declared') };
  }

  // 2. Handler lookup — byte-identical refusal to case 1 on purpose.
  const handler = options.lookup(name);
  if (!handler) {
    return { ok: false, error: unknownTool(name, 'tool_not_registered') };
  }

  // 3. Schema pre-validation (#581), except for self-validating tools.
  if (!SELF_VALIDATING_TOOLS.has(name)) {
    const validation = validateParams(name, args);
    if (!validation.ok) {
      const detail = validation.errors.map(e => `${e.instancePath || '/'}: ${e.message}`).join('; ');
      return {
        ok: false,
        error: {
          code: -32602,
          message: `Invalid params: ${detail}`,
          data: { message: detail, method: name, errors: validation.errors },
          reason: 'invalid_params',
        },
      };
    }
  }

  return { ok: true, name, args, handler };
}
