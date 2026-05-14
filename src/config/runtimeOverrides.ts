/**
 * Runtime overrides overlay — dashboard-managed persistent env-var layer.
 *
 * Plan §2.3 (issue #359) / Morpheus revision 2026-05-12.
 *
 * The overlay is a JSON object at `data/runtime-overrides.json` (or
 * `INDEX_SERVER_OVERRIDES_FILE` when set). Each key is an `INDEX_SERVER_*`
 * env-var name; each value is a string. Boolean / numeric flags are stored
 * stringified — they are coerced by their respective parse* functions in
 * runtimeConfig.ts the same way an inherited env value is.
 *
 * Boot wiring:
 *   import './config/runtimeOverrides';        // import for side-effects? — NO
 *   import { applyOverlay } from './config/runtimeOverrides';
 *   applyOverlay();                            // call FIRST, before any
 *                                              // getRuntimeConfig() in any entry-point
 *
 * The module itself is side-effect-free on import so test harnesses can
 * inspect read functions without forcing an overlay merge.
 *
 * Precedence policy (resolved 2026-05-12):
 *   overlay  >  process.env (at boot)  >  built-in defaults
 *
 * `INDEX_SERVER_DISABLE_OVERRIDES=1` opts out entirely — applyOverlay() is a no-op.
 *
 * Atomicity: writeOverride() / clearOverride() write a sibling `.tmp` file
 * then `fs.renameSync()` over the destination. Same-filesystem rename is
 * atomic on every supported platform, so partially-written overlays cannot
 * be observed by a concurrent reader. The *read-modify-write* envelope
 * (readOverlay → mutate → atomicWriteJson) is NOT mutex-guarded: two
 * concurrent POST /admin/config writers touching disjoint keys can race
 * and the second writer's snapshot will lose the first writer's key.
 * Single-admin operation is the assumed deployment contract; callers
 * needing concurrent writes from multiple admins must serialize externally.
 *
 * Malformed overlay files (parse error, non-object root, non-string values)
 * are logged as a WARN via console.warn and treated as `{}` — boot continues.
 * Operators are expected to repair the file out-of-band; this module
 * intentionally does NOT call logAudit() to keep early-boot config
 * bootstrap free of higher-level service dependencies.
 */
import fs from 'fs';
import path from 'path';

/** Map of env-var name -> string value present at the moment applyOverlay() ran. */
type EnvSnapshot = Record<string, string | undefined>;

/** Diagnostic record from the last applyOverlay() call. */
export interface ApplyOverlayResult {
  /** Overlay file that was read (may be undefined when missing). */
  file?: string;
  /** Number of keys merged into process.env. */
  applied: number;
  /** Whether overlay was disabled (INDEX_SERVER_DISABLE_OVERRIDES=1). */
  disabled: boolean;
  /** Whether the file was missing or unreadable. */
  missing: boolean;
  /**
   * For each overlay key: the prior process.env value (if any) at boot.
   * Used to compute `overlayShadowsEnv` on the GET /api/admin/config response.
   */
  shadowed: Record<string, string | undefined>;
}

const DEFAULT_OVERLAY_RELPATH = path.join('data', 'runtime-overrides.json');

/** Snapshot of pre-overlay env values, populated by applyOverlay(). */
let _shadowSnapshot: EnvSnapshot = {};

/** Most recent result from applyOverlay(), exported for diagnostics. */
let _lastResult: ApplyOverlayResult | undefined;

/**
 * Resolve the overlay file path. Honors INDEX_SERVER_OVERRIDES_FILE.
 * Returns an absolute path; the file may or may not exist.
 */
export function overlayFilePath(): string {
  const override = process.env.INDEX_SERVER_OVERRIDES_FILE;
  if (override && override.length > 0) {
    return path.isAbsolute(override) ? override : path.resolve(process.cwd(), override);
  }
  return path.resolve(process.cwd(), DEFAULT_OVERLAY_RELPATH);
}

/**
 * Read the overlay file. Returns `{}` for any failure mode:
 *  - file missing
 *  - read error
 *  - JSON parse error
 *  - root is not an object
 *  - values that are not strings are dropped (with a single WARN)
 *
 * Callers must tolerate `{}` as a valid result and proceed.
 */
export function readOverlay(): Record<string, string> {
  return readOverlayDetailed().entries;
}

/**
 * Internal variant of readOverlay that also reports whether the file was
 * missing at read time. Used by applyOverlay() to avoid the
 * `fs.readFileSync` → `fs.existsSync` TOCTOU window where the file could
 * appear or vanish between the two probes.
 */
