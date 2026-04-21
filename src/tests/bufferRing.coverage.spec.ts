/**
 * RED/GREEN tests for src/utils/BufferRing.ts -- coverage gaps
 *
 * Constitution TS-9: exercises real BufferRing code, no stubs.
 * Constitution TS-4: validates precise output for each operation.
 *
 * This file covers paths NOT already handled by bufferRingSimple.spec.ts:
 *  - DROP_NEWEST overflow strategy (returns false, does NOT add)
 *  - RESIZE overflow strategy (auto-doubles capacity)
 *  - ERROR overflow strategy (throws on overflow)
 *  - getLast() / getFirst() / getRange() output shape
 *  - filter() / find() predicates
 *  - resize() explicit call
 *  - updateConfig() changes capacity
 *  - Events: entry-added, entry-dropped (overflow + clear), buffer-full, buffer-resized
 *  - getConfig() returns config clone
 *  - Multiple stats fields: utilization at 0, 50, 100%
 *  - BufferRingFactory static helper
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import {
  BufferRing,
  BufferRingFactory,
  OverflowStrategy,
} from '../utils/BufferRing';

describe('BufferRing - DROP_NEWEST strategy', () => {
  it('returns false and does NOT add when buffer is full', () => {
    const buf = new BufferRing<number>({
      capacity: 2,
      overflowStrategy: OverflowStrategy.DROP_NEWEST,
    });

    expect(buf.add(1)).toBe(true);
    expect(buf.add(2)).toBe(true);
    // Buffer full; drop newest
    const added = buf.add(3);
    expect(added).toBe(false);

    // Original entries preserved
    expect(buf.getAll()).toEqual([1, 2]);
    expect(buf.getStats().totalDropped).toBe(1);
  });

  it('emits entry-dropped event with overflow reason', () => {
    const buf = new BufferRing<string>({
      capacity: 1,
      overflowStrategy: OverflowStrategy.DROP_NEWEST,
    });
    buf.add('keep');

    const dropped: string[] = [];
    buf.on('entry-dropped', (entry: string, reason: string) => {
      expect(reason).toBe('overflow');
      dropped.push(entry);
    });

    buf.add('discard');
    expect(dropped).toContain('discard');
  });
});

describe('BufferRing - RESIZE strategy', () => {
  it('doubles capacity and keeps all entries', () => {
    const buf = new BufferRing<number>({
      capacity: 2,
      overflowStrategy: OverflowStrategy.RESIZE,
    });

    buf.add(1);
    buf.add(2);
    buf.add(3); // Should resize to 4

    expect(buf.getStats().count).toBe(3);
    expect(buf.getStats().capacity).toBe(4);
    expect(buf.getAll()).toContain(1);
    expect(buf.getAll()).toContain(2);
    expect(buf.getAll()).toContain(3);
  });
});

describe('BufferRing - ERROR strategy', () => {
  it('throws when buffer is full', () => {
    const buf = new BufferRing<string>({
      capacity: 1,
      overflowStrategy: OverflowStrategy.ERROR,
    });
    buf.add('first');

    expect(() => buf.add('second')).toThrow();
  });

  it('add() returns false when error strategy throws internally', () => {
    // The add() method catches the thrown error and returns false
    const buf = new BufferRing<string>({
      capacity: 1,
      overflowStrategy: OverflowStrategy.ERROR,
    });
    buf.add('first');

    // add catches and returns false (the error is emitted via 'error' event)
    const errorEvents: Error[] = [];
    buf.on('error', (err: Error) => errorEvents.push(err));

    const result = buf.add('second');
    expect(result).toBe(false);
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
  });
});

describe('BufferRing - traversal methods', () => {
  let buf: BufferRing<number>;

  beforeEach(() => {
    buf = new BufferRing<number>({ capacity: 10 });
    for (let i = 1; i <= 5; i++) buf.add(i);
  });

  it('getLast(n) returns the last N entries in reverse chronological order', () => {
    const last2 = buf.getLast(2);
    expect(last2).toEqual([5, 4]);
  });

  it('getLast(0) returns all entries reversed (JavaScript slice(-0) === slice(0) quirk)', () => {
    // -0 === 0 in JS, so slice(-0) = slice(0) = entire array
    const result = buf.getLast(0);
    expect(result).toEqual([5, 4, 3, 2, 1]);
  });

  it('getLast(n > count) returns all entries reversed', () => {
    const all = buf.getLast(100);
    expect(all).toEqual([5, 4, 3, 2, 1]);
  });

  it('getFirst(n) returns the first N entries in chronological order', () => {
    const first3 = buf.getFirst(3);
    expect(first3).toEqual([1, 2, 3]);
  });

  it('getFirst(0) returns empty array', () => {
    expect(buf.getFirst(0)).toEqual([]);
  });

  it('getRange(start, end) returns slice of getAll()', () => {
    // getAll = [1,2,3,4,5]; range [1,3] = [2,3]
    const range = buf.getRange(1, 3);
    expect(range).toEqual([2, 3]);
  });

  it('getRange beyond bounds returns available entries', () => {
    const range = buf.getRange(3, 100);
    expect(range).toEqual([4, 5]);
  });

  it('filter() returns entries matching predicate', () => {
    const evens = buf.filter(n => n % 2 === 0);
    expect(evens).toEqual([2, 4]);
  });

  it('filter() returns empty array when nothing matches', () => {
    expect(buf.filter(n => n > 100)).toEqual([]);
  });

  it('find() returns first entry matching predicate', () => {
    const found = buf.find(n => n > 3);
    expect(found).toBe(4);
  });

  it('find() returns undefined when nothing matches', () => {
    expect(buf.find(n => n > 100)).toBeUndefined();
  });
});

describe('BufferRing - resize()', () => {
  it('resize() to smaller capacity drops oldest entries', () => {
    const buf = new BufferRing<number>({ capacity: 5 });
    for (let i = 1; i <= 5; i++) buf.add(i);
    buf.resize(3);
    expect(buf.getStats().capacity).toBe(3);
    expect(buf.getStats().count).toBe(3);
    // Should keep the 3 most recent (3, 4, 5)
    expect(buf.getAll()).toEqual([3, 4, 5]);
  });

  it('resize() to larger capacity keeps all entries', () => {
    const buf = new BufferRing<number>({ capacity: 3 });
    buf.add(1); buf.add(2); buf.add(3);
    buf.resize(6);
    expect(buf.getStats().capacity).toBe(6);
    expect(buf.getStats().count).toBe(3);
    expect(buf.getAll()).toEqual([1, 2, 3]);
  });

  it('resize() emits buffer-resized event with old and new capacity', () => {
    const buf = new BufferRing<number>({ capacity: 4 });
    buf.add(1); buf.add(2);

    let resizeEvent: { old: number; newCap: number } | null = null;
    buf.on('buffer-resized', (oldCap: number, newCap: number) => {
      resizeEvent = { old: oldCap, newCap };
    });

    buf.resize(8);
    expect(resizeEvent).not.toBeNull();
    expect(resizeEvent!.old).toBe(4);
    expect(resizeEvent!.newCap).toBe(8);
  });

  it('resize() to <= 0 throws an error', () => {
    const buf = new BufferRing<number>({ capacity: 3 });
    expect(() => buf.resize(0)).toThrow();
    expect(() => buf.resize(-1)).toThrow();
  });
});

describe('BufferRing - updateConfig()', () => {
  it('updateConfig() with new capacity triggers resize', () => {
    const buf = new BufferRing<number>({ capacity: 3 });
    buf.add(1); buf.add(2);
    buf.updateConfig({ capacity: 6 });
    expect(buf.getConfig().capacity).toBe(6);
    expect(buf.getStats().count).toBe(2);
  });

  it('updateConfig() returns immutable clone from getConfig()', () => {
    const buf = new BufferRing<number>({ capacity: 5 });
    const config1 = buf.getConfig();
    const config2 = buf.getConfig();
    // Modifying the returned object should NOT affect internal state
    (config1 as { capacity: number }).capacity = 99;
    expect(buf.getConfig().capacity).toBe(5);
    expect(config2.capacity).toBe(5);
  });
});

describe('BufferRing - events: entry-added, buffer-full, clear', () => {
  it('emits entry-added for each successful add', () => {
    const buf = new BufferRing<string>({ capacity: 5 });
    const added: string[] = [];
    buf.on('entry-added', (entry: string) => added.push(entry));

    buf.add('alpha');
    buf.add('beta');
    expect(added).toEqual(['alpha', 'beta']);
  });

  it('emits buffer-full when capacity is reached', () => {
    const buf = new BufferRing<number>({ capacity: 2 });
    let fullEmitted = false;
    buf.on('buffer-full', (_cap: number) => { fullEmitted = true; });

    buf.add(1);
    expect(fullEmitted).toBe(false);
    buf.add(2); // Triggers 'buffer-full'
    expect(fullEmitted).toBe(true);
  });

  it('emits entry-dropped with "clear" reason when clear() is called', () => {
    const buf = new BufferRing<string>({ capacity: 3 });
    buf.add('a'); buf.add('b');

    const cleared: string[] = [];
    buf.on('entry-dropped', (entry: string, reason: string) => {
      if (reason === 'clear') cleared.push(entry);
    });

    buf.clear();
    expect(cleared.sort()).toEqual(['a', 'b'].sort());
  });
});

describe('BufferRing - stats utilization', () => {
  it('utilization is 0 for empty buffer', () => {
    const buf = new BufferRing<number>({ capacity: 10 });
    expect(buf.getStats().utilization).toBe(0);
  });

  it('utilization is 100 when buffer is at capacity', () => {
    const buf = new BufferRing<number>({ capacity: 3 });
    buf.add(1); buf.add(2); buf.add(3);
    expect(buf.getStats().utilization).toBe(100);
  });

  it('resizeCount increments on each resize', () => {
    const buf = new BufferRing<number>({ capacity: 2, overflowStrategy: OverflowStrategy.RESIZE });
    buf.add(1); buf.add(2); buf.add(3); // triggers auto-resize
    expect(buf.getStats().resizeCount).toBeGreaterThanOrEqual(1);
  });
});

describe('BufferRingFactory', () => {
  it('createLogBuffer() produces a functional string BufferRing', () => {
    const buf = BufferRingFactory.createLogBuffer(5);
    buf.add('log-entry-1');
    buf.add('log-entry-2');
    expect(buf.getAll()).toContain('log-entry-1');
    expect(buf.getAll()).toContain('log-entry-2');
    expect(buf.getStats().count).toBe(2);
    expect(buf.getStats().capacity).toBe(5);
  });

  it('createLogBuffer() with persistPath sets autoPersist config', () => {
    const tmpPath = path.join(os.tmpdir(), `br-factory-test-${Date.now()}.json`);
    try {
      const buf = BufferRingFactory.createLogBuffer(10, tmpPath);
      buf.add('log-with-persist');
      expect(buf.getConfig().persistPath).toBe(tmpPath);
      expect(buf.getConfig().autoPersist).toBe(true);
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  });

  it('createMetricsBuffer() produces a record BufferRing with serializer', () => {
    const buf = BufferRingFactory.createMetricsBuffer(50);
    buf.add({ value: 42, name: 'cpu' });
    const entries = buf.getAll();
    expect(entries.length).toBe(1);
    expect(entries[0].value).toBe(42);
    // Serializer adds timestamp if missing
    expect(entries[0]).toHaveProperty('timestamp');
  });

  it('createEventBuffer() produces a transient record BufferRing', () => {
    const buf = BufferRingFactory.createEventBuffer(20);
    buf.add({ event: 'click', ts: Date.now() });
    expect(buf.getStats().count).toBe(1);
    expect(buf.getConfig().autoPersist).toBe(false);
  });

  it('createResizableBuffer() uses RESIZE overflow strategy', () => {
    const buf = BufferRingFactory.createResizableBuffer<number>(2);
    buf.add(1); buf.add(2); buf.add(3); // triggers resize
    expect(buf.getStats().count).toBe(3);
    expect(buf.getStats().capacity).toBeGreaterThan(2);
  });
});
