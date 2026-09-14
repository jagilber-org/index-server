/**
 * catalogGrowth — cumulative catalog size reconstructed from entry timestamps.
 *
 * The motivating defect: the dashboard could not show index growth because the
 * only history it had was an activity log that started 36 hours earlier. These
 * tests pin the derivation that replaces it, including the parts that are easy
 * to get quietly wrong — the pre-window baseline, archived entries, and
 * entries with no usable createdAt.
 */
import { describe, it, expect } from 'vitest';
import { computeCatalogGrowth, type GrowthSourceEntry } from '../services/catalogGrowth.js';

const DAY = 24 * 60 * 60 * 1000;
const day = (iso: string) => Date.parse(iso);
const entry = (createdAt: string | null, archivedAt?: string | null): GrowthSourceEntry =>
  ({ createdAt, archivedAt: archivedAt ?? null });

describe('computeCatalogGrowth', () => {
  it('accumulates entries across daily buckets', () => {
    const result = computeCatalogGrowth(
      [entry('2026-01-01T10:00:00Z'), entry('2026-01-01T18:00:00Z'), entry('2026-01-03T00:00:00Z')],
      { since: day('2026-01-01T00:00:00Z'), until: day('2026-01-03T23:59:00Z'), bucketMs: DAY },
    );
    expect(result.points.map((p) => [p.added, p.cumulative])).toEqual([
      [2, 2], // Jan 1
      [0, 2], // Jan 2 — quiet day is a real observation, not a gap
      [1, 3], // Jan 3
    ]);
  });

  it('emits a dense series so a quiet stretch cannot be compressed away', () => {
    const result = computeCatalogGrowth(
      [entry('2026-01-01T00:00:00Z'), entry('2026-01-10T00:00:00Z')],
      { since: day('2026-01-01T00:00:00Z'), until: day('2026-01-10T00:00:00Z'), bucketMs: DAY },
    );
    expect(result.points).toHaveLength(10);
    expect(result.points.every((p) => p.cumulative >= 1)).toBe(true);
  });

  it('folds pre-window entries into a baseline instead of starting at zero', () => {
    // The real shape of the problem: a seven-month-old catalog viewed through a
    // 30-day window must not look like it was created last month.
    const old = Array.from({ length: 250 }, () => entry('2026-02-08T00:00:00Z'));
    const result = computeCatalogGrowth(
      [...old, entry('2026-09-05T00:00:00Z')],
      { since: day('2026-09-01T00:00:00Z'), until: day('2026-09-06T00:00:00Z'), bucketMs: DAY },
    );
    expect(result.baseline).toBe(250);
    expect(result.points[0].cumulative).toBe(250);
    expect(result.points.at(-1)?.cumulative).toBe(251);
  });

  it('subtracts archived entries on their archive day', () => {
    const result = computeCatalogGrowth(
      [
        entry('2026-01-01T00:00:00Z'),
        entry('2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z'),
      ],
      { since: day('2026-01-01T00:00:00Z'), until: day('2026-01-04T00:00:00Z'), bucketMs: DAY },
    );
    expect(result.points.map((p) => p.cumulative)).toEqual([2, 2, 1, 1]);
    expect(result.points[2].archived).toBe(1);
    expect(result.totals.archived).toBe(1);
  });

  it('excludes entries archived before the window from the baseline', () => {
    const result = computeCatalogGrowth(
      [entry('2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'), entry('2026-01-01T00:00:00Z')],
      { since: day('2026-06-01T00:00:00Z'), until: day('2026-06-02T00:00:00Z'), bucketMs: DAY },
    );
    expect(result.baseline).toBe(1);
  });

  it('counts entries with no usable createdAt as undated rather than placing them at 1970', () => {
    const result = computeCatalogGrowth(
      [entry('2026-01-02T00:00:00Z'), entry(null), entry('not-a-date')],
      { since: day('2026-01-01T00:00:00Z'), until: day('2026-01-03T00:00:00Z'), bucketMs: DAY },
    );
    expect(result.undated).toBe(2);
    expect(result.totals.entries).toBe(1);
    // Critically, the curve's origin is not dragged back to the epoch.
    expect(result.totals.firstCreated).toBe('2026-01-02T00:00:00.000Z');
    expect(result.points.at(-1)?.cumulative).toBe(1);
  });

  it('ignores an archivedAt that precedes its own createdAt', () => {
    // Corrupt ordering must not drive the running total negative.
    const result = computeCatalogGrowth(
      [entry('2026-01-03T00:00:00Z', '2026-01-01T00:00:00Z')],
      { since: day('2026-01-01T00:00:00Z'), until: day('2026-01-04T00:00:00Z'), bucketMs: DAY },
    );
    expect(result.points.every((p) => p.cumulative >= 0)).toBe(true);
    expect(result.points.at(-1)?.cumulative).toBe(1);
    expect(result.totals.archived).toBe(0);
  });

  it('is monotonic when nothing is archived', () => {
    const entries = Array.from({ length: 40 }, (_, i) =>
      entry(new Date(day('2026-03-01T00:00:00Z') + i * DAY).toISOString()));
    const result = computeCatalogGrowth(entries, {
      since: day('2026-03-01T00:00:00Z'), until: day('2026-04-10T00:00:00Z'), bucketMs: DAY,
    });
    const cums = result.points.map((p) => p.cumulative);
    expect(cums).toEqual([...cums].sort((a, b) => a - b));
    expect(cums.at(-1)).toBe(40);
  });

  it('handles an empty catalog without producing NaN', () => {
    const result = computeCatalogGrowth([], {
      since: day('2026-01-01T00:00:00Z'), until: day('2026-01-03T00:00:00Z'), bucketMs: DAY,
    });
    expect(result.totals.entries).toBe(0);
    expect(result.totals.firstCreated).toBeNull();
    expect(result.points.every((p) => p.cumulative === 0)).toBe(true);
  });

  it('supports weekly bucketing', () => {
    const result = computeCatalogGrowth(
      [entry('2026-01-01T00:00:00Z'), entry('2026-01-02T00:00:00Z'), entry('2026-01-20T00:00:00Z')],
      { since: day('2026-01-01T00:00:00Z'), until: day('2026-01-22T00:00:00Z'), bucketMs: 7 * DAY },
    );
    expect(result.points.at(-1)?.cumulative).toBe(3);
    expect(result.points.reduce((n, p) => n + p.added, 0)).toBe(3);
  });

  it('rejects a non-positive bucket width instead of looping forever', () => {
    expect(() => computeCatalogGrowth([], { since: 0, until: DAY, bucketMs: 0 }))
      .toThrow(/bucketMs must be a positive number/);
  });

  it('marks the result as derived so callers cannot present it as measured history', () => {
    const result = computeCatalogGrowth([entry('2026-01-01T00:00:00Z')], {
      since: day('2026-01-01T00:00:00Z'), until: day('2026-01-02T00:00:00Z'), bucketMs: DAY,
    });
    expect(result.derived).toBe(true);
  });
});
