/**
 * mcpConfigImperativeDirective.spec.ts
 * Purpose: Enforce the imperative directive that diagnostic / verbose flags in .vscode/mcp.json
 * must remain disabled (commented out or absent) unless a formal CHANGE REQUEST updates the baseline.
 *
 * Protected keys (must NOT be active):
 *  INDEX_SERVER_ALWAYS_RELOAD, INDEX_SERVER_LOG_DIAG,
 *  INDEX_AUTOSAVE_INTERVAL_MS
 *
 * Policy Change (2025-09-13): INDEX_SERVER_DEBUG is now ALLOWED to remain enabled by default per user directive.
 * The previous guard caused workflow friction; for deterministic CI one can re‑introduce enforcement
 * by adding it back to the forbiddenKeys array or gating with an env flag (future option).
 *
 * Change (2025-09-11 #1): INDEX_SERVER_LOG_FILE was previously enforced as forbidden but is now
 * allowed to remain enabled by default to support continuous file-based log
 * harvesting / diagnostics in local + CI runs. If future baseline drift occurs
 * and stricter determinism is required, re-add 'INDEX_SERVER_LOG_FILE' to forbiddenKeys
 * or gate allowance behind an env variable (e.g. ALLOW_LOG_FILE=1).
 *
 * Change (2025-09-11 #2): INDEX_SERVER_VERBOSE_LOGGING also allowed for richer local diagnostics.
 * If deterministic noise surface becomes problematic in CI, reintroduce via
 * forbiddenKeys or env‑gated enforcement.
 *
 * Rationale: These flags materially alter runtime behavior, noise level, or persistence timing.
 * Enabling them silently undermines deterministic baseline validation. This test creates a
 * hard failure signal if future modifications activate them without baseline process.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const filePath = join(process.cwd(), '.vscode', 'mcp.json');
const fileExists = existsSync(filePath);

describe.skipIf(!fileExists)('Imperative Directive: mcp.json diagnostic flags remain disabled', () => {
  let content = '';
  if (fileExists) {
    try {
      content = readFileSync(filePath, 'utf8');
    } catch (err) {
      throw new Error('Cannot read .vscode/mcp.json needed for directive enforcement: ' + (err as Error).message);
    }
  }

  const forbiddenKeys = [
    'INDEX_SERVER_ALWAYS_RELOAD',
    'INDEX_SERVER_LOG_DIAG',
    'INDEX_AUTOSAVE_INTERVAL_MS'
  ];

  // Matches an uncommented JSON property occurrence e.g. "INDEX_SERVER_DEBUG": or 'INDEX_SERVER_DEBUG':
  function activeKeyRegex(key: string) {
    return new RegExp(`^[^\\n]*"${key}"\\s*:`, 'm');
  }

  // Matches commented lines containing the key (// "INDEX_SERVER_DEBUG": or // 'INDEX_SERVER_DEBUG': ) – acceptable.
  function commentedKeyRegex(key: string) {
    return new RegExp(`^\\s*//\\s*"${key}"\\s*:`, 'm');
  }

  for (const key of forbiddenKeys) {
    const active = activeKeyRegex(key).test(content);
    if (active) {
      const commented = commentedKeyRegex(key).test(content);
      if (!commented) {
        throw new Error(`Forbidden active diagnostic flag detected in .vscode/mcp.json: ${key}. Must remain disabled/commented.`);
      }
      // If both active and commented appear (unlikely with current file), we still fail due to active occurrence.
    }
  }

  it('has no forbidden active diagnostic flags', () => {
    const activeForbiddenKeys = forbiddenKeys.filter(key => activeKeyRegex(key).test(content));
    expect(activeForbiddenKeys).toEqual([]);
  });

  it('documents imperative directive inside source for discoverability', () => {
    expect(forbiddenKeys).toEqual([
      'INDEX_SERVER_ALWAYS_RELOAD',
      'INDEX_SERVER_LOG_DIAG',
      'INDEX_AUTOSAVE_INTERVAL_MS'
    ]);
  });
});
