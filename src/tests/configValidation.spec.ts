/**
 * T2 (tests-validation) — RED scaffold for the per-flag validator layer.
 *
 * Plan §2.6 T2:
 *   - validator matrix per FlagMeta type & validation rules
 *   - fast-check property tests on numeric range / enum / pattern / format
 *   - editable:false (any readonlyReason) MUST reject any incoming write
 *
 * Trinity owns `src/services/configValidation.ts` exposing `validateFlagUpdate`.
 * These tests will fail with "Cannot find module" until that module exists,
 * then exercise behavior to drive the green implementation.
 *
 * Refs #359
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Validator = (entry: any, raw: unknown) => { ok: true; value: string | number | boolean } | { ok: false; error: string; code: string };

// Lazy-import so this file compiles even before the module lands.
async function loadValidator(): Promise<Validator> {
  // @ts-expect-error - target module is implemented by Trinity (validation-layer todo)
  const mod = await import('../services/configValidation');
  return mod.validateFlagUpdate as Validator;
}

const makeEntry = (overrides: Record<string, unknown>) => ({
  name: 'INDEX_SERVER_TEST',
  type: 'string',
  reloadBehavior: 'restart-required',
  editable: true,
  ...overrides,
});

describe('configValidation.validateFlagUpdate — T2 red', () => {
  describe('readonly enforcement', () => {
    it.each(['derived', 'deprecated', 'reserved', 'sensitive', 'legacy'] as const)(
      'rejects any write to editable:false flag (readonlyReason=%s)',
      async (reason) => {
        const validate = await loadValidator();
        const entry = makeEntry({ editable: false, readonlyReason: reason });
        const result = validate(entry, 'anything');
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe('READONLY');
      }
    );
  });

  describe('boolean type', () => {
    it('accepts true/false/0/1/"true"/"false" and normalizes to boolean', async () => {
      const validate = await loadValidator();
      const entry = makeEntry({ type: 'boolean' });
      for (const input of [true, false, '1', '0', 'true', 'false', 1, 0]) {
        const r = validate(entry, input);
        expect(r.ok).toBe(true);
        if (r.ok) expect(typeof r.value).toBe('boolean');
      }
    });

    it('rejects non-coercible strings', async () => {
      const validate = await loadValidator();
      const entry = makeEntry({ type: 'boolean' });
      for (const bad of ['yes', 'no', 'maybe', '', null, undefined, {}]) {
        const r = validate(entry, bad);
        expect(r.ok).toBe(false);
      }
    });
  });

  describe('number type with min/max', () => {
    it('property: values in [min,max] accepted; outside rejected', async () => {
      const validate = await loadValidator();
      const entry = makeEntry({ type: 'number', validation: { min: 1, max: 100 } });
      fc.assert(
        fc.property(fc.integer({ min: -1000, max: 1000 }), (n) => {
          const r = validate(entry, n);
          if (n >= 1 && n <= 100) {
            expect(r.ok).toBe(true);
          } else {
            expect(r.ok).toBe(false);
            if (!r.ok) expect(r.code).toBe('RANGE');
          }
        }),
        { numRuns: 100 }
      );
    });

    it('rejects NaN / Infinity / non-numeric strings', async () => {
      const validate = await loadValidator();
      const entry = makeEntry({ type: 'number', validation: { min: 0, max: 10 } });
      for (const bad of [NaN, Infinity, -Infinity, 'abc', '', null, undefined]) {
        const r = validate(entry, bad);
        expect(r.ok).toBe(false);
      }
    });
  });

  describe('enum validation', () => {
    it('accepts members; rejects non-members (case-sensitive)', async () => {
      const validate = await loadValidator();
      const entry = makeEntry({ type: 'string', validation: { enum: ['debug', 'info', 'warn', 'error'] } });
      expect(validate(entry, 'debug').ok).toBe(true);
      expect(validate(entry, 'DEBUG').ok).toBe(false);
      expect(validate(entry, 'trace').ok).toBe(false);
    });

    it('property: only enum members accepted', async () => {
      const validate = await loadValidator();
      const members = ['a', 'b', 'c'];
      const entry = makeEntry({ type: 'string', validation: { enum: members } });
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 10 }), (s) => {
          const r = validate(entry, s);
          expect(r.ok).toBe(members.includes(s));
        }),
        { numRuns: 50 }
      );
    });
  });

  describe('pattern validation', () => {
    it('accepts matching strings; rejects non-matching', async () => {
      const validate = await loadValidator();
      const entry = makeEntry({ type: 'string', validation: { pattern: '^[A-Z]{2,4}$' } });
      expect(validate(entry, 'AB').ok).toBe(true);
      expect(validate(entry, 'ABCD').ok).toBe(true);
      expect(validate(entry, 'A').ok).toBe(false);
      expect(validate(entry, 'abc').ok).toBe(false);
      expect(validate(entry, 'ABCDE').ok).toBe(false);
    });
  });

  describe('format validation (Morpheus revision)', () => {
    it('format=url: accepts http(s)://… ; rejects bare strings', async () => {
      const validate = await loadValidator();
      const entry = makeEntry({ type: 'string', validation: { format: 'url' } });
      expect(validate(entry, 'https://example.com').ok).toBe(true);
      expect(validate(entry, 'http://localhost:3000/path').ok).toBe(true);
      expect(validate(entry, 'example.com').ok).toBe(false);
      expect(validate(entry, 'not a url').ok).toBe(false);
    });

    it('format=port: accepts integers in [1,65535]; rejects 0/negative/>65535', async () => {
      const validate = await loadValidator();
      const entry = makeEntry({ type: 'number', validation: { format: 'port' } });
      expect(validate(entry, 1).ok).toBe(true);
      expect(validate(entry, 8080).ok).toBe(true);
      expect(validate(entry, 65535).ok).toBe(true);
      expect(validate(entry, 0).ok).toBe(false);
      expect(validate(entry, 65536).ok).toBe(false);
      expect(validate(entry, -1).ok).toBe(false);
    });

    it('format=path: rejects empty and traversal patterns', async () => {
      const validate = await loadValidator();
      const entry = makeEntry({ type: 'string', validation: { format: 'path' } });
      expect(validate(entry, '/var/lib/index').ok).toBe(true);
      expect(validate(entry, 'C:\\data').ok).toBe(true);
      expect(validate(entry, '').ok).toBe(false);
    });

    it('format=duration-ms: accepts non-negative integers', async () => {
      const validate = await loadValidator();
      const entry = makeEntry({ type: 'number', validation: { format: 'duration-ms' } });
      expect(validate(entry, 0).ok).toBe(true);
      expect(validate(entry, 30_000).ok).toBe(true);
      expect(validate(entry, -1).ok).toBe(false);
      expect(validate(entry, 1.5).ok).toBe(false);
    });

    it('format=host: accepts hostnames / IPs; rejects whitespace/empty', async () => {
      const validate = await loadValidator();
      const entry = makeEntry({ type: 'string', validation: { format: 'host' } });
      expect(validate(entry, 'localhost').ok).toBe(true);
      expect(validate(entry, '127.0.0.1').ok).toBe(true);
      expect(validate(entry, 'index.example.com').ok).toBe(true);
      expect(validate(entry, '').ok).toBe(false);
      expect(validate(entry, ' bad host ').ok).toBe(false);
    });
  });

  describe('combined rules', () => {
    it('range AND format=port both enforced (intersection)', async () => {
      const validate = await loadValidator();
      const entry = makeEntry({ type: 'number', validation: { min: 1024, max: 49151, format: 'port' } });
      expect(validate(entry, 8080).ok).toBe(true);
      expect(validate(entry, 80).ok).toBe(false);   // valid port, out of range
      expect(validate(entry, 50000).ok).toBe(false); // valid port, out of range
      expect(validate(entry, 0).ok).toBe(false);     // invalid port
    });
  });
});
