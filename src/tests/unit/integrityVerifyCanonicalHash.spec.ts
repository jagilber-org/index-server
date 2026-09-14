import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { reloadRuntimeConfig } from '../../config/runtimeConfig';
import { getHandler } from '../../server/registry';
import { invalidate } from '../../services/indexContext';
import { hashBody, canonicalizeBody } from '../../services/canonical';

const TMP_ROOT = path.join(process.cwd(), 'tmp', 'integrity-canonical-hash');
const INSTRUCTIONS_DIR = path.join(TMP_ROOT, 'instructions');

function rawHash(body: string): string {
  return crypto.createHash('sha256').update(body, 'utf8').digest('hex');
}

function writeInstruction(id: string, body: string, sourceHash: string): void {
  const entry = {
    id,
    title: `Test ${id}`,
    body,
    categories: ['test'],
    primaryCategory: 'test',
    owner: 'test-runner',
    contentType: 'instruction',
    audience: 'all',
    requirement: 'optional',
    version: '1.0.0',
    priority: 50,
    sourceHash,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(INSTRUCTIONS_DIR, `${id}.json`),
    JSON.stringify(entry, null, 2),
  );
}

// Mirror the write path: instructions.add.ts stores body.trim() on disk
// and computes sourceHash as hashBody(rawBody). Since trim is idempotent
// and canonicalizeBody subsumes trim for well-formed bodies, the test
// helper persists body.trim() with hashBody(body.trim()) — matching what
// a real round-trip through index_add would produce for bodies that do
// not start/end with non-newline whitespace on their first/last content line.
function writeInstructionRealistic(id: string, body: string): void {
  const trimmed = body.trim();
  writeInstruction(id, trimmed, hashBody(trimmed));
}

function resetWorkspace(): void {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(INSTRUCTIONS_DIR, { recursive: true });
  invalidate();
}

type IntegrityResult = {
  hash: string;
  count: number;
  issues: { id: string; expected: string; actual: string }[];
  issueCount: number;
};

describe('integrity_verify canonical hash symmetry (#514, #515)', () => {
  let integrityVerify: () => Promise<IntegrityResult>;

  beforeAll(async () => {
    process.env.INDEX_SERVER_DIR = INSTRUCTIONS_DIR;
    delete process.env.INDEX_SERVER_CANONICAL_DISABLE;
    reloadRuntimeConfig();

    await import('../../services/handlers.integrity.js');
    const handler = getHandler('integrity_verify');
    if (!handler) throw new Error('integrity_verify handler not registered');
    integrityVerify = handler as () => Promise<IntegrityResult>;
  });

  beforeEach(() => {
    resetWorkspace();
  });

  afterAll(() => {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
    delete process.env.INDEX_SERVER_DIR;
    delete process.env.INDEX_SERVER_CANONICAL_DISABLE;
    reloadRuntimeConfig();
  });

  it('passes for body with CRLF line endings when sourceHash is canonical', async () => {
    const body = 'line one\r\nline two\r\nline three';
    writeInstructionRealistic('crlf-entry', body);
    const result = await integrityVerify();
    expect(result.issueCount).toBe(0);
  });

  it('passes for body with trailing spaces when sourceHash is canonical', async () => {
    const body = 'line one   \nline two\t\nline three  ';
    writeInstructionRealistic('trailing-ws', body);
    const result = await integrityVerify();
    expect(result.issueCount).toBe(0);
  });

  it('passes for body with leading/trailing blank lines when sourceHash is canonical', async () => {
    const body = '\n\n\nactual content here\n\n\n';
    writeInstructionRealistic('blank-lines', body);
    const result = await integrityVerify();
    expect(result.issueCount).toBe(0);
  });

  it('passes for clean LF body when sourceHash is canonical', async () => {
    const body = 'clean line one\nclean line two';
    writeInstructionRealistic('clean-lf', body);
    const result = await integrityVerify();
    expect(result.issueCount).toBe(0);
  });

  it('detects genuinely tampered body (check that cannot fail IS a check)', async () => {
    const originalBody = 'original content';
    const tamperedBody = 'modified content';
    writeInstruction('tampered', tamperedBody, hashBody(originalBody));
    const result = await integrityVerify();
    expect(result.issueCount).toBe(1);
    expect(result.issues[0].id).toBe('tampered');
  });

  it('handles mixed normalization in a single run (>=5 cases)', async () => {
    const cases = [
      { id: 'mix-crlf', body: 'a\r\nb' },
      { id: 'mix-trailing', body: 'a   \nb' },
      { id: 'mix-leading-blank', body: '\n\na\nb' },
      { id: 'mix-trailing-blank', body: 'a\nb\n\n\n' },
      { id: 'mix-clean', body: 'a\nb' },
      { id: 'mix-combo', body: 'hello\r\nworld  \r\nfoo\t' },
    ];
    for (const c of cases) {
      writeInstructionRealistic(c.id, c.body);
    }
    const result = await integrityVerify();
    expect(result.count).toBe(cases.length);
    expect(result.issueCount).toBe(0);
  });

  it('uses raw hash when canonicalDisable is true', async () => {
    process.env.INDEX_SERVER_CANONICAL_DISABLE = '1';
    reloadRuntimeConfig();

    const body = 'line one\r\nline two';
    const trimmed = body.trim();
    writeInstruction('raw-mode', trimmed, rawHash(trimmed));
    invalidate();
    const result = await integrityVerify();
    expect(result.issueCount).toBe(0);

    delete process.env.INDEX_SERVER_CANONICAL_DISABLE;
    reloadRuntimeConfig();
  });

  it('raw hash mismatches canonical hash for CRLF body (proves branch matters)', () => {
    const body = 'line one\r\nline two';
    expect(rawHash(body)).not.toBe(hashBody(body));
    const canon = canonicalizeBody(body);
    expect(rawHash(canon)).toBe(hashBody(body));
  });
});
