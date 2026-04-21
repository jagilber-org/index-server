/**
 * TDD RED/GREEN: index_groom signal feedback loop.
 * Validates that usage signals (outdated/not-relevant/helpful/applied) captured
 * via usage_track are applied back to instruction priority/requirement during groom.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getHandler } from '../../server/registry.js';
import { reloadRuntimeConfig } from '../../config/runtimeConfig.js';
import { forceBootstrapConfirmForTests } from '../../services/bootstrapGating.js';

const TMP_DIR = path.join(process.cwd(), 'tmp', 'groom-signal-feedback');
const SNAP_PATH = path.join(process.cwd(), 'tmp', 'groom-signal-feedback-snap.json');

function writeInstruction(id: string, extra: Record<string, unknown> = {}): void {
  const entry = {
    id,
    title: `Test: ${id}`,
    body: `Body for ${id}`,
    priority: 50,
    audience: 'all',
    requirement: 'optional',
    categories: ['uncategorized'],
    schemaVersion: '4',
    version: '1.0.0',
    contentType: 'instruction',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...extra,
  };
  fs.writeFileSync(path.join(TMP_DIR, `${id}.json`), JSON.stringify(entry, null, 2));
}

function readInstruction(id: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(TMP_DIR, `${id}.json`), 'utf8'));
}

describe('index_groom - signal feedback loop', () => {
  beforeAll(async () => {
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_DIR = TMP_DIR;
    process.env.INDEX_SERVER_USAGE_SNAPSHOT_PATH = SNAP_PATH;
    process.env.INDEX_SERVER_DISABLE_RATE_LIMIT = '1';
    reloadRuntimeConfig();

    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });

    await import('../../services/handlers.instructions.js');
    await import('../../services/handlers.usage.js');
    await import('../../services/instructions.dispatcher.js');
    forceBootstrapConfirmForTests('groom-signal-feedback-test');
  });

  beforeEach(async () => {
    // Reset directory and usage snapshot between tests
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    if (fs.existsSync(SNAP_PATH)) fs.unlinkSync(SNAP_PATH);

    const { __testResetUsageState, invalidate } = await import('../../services/indexContext.js');
    __testResetUsageState();
    invalidate();
  });

  afterAll(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    if (fs.existsSync(SNAP_PATH)) fs.unlinkSync(SNAP_PATH);
    delete process.env.INDEX_SERVER_USAGE_SNAPSHOT_PATH;
    delete process.env.INDEX_SERVER_DIR;
  });

  it('outdated signal sets requirement to deprecated', async () => {
    writeInstruction('sig-outdated', { priority: 50, requirement: 'optional' });

    const { invalidate, ensureLoaded } = await import('../../services/indexContext.js');
    invalidate();
    ensureLoaded();

    // Write snapshot directly to SNAP_PATH
    fs.writeFileSync(SNAP_PATH, JSON.stringify({ 'sig-outdated': { lastSignal: 'outdated' } }, null, 2));

    const dispatch = getHandler('index_dispatch')!;
    const result = await dispatch({ action: 'groom' }) as Record<string, unknown>;

    expect(result.signalApplied).toBe(1);

    const disk = readInstruction('sig-outdated');
    expect(disk.requirement).toBe('deprecated');
  });

  it('not-relevant signal lowers priority by 10 (floor 30)', async () => {
    writeInstruction('sig-not-relevant-50', { priority: 50 });
    writeInstruction('sig-not-relevant-35', { priority: 35 });

    const { invalidate, ensureLoaded } = await import('../../services/indexContext.js');
    invalidate();
    ensureLoaded();

    // Write snapshot directly
    fs.writeFileSync(SNAP_PATH, JSON.stringify({
      'sig-not-relevant-50': { lastSignal: 'not-relevant' },
      'sig-not-relevant-35': { lastSignal: 'not-relevant' },
    }, null, 2));

    const dispatch = getHandler('index_dispatch')!;
    const result = await dispatch({ action: 'groom' }) as Record<string, unknown>;

    expect(result.signalApplied).toBe(2);

    const disk50 = readInstruction('sig-not-relevant-50');
    expect(disk50.priority).toBe(40);

    // floor at 30: 35 - 10 = 25, floored to 30
    const disk35 = readInstruction('sig-not-relevant-35');
    expect(disk35.priority).toBe(30);
  });

  it('helpful signal raises priority by 5 (ceiling 100)', async () => {
    writeInstruction('sig-helpful-80', { priority: 80 });
    writeInstruction('sig-helpful-98', { priority: 98 });

    const { invalidate, ensureLoaded } = await import('../../services/indexContext.js');
    invalidate();
    ensureLoaded();

    // Write snapshot directly
    fs.writeFileSync(SNAP_PATH, JSON.stringify({
      'sig-helpful-80': { lastSignal: 'helpful' },
      'sig-helpful-98': { lastSignal: 'helpful' },
    }, null, 2));

    const dispatch = getHandler('index_dispatch')!;
    const result = await dispatch({ action: 'groom' }) as Record<string, unknown>;

    expect(result.signalApplied).toBe(2);

    const disk80 = readInstruction('sig-helpful-80');
    expect(disk80.priority).toBe(85);

    // ceiling at 100: 98 + 5 = 103, capped to 100
    const disk98 = readInstruction('sig-helpful-98');
    expect(disk98.priority).toBe(100);
  });

  it('applied signal raises priority by 2 (ceiling 100)', async () => {
    writeInstruction('sig-applied-80', { priority: 80 });
    writeInstruction('sig-applied-99', { priority: 99 });

    const { invalidate, ensureLoaded } = await import('../../services/indexContext.js');
    invalidate();
    ensureLoaded();

    // Write snapshot directly
    fs.writeFileSync(SNAP_PATH, JSON.stringify({
      'sig-applied-80': { lastSignal: 'applied' },
      'sig-applied-99': { lastSignal: 'applied' },
    }, null, 2));

    const dispatch = getHandler('index_dispatch')!;
    const result = await dispatch({ action: 'groom' }) as Record<string, unknown>;

    expect(result.signalApplied).toBe(2);

    const disk80 = readInstruction('sig-applied-80');
    expect(disk80.priority).toBe(82);

    // ceiling at 100: 99 + 2 = 101, capped to 100
    const disk99 = readInstruction('sig-applied-99');
    expect(disk99.priority).toBe(100);
  });

  it('no signal -> no change, signalApplied is 0', async () => {
    writeInstruction('sig-none', { priority: 55 });

    const { invalidate, ensureLoaded } = await import('../../services/indexContext.js');
    invalidate();
    ensureLoaded();

    const dispatch = getHandler('index_dispatch')!;
    const result = await dispatch({ action: 'groom' }) as Record<string, unknown>;

    expect(result.signalApplied).toBe(0);

    const disk = readInstruction('sig-none');
    expect(disk.priority).toBe(55);
  });

  it('dryRun counts signalApplied but does not write to disk', async () => {
    writeInstruction('sig-dryrun', { priority: 50, requirement: 'optional' });

    const { invalidate, ensureLoaded } = await import('../../services/indexContext.js');
    invalidate();
    ensureLoaded();

    // Write snapshot directly
    fs.writeFileSync(SNAP_PATH, JSON.stringify({ 'sig-dryrun': { lastSignal: 'outdated' } }, null, 2));

    const dispatch = getHandler('index_dispatch')!;
    const result = await dispatch({ action: 'groom', mode: { dryRun: true } }) as Record<string, unknown>;

    expect(result.dryRun).toBe(true);
    expect(result.signalApplied).toBe(1);

    // File must NOT be modified in dryRun
    const disk = readInstruction('sig-dryrun');
    expect(disk.requirement).toBe('optional');
  });
});
