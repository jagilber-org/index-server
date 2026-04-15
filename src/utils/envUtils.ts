/**
 * Utility functions for environment variable parsing
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
