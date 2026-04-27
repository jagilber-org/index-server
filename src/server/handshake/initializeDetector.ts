/**
 * Pure detector for the MCP `initialize` JSON-RPC method in a buffered
 * stdin stream. Handles three increasingly tolerant strategies used by the
 * legacy stdin sniffer:
 *
 *   - direct  : exact `"method":"initialize"` substring match
 *   - fuzzy   : reconstruct `initialize` near a `"method"` sentinel allowing
 *               up to 3 character gaps between target letters
 *   - subseq  : letters-only subsequence match across the whole window
 *
 * The detector is intentionally side-effect free; callers own logging.
 */

export type InitializeDetectMode = 'direct' | 'fuzzy' | 'subseq';

export interface InitializeDetectResult {
  mode: InitializeDetectMode | null;
}

const TARGET = 'initialize';
const FUZZY_MAX_GAPS = 3;
const FUZZY_SLICE_LEN = 1200;
const FALLBACK_SLICE_LEN = 2000;

function tryFuzzy(slice: string): boolean {
  let ti = 0;
  let gaps = 0;
  for (let i = 0; i < slice.length && ti < TARGET.length; i++) {
    const ch = slice[i];
    if (ch.toLowerCase?.() === TARGET[ti]) {
      ti++;
      gaps = 0;
      continue;
    }
    if (gaps < FUZZY_MAX_GAPS) {
      gaps++;
      continue;
    }
    ti = 0;
    gaps = 0;
    if (ch.toLowerCase?.() === TARGET[ti]) {
      ti++;
    }
  }
  return ti === TARGET.length;
}

function trySubseq(buffer: string): boolean {
  const letters = buffer.replace(/[^a-zA-Z]/g, '').toLowerCase();
  let ti = 0;
  for (let i = 0; i < letters.length && ti < TARGET.length; i++) {
    if (letters[i] === TARGET[ti]) ti++;
  }
  return ti === TARGET.length;
}

/**
 * Detect an `initialize` request method anywhere in `buffer`.
 *
 * @param buffer  raw stdin bytes decoded as utf8
 * @param fallbackSliceEnabled when true, also probe the trailing 2KB if no
 *        `"method"` sentinel was found (enables aggressive scanning during
 *        `INDEX_SERVER_TRACE=healthMixed`)
 */
export function detectInitializeMethod(
  buffer: string,
  fallbackSliceEnabled = false,
): InitializeDetectResult {
  if (/"method"\s*:\s*"initialize"/.test(buffer)) {
    return { mode: 'direct' };
  }
  const methodIdx = buffer.indexOf('"method"');
  const sliceA = methodIdx !== -1 ? buffer.slice(methodIdx, methodIdx + FUZZY_SLICE_LEN) : '';
  const trySlices: string[] = sliceA ? [sliceA] : [];
  if (!sliceA && fallbackSliceEnabled) trySlices.push(buffer.slice(-FALLBACK_SLICE_LEN));
  for (const slice of trySlices) {
    if (tryFuzzy(slice)) return { mode: 'fuzzy' };
  }
  if (trySubseq(buffer)) return { mode: 'subseq' };
  return { mode: null };
}

/**
 * Extract a numeric `id` from a JSON-RPC frame embedded in `buffer`. Returns
 * the matched integer or `null` when no plausible id is present. Limited to
 * 6 digits to match legacy behavior.
 */
export function extractRequestId(buffer: string): number | null {
  const m = /"id"\s*:\s*(\d{1,6})/.exec(buffer);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}
