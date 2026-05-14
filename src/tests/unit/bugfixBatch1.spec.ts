/**
 * Unit tests for bug fixes batch 1:
 * - #131: invariant repair summary is exposed
 * - #126: groom/normalize surface errors in response
 * - #138: handshakeManager catches use handshakeError
 * - #139: backgroundServicesStartup returns error info
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// ─── #131: invariant repair summary export ──────────────────────
describe('#131: invariant repair summary surfaced', () => {
  it('indexContext exports getInvariantRepairSummary', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/services/indexContext.ts'),
      'utf8'
    );
    expect(src).toContain('export function getInvariantRepairSummary');
    expect(src).toContain('trackInvariantRepair');
  });

  it('repair functions call trackInvariantRepair for each source', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/services/indexContext.ts'),
      'utf8'
    );
    // firstSeen repair sources
    expect(src).toContain("trackInvariantRepair(e.id, 'firstSeenTs', 'authority')");
    expect(src).toContain("trackInvariantRepair(e.id, 'firstSeenTs', 'ephemeral')");
    expect(src).toContain("trackInvariantRepair(e.id, 'firstSeenTs', 'snapshot')");
    expect(src).toContain("trackInvariantRepair(e.id, 'firstSeenTs', 'exhausted')");
    // usageCount repair sources
    expect(src).toContain("trackInvariantRepair(e.id, 'usageCount', 'authority')");
    expect(src).toContain("trackInvariantRepair(e.id, 'usageCount', 'observed')");
    expect(src).toContain("trackInvariantRepair(e.id, 'usageCount', 'snapshot')");
    expect(src).toContain("trackInvariantRepair(e.id, 'usageCount', 'zero-default')");
    // lastUsedAt repair sources
    expect(src).toContain("trackInvariantRepair(e.id, 'lastUsedAt', 'authority')");
    expect(src).toContain("trackInvariantRepair(e.id, 'lastUsedAt', 'snapshot')");
    expect(src).toContain("trackInvariantRepair(e.id, 'lastUsedAt', 'firstSeen-approx')");
  });
});

// ─── #126: groom handler surfaces errors ────────────────────────
describe('#126: groom/normalize error surfacing', () => {
  it('groom handler includes errors in response', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/services/handlers/instructions.groom.ts'),
      'utf8'
    );
    const groomStart = src.indexOf("registerHandler('index_groom'");
    const groomEnd = src.indexOf("registerHandler('index_normalize'");
    const groomSection = src.slice(groomStart, groomEnd);

    // Should declare errors array
    expect(groomSection).toContain('const errors: { id: string; error: string }[]');
    // Should push write failures to errors
    expect(groomSection).toContain('errors.push({ id, error: `write-failed:');
    // Retirement now archives (instead of deletes); archive errors are surfaced separately
    expect(groomSection).toContain('archiveErrors.push({ id, error: detail })');
    // Should surface errors in response
    expect(groomSection).toContain("if (errors.length) resp.errors = errors");
  });

  it('normalize handler includes errors in response', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/services/handlers/instructions.groom.ts'),
      'utf8'
    );
    const normStart = src.indexOf("registerHandler('index_normalize'");
    const normSection = src.slice(normStart);

    // Should have errors array
    expect(normSection).toContain('errors:');
    // Should surface errors in response
    expect(normSection).toContain('normalizeResp.errors = errors');
    // No silent catch-ignore for writeEntry
    expect(normSection).not.toMatch(/try\s*\{\s*writeEntry[^}]*\}\s*catch\s*\{\s*continue\s*;\s*\}/);
  });
});

// ─── #138: handshakeManager error visibility ────────────────────
// After decomposition (#138 follow-up) the handshake logic lives in
// src/server/handshake/*.ts plus the thin facade src/server/handshakeManager.ts.
// We scan the entire decomposed surface for the original guarantees.
describe('#138: handshakeManager silent catch replacement', () => {
  const handshakeRoot = path.join(process.cwd(), 'src/server/handshake');
  const facadePath = path.join(process.cwd(), 'src/server/handshakeManager.ts');

  function readAllHandshakeSources(): { path: string; src: string }[] {
    const files = fs
      .readdirSync(handshakeRoot)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => path.join(handshakeRoot, f));
    files.push(facadePath);
    return files.map((p) => ({ path: p, src: fs.readFileSync(p, 'utf8') }));
  }

  it('replaces /* ignore */ catches with handshakeError calls', () => {
    const sources = readAllHandshakeSources();
    let bareIgnoreCount = 0;
    for (const { src } of sources) {
      // Allow the single bare ignore inside the handshakeError fallback itself
      // (the helper's own catch swallows stderr-write failures by design).
      const handshakeErrorDef = src.indexOf('function handshakeError');
      let combined = src;
      if (handshakeErrorDef !== -1) {
        const handshakeErrorEnd = src.indexOf('\n  }\n', handshakeErrorDef);
        const splitAt = handshakeErrorEnd === -1
          ? src.indexOf('\n', handshakeErrorDef + 1)
          : handshakeErrorEnd;
        combined = src.slice(0, handshakeErrorDef) + src.slice(splitAt);
      }
      const matches = combined.match(/catch\s*\{\s*\/\*\s*ignore\s*\*\/\s*\}/g) || [];
      bareIgnoreCount += matches.length;
    }
    expect(bareIgnoreCount).toBeLessThanOrEqual(0);
  });

  it('handshakeError function is defined and writes to stderr', () => {
    const sources = readAllHandshakeSources();
    const combined = sources.map((s) => s.src).join('\n');
    expect(combined).toContain('function handshakeError(context: string, err: unknown)');
    expect(combined).toContain('[handshake-error]');
  });
});

