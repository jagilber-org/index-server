/**
 * catalogGrowth — reconstruct catalog size over time from entry timestamps.
 *
 * Why this exists alongside the activity log:
 *
 * `activityLog` records catalog *events* as they happen, so it can only ever
 * describe the period since telemetry was switched on. When that feature
 * shipped, the dashboard's 30-day Catalog Activity chart had roughly 36 hours
 * of data and 29 empty buckets — correct, and useless for the question people
 * actually ask, which is "how has the index grown?".
 *
 * Every instruction already carries `createdAt` (and archived rows carry
 * `archivedAt`), so the growth curve does not need to be measured going
 * forward — it can be derived from the catalog as it stands today, back to the
 * oldest entry. No accumulated telemetry, no waiting, and it survives a
 * telemetry database being lost or reset.
 *
 * IMPORTANT — this is a SURVIVOR CURVE, not a measured time series.
 *
 * It reconstructs "when the entries that exist today were created". An entry
 * that was created in March and hard-deleted in April leaves no row anywhere,
 * so it contributes nothing and the curve understates the catalog's historical
 * size. Archived entries ARE recoverable (they keep a row plus `archivedAt`),
 * so they are counted into the running total on their creation day and removed
 * on their archive day. Callers must surface this distinction rather than
 * presenting the line as measured history — see `derived: true` on the result
 * and the caveat rendered under the chart.
 */

/** Minimal shape this module needs; both storage backends satisfy it. */
export interface GrowthSourceEntry {
  createdAt?: string | null;
  archivedAt?: string | null;
}

export interface GrowthPoint {
  /** Bucket start, epoch ms. */
  ts: number;
  /** Entries created in this bucket. */
  added: number;
  /** Entries archived in this bucket. */
  archived: number;
  /** Running catalog size at the END of this bucket, including pre-window entries. */
  cumulative: number;
}

export interface GrowthResult {
  points: GrowthPoint[];
  /** Catalog size immediately before the first bucket. */
  baseline: number;
  /** Entries whose createdAt was missing or unparseable; excluded from the curve. */
  undated: number;
  totals: {
    /** Entries considered (live + archived, minus undated). */
    entries: number;
    archived: number;
    firstCreated: string | null;
    lastCreated: string | null;
  };
  /** Always true — a reminder at the API boundary that this is reconstructed. */
  derived: true;
}

/**
 * Parse an ISO-8601 timestamp to epoch ms, or null.
 *
 * Deliberately strict about the result rather than the input: `Date.parse`
 * accepts a lot, but anything that yields NaN is treated as absent so a
 * hand-edited entry cannot silently land on 1970 and drag the curve's origin
 * back by half a century.
 */
function toEpoch(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Build the cumulative growth series.
 *
 * @param entries All catalog entries, live and archived.
 * @param opts.since  Window start (epoch ms). Entries created before this are
 *                    folded into `baseline` rather than dropped — otherwise a
 *                    30-day view of a seven-month-old catalog would open at
 *                    zero and imply the index had just been created.
 * @param opts.until  Window end (epoch ms).
 * @param opts.bucketMs Bucket width.
 */
export function computeCatalogGrowth(
  entries: readonly GrowthSourceEntry[],
  opts: { since: number; until: number; bucketMs: number },
): GrowthResult {
  const { since, until, bucketMs } = opts;
  if (!Number.isFinite(bucketMs) || bucketMs <= 0) {
    throw new Error(`computeCatalogGrowth: bucketMs must be a positive number, got ${bucketMs}`);
  }

  const created: number[] = [];
  const archived: number[] = [];
  let undated = 0;
  let firstCreated: number | null = null;
  let lastCreated: number | null = null;

  for (const entry of entries) {
    const c = toEpoch(entry.createdAt);
    if (c === null) { undated++; continue; }
    created.push(c);
    if (firstCreated === null || c < firstCreated) firstCreated = c;
    if (lastCreated === null || c > lastCreated) lastCreated = c;

    const a = toEpoch(entry.archivedAt);
    // An archive stamped before its own creation is corrupt; ignore the archive
    // rather than letting the running total go negative.
    if (a !== null && a >= c) archived.push(a);
  }

  // Baseline: everything that already existed when the window opens. Archived
  // entries that were archived before the window must not be counted.
  const firstBucket = Math.floor(since / bucketMs) * bucketMs;
  let running = 0;
  for (const c of created) if (c < firstBucket) running++;
  for (const a of archived) if (a < firstBucket) running--;
  const baseline = running;

  const addedByBucket = new Map<number, number>();
  const archivedByBucket = new Map<number, number>();
  const bump = (map: Map<number, number>, ts: number) => {
    const b = Math.floor(ts / bucketMs) * bucketMs;
    map.set(b, (map.get(b) ?? 0) + 1);
  };
  for (const c of created) if (c >= firstBucket && c <= until) bump(addedByBucket, c);
  for (const a of archived) if (a >= firstBucket && a <= until) bump(archivedByBucket, a);

  // Dense series, matching /usage/activity: a bucket with no change is a real
  // observation ("nothing was added that day"), and omitting it would let a
  // quiet month render as adjacent to a busy one.
  const points: GrowthPoint[] = [];
  for (let ts = firstBucket; ts <= until; ts += bucketMs) {
    const added = addedByBucket.get(ts) ?? 0;
    const arch = archivedByBucket.get(ts) ?? 0;
    running += added - arch;
    points.push({ ts, added, archived: arch, cumulative: running });
  }

  return {
    points,
    baseline,
    undated,
    totals: {
      entries: created.length,
      archived: archived.length,
      firstCreated: firstCreated === null ? null : new Date(firstCreated).toISOString(),
      lastCreated: lastCreated === null ? null : new Date(lastCreated).toISOString(),
    },
    derived: true,
  };
}