function readOverlayDetailed(): { entries: Record<string, string>; missing: boolean } {
  const file = overlayFilePath();
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { entries: {}, missing: true };
    }
    // eslint-disable-next-line no-console
    console.warn(`[runtimeOverrides] cannot read overlay file ${file}: ${(err as Error).message}`);
    return { entries: {}, missing: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[runtimeOverrides] overlay file ${file} is malformed JSON; ignoring. ${(err as Error).message}`);
    return { entries: {}, missing: false };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    // eslint-disable-next-line no-console
    console.warn(`[runtimeOverrides] overlay file ${file} root is not a JSON object; ignoring.`);
    return { entries: {}, missing: false };
  }
  const out: Record<string, string> = {};
  let droppedNonString = 0;
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
    else droppedNonString++;
  }
  if (droppedNonString > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[runtimeOverrides] dropped ${droppedNonString} non-stringifiable entries in ${file}`);
  }
  return { entries: out, missing: false };
}

/**
 * Merge the overlay file into process.env.
 *
 * Precedence: overlay value WINS over any pre-existing process.env value.
 * Pre-existing values are captured in the shadow snapshot so the dashboard
 * can later surface `overlayShadowsEnv:true` plus the original ENV value.
 *
 * No-op when INDEX_SERVER_DISABLE_OVERRIDES is truthy.
 *
 * Idempotent: calling twice has the same effect as calling once, except that
 * the shadow snapshot reflects the env state at the SECOND call (current env
 * already contains the overlay values from the first call). For correct
 * overlayShadowsEnv reporting, callers should invoke applyOverlay() exactly
 * once per boot, before any consumer reads process.env.
 */
export function applyOverlay(): ApplyOverlayResult {
  const disabled = isTruthy(process.env.INDEX_SERVER_DISABLE_OVERRIDES);
  const file = overlayFilePath();
  if (disabled) {
    const result: ApplyOverlayResult = { file, applied: 0, disabled: true, missing: false, shadowed: {} };
    _lastResult = result;
    _shadowSnapshot = {};
    return result;
  }
  const { entries: overlay, missing } = readOverlayDetailed();
  const shadowed: EnvSnapshot = {};
  let applied = 0;
  for (const [k, v] of Object.entries(overlay)) {
    const prior = process.env[k];
    if (prior !== undefined && prior !== v) shadowed[k] = prior;
    process.env[k] = v;
    applied++;
  }
  _shadowSnapshot = shadowed;
  const result: ApplyOverlayResult = { file, applied, disabled: false, missing, shadowed };
  _lastResult = result;
  return result;
}

/**
 * Atomically persist a single overlay entry. The on-disk file is read,
 * merged, and rewritten via a sibling `.tmp` file + rename.
 *
 * Throws on filesystem failure or when the key targets a readonly flag.
 * Caller is responsible for invoking `reloadRuntimeConfig()` after writing
 * if the change should take effect for `dynamic` reload-behavior flags.
 * Also mutates process.env[key] synchronously so subsequent reads observe
 * the new value without a reload.
 *
 * Defense-in-depth (#359 H1): the admin route already filters writes through
 * the FLAG_REGISTRY before calling, but this module performs an independent
 * lazy lookup so any future caller cannot accidentally bypass the readonly
 * contract and persist secrets to the on-disk overlay.
 */
export function writeOverride(key: string, value: string): void {
  validateKey(key);
  assertWriteable(key);
  const file = overlayFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const current = readOverlay();
  current[key] = value;
  atomicWriteJson(file, current);
  // Shadow capture (#359 A2 quality remediation):
  // If this key has no entry in _shadowSnapshot yet, this is the FIRST write
  // since boot — applyOverlay() either didn't run or didn't cover this key.
  // Capture the *current* process.env value (which is the pre-overlay value
  // because we haven't mutated env yet) so a later clearOverride() can
  // restore "the env value the operator had before they touched the
  // overlay" rather than silently deleting the env var. The captured value
  // may be `undefined` to record "was unset"; clearOverride()'s `priorShadow
  // !== undefined` check then correctly falls through to `delete`.
  if (!(key in _shadowSnapshot)) {
    _shadowSnapshot[key] = process.env[key];
    if (isTruthy(process.env.INDEX_SERVER_LOG_DIAG)) {
      // eslint-disable-next-line no-console
      console.debug(`[runtimeOverrides] captured shadow at first write: ${key} prior=${process.env[key] === undefined ? '<unset>' : JSON.stringify(process.env[key])}`);
    }
  }
  process.env[key] = value;
}

