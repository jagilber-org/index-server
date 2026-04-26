/**
 * Utility helpers for parsing initialize frame instrumentation breadcrumbs
 * emitted when INDEX_SERVER_TRACE=initFrame (see sdkServer.ts initFrameLog calls).
 * These helpers are test-only and live under src/tests/util.
 */

export interface InitFrameEvent { stage: string; t?: number; id?: number; negotiated?: string; [k: string]: unknown }

export interface InitFrameSummary {
  events: InitFrameEvent[];
  stages: Set<string>;
  hasHandlerReturn: boolean;
  hasReadyScheduled: boolean;
  completionStageObserved: boolean;
}

export const ALL_KNOWN_INIT_STAGES = [
  'handler_return',
  'ready_emit_scheduled'
];

/** Parse stderr lines and extract init-frame JSON payloads */
export function parseInitFrameLines(lines: string[]): InitFrameEvent[] {
  const out: InitFrameEvent[] = [];
  for(const l of lines){
    if(!l.startsWith('[init-frame]')) continue;
    const jsonPart = l.slice('[init-frame]'.length).trim();
    try {
      const evt = JSON.parse(jsonPart);
      if(evt && typeof evt === 'object' && evt.stage){ out.push(evt as InitFrameEvent); }
    } catch { /* ignore malformed */ }
  }
  return out;
}

/** Build a summary with convenience booleans for asserting coverage */
export function summarizeInitFrames(events: InitFrameEvent[]): InitFrameSummary {
  const stages = new Set(events.map(e=> e.stage));
  const hasHandlerReturn = stages.has('handler_return');
  const hasReadyScheduled = stages.has('ready_emit_scheduled');
  const completionStageObserved = hasReadyScheduled;
  return { events, stages, hasHandlerReturn, hasReadyScheduled, completionStageObserved };
}

/**
 * Lightweight invariant checker (does not throw) returning human readable problems
 * so tests can incorporate as diagnostics instead of failing on first missing stage.
 */
export function validateInitFrameSequence(summary: InitFrameSummary): string[] {
  const issues: string[] = [];
  if(!summary.hasHandlerReturn) issues.push('missing handler_return');
  if(!summary.completionStageObserved) issues.push('missing ready_emit_scheduled');
  return issues;
}

/** Convenience pretty printer for debugging */
export function formatSummary(summary: InitFrameSummary): string {
  return JSON.stringify({ stages: Array.from(summary.stages), count: summary.events.length }, null, 2);
}
