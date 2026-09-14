/**
 * Shared directory resolution for storage that must be identical across every
 * MCP client attached to the same index.
 *
 * Why this module exists
 * ---------------------
 * Each MCP client (VS Code, Claude Code, Copilot CLI, Claude Desktop) launches
 * the server from a DIFFERENT working directory. Any storage default built from
 * `process.cwd()` therefore resolves to a different absolute path per client,
 * and the clients silently stop sharing state — a message broadcast from one is
 * invisible to the others, with no error anywhere, because each one is reading
 * a store it alone writes to.
 *
 * `INDEX_SERVER_DIR` is the one path every client already agrees on, so shared
 * storage derives from it, never from the working directory.
 *
 * Layout
 * ------
 *   <root>/index-server      <- INDEX_SERVER_DIR (the instruction catalog)
 *   <root>/index-messaging   <- messaging store, a SIBLING
 *   <root>/backups           <- existing catalog-relative sibling
 *
 * Deriving a sibling from the catalog is precedented by `backups`
 * (`<dirname(INDEX_SERVER_DIR)>/backups`, see dashboardConfig). Note that
 * `feedback` and `data/state` are NOT siblings — they are bare names anchored
 * to CWD, which is the class of defect this module exists to fix.
 *
 * The messaging store is deliberately a sibling and never a child: the catalog
 * loader scans its directory for instruction JSON, so message files written
 * inside it would be picked up as malformed instructions and pollute the index.
 *
 * Imports only `configUtils` and `dirConstants`, both leaves, so this module is
 * safe to import from any config domain module without an import cycle.
 */
import fs from 'fs';
import path from 'path';
import { CWD, toAbsolute, toStateAbsolute } from './configUtils';
import { DIR } from './dirConstants';

/**
 * Absolute instruction catalog directory. `INDEX_SERVER_DIR` when set,
 * otherwise `<cwd>/instructions`.
 */
export function resolveInstructionsDir(): string {
  return toAbsolute(process.env.INDEX_SERVER_DIR, path.join(CWD, DIR.INSTRUCTIONS));
}

/**
 * Canonical filesystem identity of `p`, resolving symlinks, junctions, 8.3 short
 * names, `\\?\` device prefixes and trailing space/dot components.
 *
 * `path.resolve` is purely lexical, so two strings naming the SAME directory can
 * compare as different — measured fail-open cases on win32 were a trailing-space
 * component, a trailing-dot component, an 8.3 short name and a `\\?\` device
 * path, each of which the OS resolves INTO the catalog while a lexical compare
 * called it outside.
 *
 * The target usually does not exist yet (the store is created after this check),
 * so walk up to the nearest existing ancestor, canonicalize that, and re-append
 * the non-existent tail. Falls back to the lexical form if nothing resolves.
 */
function realpathNearest(p: string): string {
  let cur = path.resolve(p);
  const tail: string[] = [];
  for (;;) {
    try {
      const real = fs.realpathSync.native(cur);
      return tail.length ? path.join(real, ...tail.slice().reverse()) : real;
    } catch {
      const parent = path.dirname(cur);
      // Reached the root without finding anything that exists.
      if (parent === cur) return path.resolve(p);
      tail.push(path.basename(cur));
      cur = parent;
    }
  }
}

/**
 * True when `child` is `parent` itself or nested anywhere beneath it.
 *
 * Compares CANONICAL paths, not lexical ones: an attacker is not the threat
 * model here (both operands are operator-set env vars), but an operator typing
 * a path the OS treats as equivalent and the guard does not is entirely normal,
 * and the failure is silent index corruption.
 *
 * Case handling is delegated to the filesystem where possible; the win32
 * lowercase fold remains as a backstop for the not-yet-existing tail, which
 * realpath cannot canonicalize.
 */