/**
 * Remove a single overlay entry. The on-disk file is rewritten via the
 * same atomic temp+rename pattern. Idempotent — clearing a missing key
 * still rewrites the overlay (canonicalized) but is otherwise a no-op
 * for process.env.
 *
 * Also restores `process.env[key]` to its boot-time shadowed value when
 * one was captured by applyOverlay(); otherwise deletes the env var so
 * the next runtimeConfig load falls back to the built-in default.
 * This colocates the env-restore contract with the on-disk removal so
 * callers can rely on "after clearOverride, process.env reflects the
 * pre-overlay world" without having to reproduce the shadow lookup
 * (#359 reliability advisory).
 */
export function clearOverride(key: string): void {
  validateKey(key);
  const file = overlayFilePath();
  const current = readOverlay();
  const hadKey = key in current;
  if (hadKey) {
    delete current[key];
    fs.mkdirSync(path.dirname(file), { recursive: true });
    atomicWriteJson(file, current);
  }
  // Env restore: if applyOverlay captured a shadowed pre-overlay value, put
  // it back; otherwise drop the var so defaults apply on the next reload.
  // Performed unconditionally (even when hadKey===false) so callers can use
  // clearOverride() to forcibly reset a key to its boot-time state.
  const priorShadow = _shadowSnapshot[key];
  if (priorShadow !== undefined) {
    process.env[key] = priorShadow;
  } else {
    delete process.env[key];
  }
}

/**
 * Returns the snapshot of pre-overlay process.env values captured during the
 * last applyOverlay() call. Maps `INDEX_SERVER_*` -> the value that was in
 * process.env BEFORE the overlay wrote on top of it.
 *
 * Used by the dashboard API to populate `overlayShadowsEnv` per flag.
 */
export function shadowedEnv(): Readonly<EnvSnapshot> {
  return _shadowSnapshot;
}

/** Diagnostic getter for the most recent applyOverlay() invocation. */
export function lastOverlayResult(): ApplyOverlayResult | undefined {
  return _lastResult;
}

// ---------- internals ----------

function isTruthy(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function validateKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0) {
    throw new TypeError('runtimeOverrides: key must be a non-empty string');
  }
  if (!/^INDEX_SERVER_[A-Z0-9_]+$/.test(key)) {
    throw new TypeError(`runtimeOverrides: key "${key}" must match /^INDEX_SERVER_[A-Z0-9_]+$/`);
  }
}

/**
 * Defense-in-depth readonly enforcement (#359 H1).
 *
 * The FLAG_REGISTRY is the single source of truth for which flags are
 * dashboard-writable. The admin route already filters writes against it, but
 * writeOverride() performs an independent lookup so that any future caller
 * (a CLI tool, a migration script, a different route) cannot accidentally
 * bypass the readonly contract and persist a secret to the on-disk overlay.
 *
 * The registry is populated via `registerReadonlyFlags()`, called at module
 * load time from `src/services/handlers.dashboardConfig.ts`. This avoids any
 * circular import (`runtimeOverrides` is loaded first at boot; the registry
 * module loads later and registers itself as a side effect).
 *
 * Until the registry has registered itself, writeOverride() fails open — the
 * upstream admin-route gate is the primary defense and we don't want a load
 * race to brick the overlay during early-boot operations.
 */
let _readonlyFlags: ReadonlySet<string> = new Set();

/**
 * Register the set of registry flags that are NOT dashboard-writable
 * (`editable: false` in FlagMeta). Idempotent; subsequent calls replace the
 * set entirely.
 */
export function registerReadonlyFlags(names: Iterable<string>): void {
  _readonlyFlags = new Set(names);
}

function assertWriteable(key: string): void {
  if (_readonlyFlags.has(key)) {
    throw new TypeError(`runtimeOverrides: key "${key}" is registry-readonly; refusing to persist`);
  }
}

/** Test-only: clear the readonly registry so subsequent registration is observable. */
export function __resetReadonlyBlocklistForTests(): void {
  _readonlyFlags = new Set();
}

function atomicWriteJson(target: string, data: Record<string, string>): void {
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  const body = JSON.stringify(data, sortedKeys(data), 2) + '\n';
  fs.writeFileSync(tmp, body, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.renameSync(tmp, target);
  } catch (err) {
    // Best-effort cleanup of the tmp file if rename fails.
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

/** JSON.stringify replacer that emits keys in sorted order for diff-friendliness. */
function sortedKeys(data: Record<string, string>): (this: unknown, key: string, value: unknown) => unknown {
  const keys = Object.keys(data).sort();
  return function (this: unknown, key: string, value: unknown): unknown {
    if (key === '' && value && typeof value === 'object' && !Array.isArray(value)) {
      const out: Record<string, unknown> = {};
      for (const k of keys) out[k] = (value as Record<string, unknown>)[k];
      return out;
    }
    return value;
  };
}
