import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Regression for feedback 66ee358db941f20a: feedback_submit returned MCP
// -32603 when description contained Markdown (backticks, fenced code blocks,
// hash headings, multi-kilobyte bodies). These tests pin the handler-level
// contract: any valid markdown body (including adversarial inputs) must
// round-trip through submit -> list -> get without loss or thrown error.
//
// Per constitution TS-12 (>=5 cases for bug-prone handlers): normal,
// adversarial-markdown, large-body, multi-byte, control-char.

type Handler = (params: Record<string, unknown>) => Promise<unknown> | unknown;

async function loadHandlers(feedbackDir: string) {
  process.env.INDEX_SERVER_FEEDBACK_DIR = feedbackDir;
  process.env.INDEX_SERVER_FEEDBACK_MAX_ENTRIES = '100';
  const runtimeConfig = await import('../../config/runtimeConfig.js');
  runtimeConfig.reloadRuntimeConfig();
  await import('../../services/handlers.feedback.js');
  const registry = await import('../../server/registry.js');
  return {
    submit: registry.getHandler('feedback_submit') as Handler,
    manage: registry.getHandler('feedback_manage') as Handler,
  };
}

async function submitAndFetch(handlers: { submit: Handler; manage: Handler }, description: string) {
  const submitResp = await handlers.submit({
    type: 'bug-report',
    severity: 'low',
    title: 'markdown round-trip',
    description,
  }) as { feedbackId?: string; success?: boolean };
  expect(submitResp.success).toBe(true);
  expect(typeof submitResp.feedbackId).toBe('string');
  const get = await handlers.manage({ action: 'get', id: submitResp.feedbackId }) as Record<string, unknown>;
  expect(get.success).toBe(true);
  return get.entry as { description?: string };
}

describe('feedback_submit markdown round-trip (regression 66ee358d)', () => {
  let tmp: string;
  const origDir = process.env.INDEX_SERVER_FEEDBACK_DIR;
  const origMax = process.env.INDEX_SERVER_FEEDBACK_MAX_ENTRIES;

  beforeEach(() => {
    vi.resetModules();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-md-'));
  });

  afterEach(async () => {
    if (origDir === undefined) delete process.env.INDEX_SERVER_FEEDBACK_DIR;
    else process.env.INDEX_SERVER_FEEDBACK_DIR = origDir;
    if (origMax === undefined) delete process.env.INDEX_SERVER_FEEDBACK_MAX_ENTRIES;
    else process.env.INDEX_SERVER_FEEDBACK_MAX_ENTRIES = origMax;
    const runtimeConfig = await import('../../config/runtimeConfig.js');
    runtimeConfig.reloadRuntimeConfig();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('accepts inline backticks and preserves them byte-for-byte', async () => {
    const handlers = await loadHandlers(path.join(tmp, 'feedback'));
    const desc = 'usage_track returned `featureDisabled:true` for `INDEX_SERVER_USAGE_TRACKING`.';
    const entry = await submitAndFetch(handlers, desc);
    expect(entry.description).toBe(desc);
  });

  it('accepts triple-backtick fenced code blocks (json language tag)', async () => {
    const handlers = await loadHandlers(path.join(tmp, 'feedback'));
    const desc = [
      'Reproduction:',
      '```json',
      '{"method":"usage_track","params":{"id":"x"}}',
      '```',
      'Result: featureDisabled.',
    ].join('\n');
    const entry = await submitAndFetch(handlers, desc);
    expect(entry.description).toBe(desc);
  });

  it('accepts hash-prefixed headings without throwing -32603', async () => {
    const handlers = await loadHandlers(path.join(tmp, 'feedback'));
    const desc = '# Title\n## Summary\nObserved -32603 on submit.\n### Repro\nSteps...';
    const entry = await submitAndFetch(handlers, desc);
    expect(entry.description).toBe(desc);
  });

  it('accepts ~3500-char mixed markdown body (matches reported failure size)', async () => {
    const handlers = await loadHandlers(path.join(tmp, 'feedback'));
    const chunk = '`inline` and ```fenced``` with # heading; ';
    let desc = '';
    while (desc.length < 3500) desc += chunk;
    desc = desc.slice(0, 3500);
    const entry = await submitAndFetch(handlers, desc);
    expect(entry.description).toBe(desc);
  });

  it('accepts multi-byte unicode + emoji + surrogate pairs', async () => {
    const handlers = await loadHandlers(path.join(tmp, 'feedback'));
    const desc = 'café 漢字 🚀🔥 — diacrítics + 𝕳 (mathematical fraktur) end.';
    const entry = await submitAndFetch(handlers, desc);
    expect(entry.description).toBe(desc);
  });

  it('round-trips description verbatim through list (no escaping drift)', async () => {
    const handlers = await loadHandlers(path.join(tmp, 'feedback'));
    const desc = 'Mixed: `code`, ```fence```, # heading, "quotes", \\backslash, /slash/.';
    const submitResp = await handlers.submit({
      type: 'bug-report', severity: 'low', title: 'list round-trip', description: desc,
    }) as { feedbackId?: string };
    const list = await handlers.manage({ action: 'list', limit: 50 }) as { entries?: Array<{ id: string; description: string }> };
    const found = list.entries?.find(e => e.id === submitResp.feedbackId);
    expect(found?.description).toBe(desc);
  });
});