export function isPathInside(child: string, parent: string): boolean {
  const norm = (p: string) => {
    const resolved = realpathNearest(p);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const rel = path.relative(norm(parent), norm(child));
  if (rel === '') return true;
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** The pre-1.42 default, still holding messages on machines that ran older builds. */
const LEGACY_MESSAGING_SUBDIR = path.join('data', 'messaging');

/**
 * Deployment problems worth telling the operator about, as plain strings.
 *
 * PURE — it resolves paths and stats the filesystem but emits nothing. The
 * caller decides when to log, which matters: these are BOOT diagnostics about
 * how a deployment is wired, not per-call conditions. Emitting them from the
 * resolver produced one line per process, and a test run spawns hundreds of
 * processes — 273 in CI, which tripped the log-hygiene repeat threshold. Being
 * pure also makes them directly assertable without capturing stderr.
 *
 * Returns an empty array when nothing is wrong.
 */
export function getMessagingStoreWarnings(): string[] {
  const out: string[] = [];
  const explicit = process.env.INDEX_SERVER_MESSAGING_DIR?.trim() ?? '';
  const isExplicit = explicit.length > 0;
  const dir = resolveMessagingDir(false);

  // The INDEX_SERVER_DIR-unset warning that used to live here has been REMOVED,
  // not relaxed. It said the store "falls back to <cwd>/index-messaging,
  // derived from this process's working directory" — true when the default was
  // a sibling of the catalog, and false now that it is `<STATE_ROOT>/data/
  // messaging`. STATE_ROOT has no cwd fallback, so an unset INDEX_SERVER_DIR no
  // longer shards the store at all.
  //
  // Keeping it would have been worse than deleting it: a warning that fires on
  // a correct configuration teaches operators to ignore the channel, and this
  // one would fire on every default install.
  //
  // Note INDEX_SERVER_DIR is still worth pinning for a DIFFERENT reason — it is
  // the containment guard's parent operand, so an unpinned catalog makes the
  // guard's verdict vary per client. That is why flagCatalog still emits it as
  // active. It is a guard-consistency argument, not a siloing one.

  // A non-empty legacy store is orphaned: nothing points at it, so the TTL
  // sweeper never runs on it and `persistent` messages are invisible rather
  // than expired.
  const legacy = path.join(CWD, LEGACY_MESSAGING_SUBDIR);
  try {
    if (path.resolve(legacy) !== path.resolve(dir) && fs.readdirSync(legacy).length > 0) {
      out.push(
        `A legacy messaging store still holds files at "${legacy}" but is no longer read (the store is ` +
        `now "${dir}"). Messages there are orphaned: the TTL sweeper never runs on them, so "persistent" ` +
        `messages are invisible rather than expired. Copy the contents across, point ` +
        `INDEX_SERVER_MESSAGING_DIR at the old path, or delete it.`,
      );
    }
  } catch { /* absent or unreadable: nothing to say */ }

  return out;
}

/**
 * Absolute messaging store directory.
 *
 * Precedence:
 *   1. `INDEX_SERVER_MESSAGING_DIR` — explicit, always wins. Resolved against
 *      STATE_ROOT when relative.
 *   2. `<STATE_ROOT>/data/messaging` — derived, per-user, machine-wide.
 *
 * @param validate when false, the containment check is skipped and the path is
 * returned as-is. Messaging is the only consumer of this path, so when the
 * feature is switched off nothing writes there and a bad value cannot corrupt
 * the catalog. Skipping the throw keeps `INDEX_SERVER_MESSAGING_ENABLED=0`
 * usable as a genuine kill-switch: otherwise a poisoned override kills the
 * process before the handshake and the operator has no way to boot back in.
 *
 * @throws when the resolved directory would sit inside the instruction catalog.
 * That combination silently corrupts the index, so it fails loudly at boot
 * rather than writing message files into the catalog. An explicit override is
 * the common trigger, but the derived default collides too when the catalog is
 * itself named `index-messaging` or sits at a filesystem root.
 */
export function resolveMessagingDir(validate = true): string {
  const instructionsDir = resolveInstructionsDir();
  const explicit = process.env.INDEX_SERVER_MESSAGING_DIR;
  const trimmed = explicit?.trim() ?? '';
  const isExplicit = trimmed.length > 0;
  // Trimmed before resolution: a leading space defeats path.isAbsolute(), so an
  // untrimmed `INDEX_SERVER_MESSAGING_DIR= C:\store` would resolve against CWD
  // and hand every client a different private store — the exact split-brain
  // this module exists to prevent.
  // Default anchored to STATE_ROOT (#577), not to the catalog's parent.
  //
  // The previous default was `<dirname(INDEX_SERVER_DIR)>/index-messaging`,
  // which followed the catalog. That was an improvement on a cwd-relative
  // default but kept one residual: with INDEX_SERVER_DIR unset,
  // resolveInstructionsDir() falls back to `<cwd>/instructions`, so the store
  // landed at `<cwd>/index-messaging` — per-client again, which is the exact
  // split-brain this module exists to prevent. STATE_ROOT is per-user and
  // machine-wide, so it has no such fallback.
  //
  // An explicit value is resolved against STATE_ROOT when relative, matching
  // the other state paths; a relative value anchored to CWD would reintroduce
  // the same defect through an override.
  const dir = isExplicit
    ? toStateAbsolute(trimmed)
    : toStateAbsolute(undefined, DIR.DATA_MESSAGING);

  if (validate && isPathInside(dir, instructionsDir)) {
    throw new Error(
      `${isExplicit
        ? 'INDEX_SERVER_MESSAGING_DIR resolves'
        : `The derived messaging directory resolves`} inside the instruction catalog.\n` +
      `  messaging:    ${dir}\n` +
      `  instructions: ${instructionsDir}\n` +
      `Message files in the catalog are loaded as malformed instructions and corrupt the index. ` +
      `Set INDEX_SERVER_MESSAGING_DIR to a directory outside INDEX_SERVER_DIR — ` +
      `the recommended layout is the sibling "${DIR.MESSAGING}".`,
    );
  }
  return dir;
}
