import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { reloadRuntimeConfig } from '../../config/runtimeConfig';
import { getHandler } from '../../server/registry';
import { ensureLoaded, invalidate } from '../../services/indexContext';
import { forceBootstrapConfirmForTests } from '../../services/bootstrapGating';
import { enableFeature } from '../../services/features';

const TMP_ROOT = path.join(process.cwd(), 'tmp', 'issue-150-negative-tool-handlers');
const INSTRUCTIONS_DIR = path.join(TMP_ROOT, 'instructions');
const FEEDBACK_DIR = path.join(TMP_ROOT, 'feedback');
const USAGE_DIR = path.join(TMP_ROOT, 'usage');
const USAGE_SNAPSHOT_PATH = path.join(USAGE_DIR, 'usage-snapshot.json');
const FEEDBACK_FILE = path.join(FEEDBACK_DIR, 'feedback-entries.json');

function resetWorkspace(): void {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(INSTRUCTIONS_DIR, { recursive: true });
  fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
  fs.mkdirSync(USAGE_DIR, { recursive: true });
  invalidate();
}

function getRequiredHandler<T>(name: string): T {
  const handler = getHandler(name);
  if (!handler) throw new Error(`Handler ${name} not registered`);
  return handler as T;
}

describe('negative tool handler coverage', () => {
  beforeAll(async () => {
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_DIR = INSTRUCTIONS_DIR;
    process.env.INDEX_SERVER_FEEDBACK_DIR = FEEDBACK_DIR;
    process.env.INDEX_SERVER_USAGE_SNAPSHOT_PATH = USAGE_SNAPSHOT_PATH;
    process.env.INDEX_SERVER_FEATURES = 'usage';
    reloadRuntimeConfig();
    enableFeature('usage');
    forceBootstrapConfirmForTests('negative-tool-handlers');

    await import('../../services/handlers.instructions.js');
    await import('../../services/handlers.feedback.js');
    await import('../../services/handlers.usage.js');
  });

  beforeEach(() => {
    resetWorkspace();
  });

  afterAll(() => {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
    delete process.env.INDEX_SERVER_MUTATION;
    delete process.env.INDEX_SERVER_DIR;
    delete process.env.INDEX_SERVER_FEEDBACK_DIR;
    delete process.env.INDEX_SERVER_USAGE_SNAPSHOT_PATH;
    delete process.env.INDEX_SERVER_FEATURES;
    reloadRuntimeConfig();
  });

  it('usage_track rejects missing ids without creating a usage snapshot', async () => {
    const usageTrack = getRequiredHandler<(params: { id?: string }) => Promise<{ error: string }>>('usage_track');

    const result = await usageTrack({});

    expect(result).toEqual({ error: 'missing id' });
    expect(fs.existsSync(USAGE_SNAPSHOT_PATH)).toBe(false);
  });

  it('usage_track reports notFound for unknown instructions without writing usage state', async () => {
    const usageTrack = getRequiredHandler<(params: { id: string }) => Promise<{ notFound: boolean }>>('usage_track');

    const result = await usageTrack({ id: 'missing-usage-target' });

    expect(result).toEqual({ notFound: true });
    expect(fs.existsSync(USAGE_SNAPSHOT_PATH)).toBe(false);
  });

  it('feedback_submit rejects missing required fields before writing storage', async () => {
    const feedbackSubmit = getRequiredHandler<(params: {
      type: string;
      severity: string;
      title: string;
      description?: string;
    }) => Promise<unknown>>('feedback_submit');

    await expect(feedbackSubmit({
      type: 'issue',
      severity: 'low',
      title: 'Missing description'
    })).rejects.toThrow(/Missing required parameters/i);

    expect(fs.existsSync(FEEDBACK_FILE)).toBe(false);
  });

  it('feedback_submit rejects invalid severity before persisting feedback', async () => {
    const feedbackSubmit = getRequiredHandler<(params: {
      type: string;
      severity: string;
      title: string;
      description: string;
    }) => Promise<unknown>>('feedback_submit');

    await expect(feedbackSubmit({
      type: 'issue',
      severity: 'urgent',
      title: 'Invalid severity',
      description: 'Should fail validation'
    })).rejects.toThrow(/Invalid severity/i);

    expect(fs.existsSync(FEEDBACK_FILE)).toBe(false);
  });

  it('index_governanceUpdate returns notFound for missing instructions', async () => {
    const governanceUpdate = getRequiredHandler<(params: { id: string; owner?: string }) => Promise<{ id: string; notFound: boolean }>>('index_governanceUpdate');

    const result = await governanceUpdate({ id: 'missing-governance-target', owner: 'new-owner' });

    expect(result).toEqual({ id: 'missing-governance-target', notFound: true });
  });

  it('index_governanceUpdate rejects invalid status without mutating the stored instruction', async () => {
    const add = getRequiredHandler<(params: {
      entry: {
        id: string;
        title: string;
        body: string;
        owner: string;
        status: 'draft';
        version: string;
      };
      lax: boolean;
    }) => Promise<{ id: string }>>('index_add');
    const governanceUpdate = getRequiredHandler<(params: { id: string; status: string }) => Promise<{ id: string; error: string; provided: string }>>('index_governanceUpdate');
    const id = 'governance-invalid-status-target';

    await add({
      entry: {
        id,
        title: 'Governance seed',
        body: 'Seed body',
        owner: 'seed-owner',
        status: 'draft',
        version: '2.3.4'
      },
      lax: true
    });

    const result = await governanceUpdate({ id, status: 'nonsense' });

    expect(result).toEqual({ id, error: 'invalid status', provided: 'nonsense' });

    const onDisk = JSON.parse(fs.readFileSync(path.join(INSTRUCTIONS_DIR, `${id}.json`), 'utf8')) as {
      owner?: string;
      status?: string;
      version?: string;
    };
    expect(onDisk.owner).toBe('seed-owner');
    expect(onDisk.status).toBe('draft');
    expect(onDisk.version).toBe('2.3.4');

    invalidate();
    const reloaded = ensureLoaded().byId.get(id);
    expect(reloaded).toBeDefined();
    expect(reloaded?.owner).toBe('seed-owner');
    expect(reloaded?.status).toBe('draft');
    expect(reloaded?.version).toBe('2.3.4');
  });
});
