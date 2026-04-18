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
  hasTransportDetect: boolean;
  hasTransportResolved: boolean;
  hasDispatcherBefore: boolean;
  hasDispatcherResolved: boolean;
  flushStageObserved: boolean; // dispatcher_send_resolved or transport_send_resolved
}

export const ALL_KNOWN_INIT_STAGES = [
  'handler_return',
  'dispatcher_before_send',
  'dispatcher_send_resolved',
  'transport_detect_init_result',
  'transport_send_resolved'
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
  const hasTransportDetect = stages.has('transport_detect_init_result');
  const hasTransportResolved = stages.has('transport_send_resolved');
  const hasDispatcherBefore = stages.has('dispatcher_before_send');
  const hasDispatcherResolved = stages.has('dispatcher_send_resolved');
  const flushStageObserved = hasDispatcherResolved || hasTransportResolved;
  return { events, stages, hasHandlerReturn, hasTransportDetect, hasTransportResolved, hasDispatcherBefore, hasDispatcherResolved, flushStageObserved };
}

/**
 * Lightweight invariant checker (does not throw) returning human readable problems
 * so tests can incorporate as diagnostics instead of failing on first missing stage.
 */
export function validateInitFrameSequence(summary: InitFrameSummary): string[] {
  const issues: string[] = [];
  if(!summary.hasHandlerReturn) issues.push('missing handler_return');
  if(!summary.flushStageObserved) issues.push('no flush stage observed (dispatcher_send_resolved or transport_send_resolved)');
  if(!summary.hasTransportDetect) issues.push('missing transport_detect_init_result (dynamic path not exercised?)');
  if(!summary.hasTransportResolved) issues.push('missing transport_send_resolved');
  return issues;
}

/** Convenience pretty printer for debugging */
export function formatSummary(summary: InitFrameSummary): string {
  return JSON.stringify({ stages: Array.from(summary.stages), count: summary.events.length }, null, 2);
}
