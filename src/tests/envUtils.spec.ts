/**
 * RED/GREEN tests for src/utils/envUtils.ts
 *
 * Constitution TS-9: exercises real production parseEnv logic.
 * Constitution TS-4: validates exact return values for every input variant.
 *
 * Coverage targets:
 *  - parseBooleanEnv: all truthy strings (1, true, yes, on; case variations)
 *  - parseBooleanEnv: all falsy strings (0, false, no, off; case variations)
 *  - parseBooleanEnv: undefined input -> default
 *  - parseBooleanEnv: empty string -> default
 *  - parseBooleanEnv: unknown value -> default (false)
 *  - parseBooleanEnv: custom default value propagation
 *  - getBooleanEnv: reads process.env by name
 */
import { describe, it, expect, afterEach } from 'vitest';
import { parseBooleanEnv, getBooleanEnv } from '../utils/envUtils';

describe('parseBooleanEnv', () => {
  // -----------------------------------------------------------------------
  // Truthy values
  // -----------------------------------------------------------------------
  it('returns true for "1"', () => {
    expect(parseBooleanEnv('1')).toBe(true);
  });

  it('returns true for "true"', () => {
    expect(parseBooleanEnv('true')).toBe(true);
  });

  it('returns true for "TRUE" (case insensitive)', () => {
    expect(parseBooleanEnv('TRUE')).toBe(true);
  });

  it('returns true for "True" (mixed case)', () => {
    expect(parseBooleanEnv('True')).toBe(true);
  });

  it('returns true for "yes"', () => {
    expect(parseBooleanEnv('yes')).toBe(true);
  });

  it('returns true for "YES"', () => {
    expect(parseBooleanEnv('YES')).toBe(true);
  });

  it('returns true for "on"', () => {
    expect(parseBooleanEnv('on')).toBe(true);
  });

  it('returns true for "ON"', () => {
    expect(parseBooleanEnv('ON')).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Falsy values
  // -----------------------------------------------------------------------
  it('returns false for "0"', () => {
    expect(parseBooleanEnv('0')).toBe(false);
  });

  it('returns false for "false"', () => {
    expect(parseBooleanEnv('false')).toBe(false);
  });

  it('returns false for "FALSE"', () => {
    expect(parseBooleanEnv('FALSE')).toBe(false);
  });

  it('returns false for "no"', () => {
    expect(parseBooleanEnv('no')).toBe(false);
  });

  it('returns false for "NO"', () => {
    expect(parseBooleanEnv('NO')).toBe(false);
  });

  it('returns false for "off"', () => {
    expect(parseBooleanEnv('off')).toBe(false);
  });

  it('returns false for "OFF"', () => {
    expect(parseBooleanEnv('OFF')).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Undefined / empty -> default
  // -----------------------------------------------------------------------
  it('returns false (default) for undefined', () => {
    expect(parseBooleanEnv(undefined)).toBe(false);
  });

  it('returns false (default) for empty string', () => {
    expect(parseBooleanEnv('')).toBe(false);
  });

  it('respects custom default=true for undefined', () => {
    expect(parseBooleanEnv(undefined, true)).toBe(true);
  });

  it('respects custom default=true for empty string', () => {
    expect(parseBooleanEnv('', true)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Unknown values -> default
  // -----------------------------------------------------------------------
  it('returns false (default) for unknown value "maybe"', () => {
    expect(parseBooleanEnv('maybe')).toBe(false);
  });

  it('returns true (custom default) for unknown value "maybe"', () => {
    expect(parseBooleanEnv('maybe', true)).toBe(true);
  });

  it('handles leading/trailing whitespace via trim', () => {
    // Implementation trims before comparing, so " true " should be truthy
    expect(parseBooleanEnv(' true ')).toBe(true);
    expect(parseBooleanEnv(' 0 ')).toBe(false);
  });
});

describe('getBooleanEnv', () => {
  const TEST_VAR = '__TEST_BOOL_ENV_UTIL__';

  afterEach(() => {
    delete process.env[TEST_VAR];
  });

  it('returns true when env var is "1"', () => {
    process.env[TEST_VAR] = '1';
    expect(getBooleanEnv(TEST_VAR)).toBe(true);
  });

  it('returns false when env var is "0"', () => {
    process.env[TEST_VAR] = '0';
    expect(getBooleanEnv(TEST_VAR)).toBe(false);
  });

  it('returns false (default) when env var is unset', () => {
    expect(getBooleanEnv(TEST_VAR)).toBe(false);
  });

  it('returns true (custom default) when env var is unset', () => {
    expect(getBooleanEnv(TEST_VAR, true)).toBe(true);
  });

  it('returns true for "yes" value from process.env', () => {
    process.env[TEST_VAR] = 'yes';
    expect(getBooleanEnv(TEST_VAR)).toBe(true);
  });

  it('returns false for "off" value from process.env', () => {
    process.env[TEST_VAR] = 'off';
    expect(getBooleanEnv(TEST_VAR)).toBe(false);
  });
});
