/**
 * Follow-up to #193: ensure loadExistingEntry never leaks absolute paths or
 * raw Node fs error metadata into client-facing responses.
 *
 * Three leak surfaces in src/services/handlers/instructions.add.ts:
 *   - hydration path (overwrite + missing body/title) -> message interpolation
 *   - overwrite read path -> message interpolation
 *   - duplicate-write path -> validationErrors echoes loadErrors[].error
 */
import fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sanitizeLoadError, sanitizeErrorDetail } from '../../services/instructionRecordValidation';

describe('sanitizeLoadError helper', () => {
  it('strips Windows absolute paths from ENOENT messages', () => {
    const err = new Error("ENOENT: no such file or directory, open 'C:\\internal\\secrets\\foo.json'");
    const result = sanitizeLoadError(err, 'load_failed');
    expect(result.code).toBe('load_failed');
    expect(result.detail).not.toContain('C:\\');
    expect(result.detail).not.toContain('ENOENT');
    expect(result.detail).not.toContain('foo.json');
    expect(result.detail).not.toContain('secrets');
    expect(result.detail.length).toBeGreaterThan(0);
  });

  it('strips unix absolute paths', () => {
    const err = new Error('EACCES: permission denied, open /var/lib/secret/data.json');
    const result = sanitizeLoadError(err, 'load_failed');
    expect(result.detail).not.toContain('/var/');
    expect(result.detail).not.toContain('/lib/');
    expect(result.detail).not.toContain('EACCES');
    expect(result.detail).not.toContain('data.json');
  });

  it('returns parse_failed code and removes paths for parse errors', () => {
    const err = new Error('Unexpected token } in JSON at C:\\internal\\corrupt.json:5:12');
    const result = sanitizeLoadError(err, 'parse_failed');
    expect(result.code).toBe('parse_failed');
    expect(result.detail).not.toContain('C:\\');
    expect(result.detail).not.toContain('corrupt.json');
  });

  it('preserves raw message for internal audit logging', () => {
    const err = new Error("ENOENT: open 'C:\\foo\\bar.json'");
    const result = sanitizeLoadError(err, 'load_failed');
    expect(result.raw).toContain('ENOENT');
    expect(result.raw).toContain('C:\\foo');
  });

  it('falls back to a safe default when message is empty', () => {
    const result = sanitizeLoadError(new Error(''), 'load_failed');
    expect(result.detail).toBeTruthy();
    expect(result.code).toBe('load_failed');
  });

  it('strips multi-line stack traces to first line', () => {
    const err = new Error("ENOENT: open 'C:\\a\\b.json'\n    at Object.openSync (node:fs:603:3)\n    at C:\\internal\\handler.js:42:10");
    const result = sanitizeLoadError(err, 'load_failed');
    expect(result.detail).not.toContain('\n');
    expect(result.detail).not.toContain('handler.js');
    expect(result.detail).not.toContain('node:fs');
  });

  it('sanitizeErrorDetail strips paths from arbitrary strings', () => {
    const out = sanitizeErrorDetail("read-failed: ENOENT, open 'C:\\Users\\x\\foo.json'");
    expect(out).not.toContain('C:\\');
    expect(out).not.toContain('foo.json');
    expect(out).not.toContain('Users');
  });
});

// Integration: exercise the leak sites via the handler.
const logAudit = vi.fn();
const writeEntryAsync = vi.fn();
const ensureLoadedAsync = vi.fn();
const ensureLoaded = vi.fn();
const invalidate = vi.fn();
const touchIndexVersion = vi.fn();

const instructionsDir = path.join(process.cwd(), 'tmp', 'instr-add-load-err-tests');
fs.mkdirSync(instructionsDir, { recursive: true });

vi.mock('../../services/indexContext', () => ({
  ensureLoaded,
  ensureLoadedAsync,
  getInstructionsDir: () => instructionsDir,
  invalidate,
  isDuplicateInstructionWriteError: (e: unknown) => (e as { code?: string })?.code === 'DUPLICATE_WRITE',
  touchIndexVersion,
  writeEntry: vi.fn(),
  writeEntryAsync,
}));
vi.mock('../../services/features', () => ({ incrementCounter: vi.fn() }));
vi.mock('../../services/classificationService', () => ({
  ClassificationService: class {
    normalize<T>(value: T) { return value; }
    validate() { return []; }
  },
}));
vi.mock('../../services/ownershipService', () => ({ resolveOwner: () => undefined }));
vi.mock('../../services/auditLog', () => ({ logAudit }));
vi.mock('../../services/toolRegistry', () => ({ getToolRegistry: () => [{ name: 'index_add', inputSchema: {} }] }));
vi.mock('../../config/runtimeConfig', () => ({
  getRuntimeConfig: () => ({
    index: { bodyWarnLength: 20_000 },
    instructions: {
      requireCategory: false,
      canonicalDisable: false,
      agentId: 'test-agent',
      workspaceId: 'test-ws',
      manifest: { writeEnabled: false },
      strictVisibility: false,
      strictCreate: true,
    },
  }),
}));
vi.mock('../../services/canonical', () => ({ hashBody: (b: string) => 'hash-' + b.slice(0, 8) }));
vi.mock('../../services/manifestManager', () => ({ writeManifestFromIndex: vi.fn(), attemptManifestUpdate: vi.fn() }));
vi.mock('../../services/tracing', () => ({ emitTrace: vi.fn(), traceEnabled: () => false }));
vi.mock('../../services/handlers/instructions.shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/handlers/instructions.shared')>();
  return {
    ...actual,
    guard: (_name: string, fn: unknown) => fn,
    traceVisibility: () => false,
    traceInstructionVisibility: vi.fn(),
    traceEnvSnapshot: vi.fn(),
  };
});
vi.mock('../../services/instructionRecordValidation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/instructionRecordValidation')>();
  return {
    ...actual,
    validateInstructionRecord: () => ({ validationErrors: [], hints: [], record: {}, schemaRef: 'ref' }),
  };
});

