/**
 * Utility functions for environment variable parsing.
 *
 * ## Why this file reads `process.env` directly (#611 / constitution S-4)
 *
 * This module is **below** the config layer, not outside it. `runtimeConfig.ts`
 * imports `getBooleanEnv`, `parseBooleanEnv`, `isFalsy`, `isFalsyExtended`,
 * `isTruthy`, `isDebugOrVerbose` and `TRUTHY_OR_DEFAULT` from here to do its own
 * parsing, so routing these reads back through `runtimeConfig` would be a hard
 * import cycle — and a self-referential one: the loader would have to be loaded
 * to answer a question the loader asks while loading.
 *
 * `scripts/governance/config-usage-baseline.json` therefore records
 * `INDEX_SERVER_DEBUG` and `INDEX_SERVER_VERBOSE_LOGGING` here as **permanent**
 * exemptions with that justification, rather than as work still to do. The
 * exemption is per `path::VAR`, not per file, so a NEW variable read added to
 * this module still fails `guard:env`.
 */

// ── Canonical truthy / falsy value sets ──────────────────────────────
export const TRUTHY_VALUES  = ['1', 'true', 'yes', 'on']  as const;
export const FALSY_VALUES   = ['0', 'false', 'no', 'off'] as const;
export const FALSY_VALUES_EXTENDED = ['0', 'false', 'no', 'off', 'disabled', 'none'] as const;
export const TRUTHY_OR_DEFAULT = ['true', 'on', 'yes', 'default'] as const;

/**
 * Check whether a raw string is a recognised truthy value.
 */
export function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return (TRUTHY_VALUES as readonly string[]).includes(value.toLowerCase().trim());
}

/**
 * Check whether a raw string is a recognised falsy value.
 */
export function isFalsy(value: string | undefined): boolean {
  if (!value) return false;
  return (FALSY_VALUES as readonly string[]).includes(value.toLowerCase().trim());
}

/**
 * Extended falsy check that also recognises "disabled" and "none".
 */
export function isFalsyExtended(value: string | undefined): boolean {
  if (!value) return false;
  return (FALSY_VALUES_EXTENDED as readonly string[]).includes(value.toLowerCase().trim());
}

/**
 * Returns true when DEBUG or VERBOSE_LOGGING env flags are set.
 * Consolidates the repeated `process.env.INDEX_SERVER_DEBUG === '1' ||
 * process.env.INDEX_SERVER_VERBOSE_LOGGING === '1'` check.
 */
export function isDebugOrVerbose(): boolean {
  return process.env.INDEX_SERVER_DEBUG === '1' || process.env.INDEX_SERVER_VERBOSE_LOGGING === '1';
}

/**
 * Parse a boolean environment variable that accepts multiple truthy/falsy values:
 * - Truthy: "1", "true", "yes", "on" (case insensitive)
 * - Falsy: "0", "false", "no", "off" (case insensitive) or undefined/empty
 *
 * @param envVar - The environment variable value
 * @param defaultValue - Default value if envVar is undefined/empty (default: false)
 * @returns boolean value
 */
export function parseBooleanEnv(envVar: string | undefined, defaultValue = false): boolean {
  if (!envVar) return defaultValue;

  const normalized = envVar.toLowerCase().trim();

  if ((TRUTHY_VALUES as readonly string[]).includes(normalized)) {
    return true;
  }

  if ((FALSY_VALUES as readonly string[]).includes(normalized)) {
    return false;
  }

  // Unknown values default to false
  return defaultValue;
}

/**
 * Get a boolean environment variable with consistent parsing
 * @param name - Environment variable name
 * @param defaultValue - Default value if not set (default: false)
 * @returns boolean value
 */
export function getBooleanEnv(name: string, defaultValue = false): boolean {
  return parseBooleanEnv(process.env[name], defaultValue);
}

/**
 * True when running under a test harness.
 *
 * `VITEST` covers in-process specs and any child that inherits the environment;
 * `NODE_ENV=test` catches runners that set only that. A child spawned with a
 * deliberately scrubbed environment still slips through — callers that must be
 * certain have to be told explicitly.
 *
 * **This is deliberately not a runtime-config key**, and `VITEST` is instead
 * allowlisted by name in `scripts/governance/enforce-config-usage.ts`. It is a
 * fact about the process, not a setting: a config key would be writable through
 * the dashboard overrides overlay, which means an admin-config write could tell
 * a production server it is a test run — and `activityLog.isEnabled()` uses
 * exactly this predicate to switch telemetry OFF. That would be a silent,
 * persistent disable of the audit-adjacent activity trail.
 */
export function isTestEnvironment(): boolean {
  return Boolean(process.env.VITEST) || process.env.NODE_ENV === 'test';
}

/**
 * Dangerous diagnostics are only available in explicit debug / stress sessions.
 */
export function dangerousDiagnosticsEnabled(): boolean {
  return getBooleanEnv('INDEX_SERVER_STRESS_DIAG') || getBooleanEnv('INDEX_SERVER_DEBUG');
}
