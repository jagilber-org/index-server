/**
 * index_add validation cluster — Issues #194, #193, #192
 *
 * #194: lax mode silently accepts shape-invalid priority/categories without success flag
 * #193: index_add leaks low-level Node ENOENT for null-byte id (should be invalid_instruction)
 * #192: index_add does not validate id length, leaks ENOENT for oversized id
 *
 * These tests call the handler directly so they're independent of MCP transport.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { reloadRuntimeConfig } from '../../config/runtimeConfig.js';
import { getHandler } from '../../server/registry.js';
import { invalidate } from '../../services/indexContext.js';
import { forceBootstrapConfirmForTests } from '../../services/bootstrapGating.js';

const TMP_ROOT = path.join(process.cwd(), 'tmp', 'index-add-validation-cluster');
const INSTRUCTIONS_DIR = path.join(TMP_ROOT, 'instructions');

type AddParams = Record<string, unknown>;
type AddResult = Record<string, unknown> & {
  success?: boolean;
  error?: string;
  created?: boolean;
  validationErrors?: string[];
  hints?: string[];
  id?: string;
};

function getRequiredHandler<T>(name: string): T {
  const handler = getHandler(name);
  if (!handler) throw new Error(`Handler ${name} not registered`);
  return handler as T;
}

function resetWorkspace(): void {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(INSTRUCTIONS_DIR, { recursive: true });
  invalidate();
}

describe('index_add validation cluster (#194 #193 #192)', () => {
  let add: (params: AddParams) => Promise<AddResult>;

  beforeAll(async () => {
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_DIR = INSTRUCTIONS_DIR;
    reloadRuntimeConfig();
    forceBootstrapConfirmForTests('add-validation-cluster');
    await import('../../services/handlers/instructions.add.js');
    add = getRequiredHandler<(params: AddParams) => Promise<AddResult>>('index_add');
  });

  beforeEach(() => {
    resetWorkspace();
  });

  afterAll(() => {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
    delete process.env.INDEX_SERVER_MUTATION;
    delete process.env.INDEX_SERVER_DIR;
    reloadRuntimeConfig();
  });

  // -------------------------------------------------------------------------
  // #194 — lax mode shape validation + explicit success flag
  // -------------------------------------------------------------------------
  describe('#194 lax mode shape validation', () => {
    it('rejects priority with wrong type (string) under lax mode', async () => {
      const result = await add({
        entry: { id: 'neg-prio-194', body: 'x', priority: 'high' },
        lax: true,
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('invalid_instruction');
      const errs = (result.validationErrors || []).join(' | ');
      expect(errs).toMatch(/priority/i);
    });

    it('rejects categories with wrong type (string) under lax mode', async () => {
      const result = await add({
        entry: { id: 'neg-cats-194', body: 'x', categories: 'not-an-array' },
        lax: true,
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('invalid_instruction');
      const errs = (result.validationErrors || []).join(' | ');
      expect(errs).toMatch(/categories/i);
    });

    it('returns explicit success:true on a valid lax add', async () => {
      const result = await add({
        entry: { id: 'happy-success-flag', body: 'happy body', title: 'happy' },
        lax: true,
      });
      expect(result.success).toBe(true);
      expect(result.created).toBe(true);
    });

    it('lax still fills defaults when typed fields are simply absent', async () => {
      const result = await add({
        entry: { id: 'lax-defaults-194', body: 'b' },
        lax: true,
      });
      expect(result.success).toBe(true);
      expect(result.created).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // #193 — null-byte / control char in id rejected, no Node leak
  // -------------------------------------------------------------------------
  describe('#193 null-byte id sanitization', () => {
    it('rejects id containing a null byte with invalid_instruction (no Node leak)', async () => {
      const result = await add({
        entry: { id: 'foo\u0000bar', body: 'x' },
        lax: true,
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('invalid_instruction');
      const msg = (result.validationErrors || []).join(' | ') + ' ' + String(result['message'] ?? '');
      // Must NOT leak Node internals
      expect(msg).not.toMatch(/null bytes/i);
      expect(msg).not.toMatch(/ENOENT/);
      expect(msg).not.toMatch(/Uint8Array/);
      // Must mention the offending character
      expect((result.validationErrors || []).some(v => /illegal|control|null/i.test(v))).toBe(true);
    });

    it('rejects id with low control character (\\x01)', async () => {
      const result = await add({
        entry: { id: 'foo\u0001bar', body: 'x' },
        lax: true,
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('invalid_instruction');
    });
  });

  // -------------------------------------------------------------------------
  // #192 — id length pre-validated, no ENOENT leak
  // -------------------------------------------------------------------------
  describe('#192 oversized id validation', () => {
    it('rejects id longer than 120 chars with invalid_instruction (no ENOENT leak)', async () => {
      const longId = 'a'.repeat(5000);
      const result = await add({
        entry: { id: longId, body: 'x' },
        lax: true,
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('invalid_instruction');
      const msg = (result.validationErrors || []).join(' | ') + ' ' + String(result['message'] ?? '');
      expect(msg).not.toMatch(/ENOENT/);
      expect(msg).not.toMatch(/no such file or directory/i);
      expect(msg).not.toMatch(/\.json/);
      expect((result.validationErrors || []).some(v => /too long|maximum length|exceeds/i.test(v))).toBe(true);
    });

    it('rejects id at length 121 (just over schema max 120)', async () => {
      const longId = 'a'.repeat(121);
      const result = await add({
        entry: { id: longId, body: 'x' },
        lax: true,
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('invalid_instruction');
    });

    it('accepts id at length 120 (schema max)', async () => {
      const exactId = 'a'.repeat(120);
      const result = await add({
        entry: { id: exactId, body: 'x', title: 't' },
        lax: true,
      });
      // Either created successfully or some other downstream failure; just must not be invalid_instruction
      // for length reasons, and must not leak ENOENT.
      const msg = (result.validationErrors || []).join(' | ') + ' ' + String(result['message'] ?? '');
      expect(msg).not.toMatch(/ENOENT/);
      if (result.success === false) {
        expect((result.validationErrors || []).some(v => /too long|maximum length|exceeds/i.test(v))).toBe(false);
      }
    });
  });
});