function emptyState(extra: Record<string, unknown> = {}) {
  return {
    loadedAt: new Date().toISOString(),
    hash: 'hash-empty',
    byId: new Map(),
    list: [],
    fileCount: 0,
    versionMTime: 0,
    versionToken: 'token-empty',
    ...extra,
  };
}

function expectNoPathLeak(text: string) {
  expect(text).not.toMatch(/[A-Za-z]:\\/);
  expect(text).not.toMatch(/\/[^\s]*\/[^\s]*\.(json|js|ts)/);
  expect(text).not.toContain('ENOENT');
  expect(text).not.toContain('EACCES');
}

describe('index_add: hydration leak surface (overwrite + missing body)', () => {
  beforeEach(() => {
    vi.resetModules();
    logAudit.mockReset();
    ensureLoadedAsync.mockReset();
    ensureLoaded.mockReset();
    writeEntryAsync.mockReset();
    invalidate.mockReset();
    touchIndexVersion.mockReset();
    for (const name of fs.readdirSync(instructionsDir)) {
      fs.rmSync(path.join(instructionsDir, name), { force: true, recursive: true });
    }
  });

  it('does not echo absolute paths when fs.readFileSync throws ENOENT', async () => {
    const fileId = 'leak-hydration-test';
    const target = path.join(instructionsDir, `${fileId}.json`);
    // Create file so existsSync passes, then make readFileSync throw a path-laden error
    fs.writeFileSync(target, '{}');
    const realRead = fs.readFileSync;
    const spy = vi.spyOn(fs, 'readFileSync').mockImplementation(((p: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      if (typeof p === 'string' && p.endsWith(`${fileId}.json`)) {
        const err: NodeJS.ErrnoException = new Error(`ENOENT: no such file or directory, open '${target}'`);
        err.code = 'ENOENT';
        throw err;
      }
      return (realRead as unknown as (p: fs.PathOrFileDescriptor, ...r: unknown[]) => Buffer | string).apply(fs, [p, ...rest] as never);
    }) as unknown as typeof fs.readFileSync);

    ensureLoadedAsync.mockResolvedValue(emptyState());
    ensureLoaded.mockReturnValue(emptyState());

    await import('../../services/handlers/instructions.add.js');
    const { getLocalHandler } = await import('../../server/registry.js');
    const handler = getLocalHandler('index_add');

    const result = await handler?.({
      entry: {
        id: fileId,
        priority: 50,
        audience: 'all',
        requirement: 'optional',
        // body and title intentionally missing -> hydration branch
      },
      overwrite: true,
    }) as Record<string, unknown>;

    spy.mockRestore();

    expect(result?.error).toBe('existing_instruction_unreadable');
    const message = String(result?.message ?? '');
    expectNoPathLeak(message);
    expect(message.length).toBeGreaterThan(0);
  });
});

describe('index_add: duplicate-write loadErrors leak surface', () => {
  beforeEach(() => {
    vi.resetModules();
    logAudit.mockReset();
    ensureLoadedAsync.mockReset();
    ensureLoaded.mockReset();
    writeEntryAsync.mockReset();
  });

  it('sanitizes validationErrors echoed from state.loadErrors', async () => {
    const id = 'dup-leak-test';
    const file = path.join(instructionsDir, `${id}.json`);
    fs.writeFileSync(file, '{ broken json');

    // First call: loadExistingEntry path -> ensureLoadedAsync resolves with empty state
    // Then writeEntryAsync throws DUPLICATE_WRITE
    const dupErr: Error & { code?: string } = new Error('duplicate-write');
    dupErr.code = 'DUPLICATE_WRITE';
    writeEntryAsync.mockRejectedValue(dupErr);

    const stateWithLoadErrors = emptyState({
      loadErrors: [{
        file: `${id}.json`,
        error: `parse-failed: SyntaxError: Unexpected token in JSON at position 2 in '${file}'`,
      }],
    });
    ensureLoadedAsync.mockResolvedValue(stateWithLoadErrors);
    ensureLoaded.mockReturnValue(stateWithLoadErrors);

    await import('../../services/handlers/instructions.add.js');
    const { getLocalHandler } = await import('../../server/registry.js');
    const handler = getLocalHandler('index_add');

    const result = await handler?.({
      entry: {
        id,
        title: 'X',
        body: 'Y',
        priority: 50,
        audience: 'all',
        requirement: 'optional',
      },
      overwrite: false,
    }) as Record<string, unknown>;

    expect(result?.error).toBe('existing_instruction_invalid');
    const ve = result?.validationErrors as string[];
    expect(Array.isArray(ve)).toBe(true);
    for (const v of ve) {
      expectNoPathLeak(v);
    }
  });
});