// ─── #139: backgroundServicesStartup return type ────────────────
describe('#139: backgroundServicesStartup error surfacing', () => {
  it('returns started services and errors', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/server/backgroundServicesStartup.ts'),
      'utf8'
    );
    // Should return an object with started and errors arrays
    expect(src).toContain('{ started: string[]; errors: { service: string; error: string }[] }');
    // Should push to started array on success
    expect(src).toContain("started.push('indexVersionPoller')");
    expect(src).toContain("started.push('autoBackup')");
    // Should push to errors array on failure
    expect(src).toContain("errors.push({ service: 'indexVersionPoller'");
    expect(src).toContain("errors.push({ service: 'autoBackup'");
    // Should not have bare catch { /* ignore stderr */ }
    expect(src).not.toContain('/* ignore stderr */');
    // Should log warnings instead of ignoring
    expect(src).toContain("log('WARN'");
  });
});

// ─── #135: shared utilities are used by handlers ────────────────
describe('#135: duplicated logic extracted to shared utilities', () => {
  it('groom handler imports shared utilities', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/services/handlers/instructions.groom.ts'),
      'utf8'
    );
    expect(src).toContain('computeSourceHash');
    expect(src).toContain('normalizeCategories');
    // Note: isJunkCategory is used transitively via normalizeCategories
    // (which filters junk categories internally), so it does not need to be
    // imported directly in the groom handler.
  });

  it('patch handler imports shared bumpVersion and createChangeLogEntry', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/services/handlers/instructions.patch.ts'),
      'utf8'
    );
    expect(src).toContain('bumpVersion');
    expect(src).toContain('createChangeLogEntry');
  });

  it('groom handler no longer has inline isJunkCategory definition', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/services/handlers/instructions.groom.ts'),
      'utf8'
    );
    // Should not have the inline function definition
    expect(src).not.toMatch(/const isJunkCategory = \(cat: string\).*=>/);
  });

  it('patch handler no longer has inline version bump logic', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/services/handlers/instructions.patch.ts'),
      'utf8'
    );
    // Should not have inline parts[0]++; parts[1]++; etc.
    expect(src).not.toMatch(/parts\[0\]\+\+.*parts\[1\]\+\+/);
  });
});
