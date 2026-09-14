/**
 * In-process ring buffer of recent log events at WARN/ERROR severity.
 *
 * Surfaces operationally-meaningful events to the admin dashboard so operators
 * do not have to tail server logs. Read-only, bounded; never persists to disk.
 *
 * Capacity defaults to 500. The logger emits records via `recordEvent()` only
 * for WARN or ERROR levels so that volume on healthy systems is negligible.
 *
 * Constitution alignment: OB-1, OB-3, OB-4, OB-5 (structured, severity-visible).
 */

import { DEFAULT_EVENT_BUFFER_CAPACITY, eventBufferCapacity } from '../config/serviceEnv.js';

export type EventLevel = 'WARN' | 'ERROR';

export interface BufferedEvent {
  /** Monotonically increasing per-process id (used for unread counts). */
  id: number;
  /** ISO 8601 timestamp. */
  ts: string;
  /** Severity. */
  level: EventLevel;
  /** Message; prefix `[module]` is preserved. */
  msg: string;
  /** Optional stack/detail snippet. */
  detail?: string;
  /** Process id of emitter. */
  pid?: number;
}

class EventRing {
  private buf: BufferedEvent[] = [];
  private nextId = 1;
  private capacity = DEFAULT_EVENT_BUFFER_CAPACITY;

  /**
   * Read the configured capacity (env: INDEX_SERVER_EVENT_BUFFER_SIZE, min 50,
   * max 5000). Resolved by `config/serviceEnv` per call rather than from the
   * memoized RuntimeConfig snapshot, so a capacity change still takes effect
   * without a restart — see `add()` below.
   */
  private resolveCapacity(): number {
    return eventBufferCapacity();
  }

  add(level: EventLevel, msg: string, detail?: string, pid?: number): void {
    // Refresh capacity lazily so runtime changes take effect.
    const cap = this.resolveCapacity();
    if (cap !== this.capacity) {
      this.capacity = cap;
      if (this.buf.length > cap) this.buf.splice(0, this.buf.length - cap);
    }
    const evt: BufferedEvent = {
      id: this.nextId++,
      ts: new Date().toISOString(),
      level,
      msg,
      pid,
    };
    if (detail) evt.detail = detail.length > 4096 ? detail.slice(0, 4096) + '…' : detail;
    this.buf.push(evt);
    if (this.buf.length > this.capacity) this.buf.shift();
  }

  /** List events newer than `sinceId` (exclusive), optionally filtered by level. */
  list(opts: { sinceId?: number; level?: EventLevel; limit?: number } = {}): BufferedEvent[] {
    const sinceId = opts.sinceId ?? 0;
    const limit = Math.min(1000, Math.max(1, opts.limit ?? 200));
    const filtered: BufferedEvent[] = [];
    for (let i = this.buf.length - 1; i >= 0 && filtered.length < limit; i--) {
      const e = this.buf[i];
      if (e.id <= sinceId) break;
      if (opts.level && e.level !== opts.level) continue;
      filtered.push(e);
    }
    return filtered.reverse();
  }

  /** Counts of WARN and ERROR events newer than `sinceId`. */
  counts(sinceId: number = 0): { warn: number; error: number; total: number; latestId: number } {
    let warn = 0, error = 0;
    for (const e of this.buf) {
      if (e.id <= sinceId) continue;
      if (e.level === 'WARN') warn++;
      else if (e.level === 'ERROR') error++;
    }
    const latestId = this.buf.length ? this.buf[this.buf.length - 1].id : 0;
    return { warn, error, total: warn + error, latestId };
  }

  clear(): void {
    this.buf = [];
  }

  /** Test-only: current size. */
  size(): number { return this.buf.length; }
}

const ring = new EventRing();

/** Emit a WARN/ERROR event into the buffer. Called by the logger. */
export function recordEvent(level: EventLevel, msg: string, detail?: string, pid?: number): void {
  ring.add(level, msg, detail, pid);
}

/** List recent events (most recent last). */
export function listEvents(opts?: { sinceId?: number; level?: EventLevel; limit?: number }): BufferedEvent[] {
  return ring.list(opts);
}

/** Compute new-event counts since the supplied id (used for the dashboard counter bubble). */
export function eventCounts(sinceId?: number): { warn: number; error: number; total: number; latestId: number } {
  return ring.counts(sinceId);
}

/** Clear the buffer (used by `Mark all read` and tests). */
export function clearEvents(): void {
  ring.clear();
}

/** Test-only helper. */
export function _eventBufferSize(): number {
  return ring.size();
}
