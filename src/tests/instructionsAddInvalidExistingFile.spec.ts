import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { waitFor, getResponse, parseToolPayload } from './testUtils';
import { waitForDist } from './distReady';

function startServer(dir: string) {
  return spawn('node', [path.join(__dirname, '../../dist/server/index-server.js')], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, INDEX_SERVER_MUTATION: '1', INDEX_SERVER_DIR: dir },
  });
}

function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>) {
  proc.stdin?.write(JSON.stringify(msg) + '\n');
}

function findLine(lines: string[], id: number): string | undefined {
  return lines.find((line) => {
    try { return JSON.parse(line).id === id; } catch { return false; }
  });
}

describe('invalid existing instruction collision reporting', () => {
  it('surfaces the existing validation error instead of skipped_file_not_in_index', async () => {
    await waitForDist();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'invalid-existing-instruction-'));
    const id = `invalid-existing-${Date.now()}`;
    const file = path.join(dir, `${id}.json`);
    const now = new Date().toISOString();

    fs.writeFileSync(file, JSON.stringify({
      id,
      title: 'Invalid on disk',
      body: 'body',
      priority: 50,
      audience: 'all',
      requirement: 'optional',
      categories: ['test'],
      contentType: 'instruction',
      sourceHash: 'a'.repeat(64),
      schemaVersion: '4',
      createdAt: now,
      updatedAt: now,
      version: '1.0.0',
      status: 'approved',
      owner: 'owner',
      priorityTier: 'P2',
      classification: 'secret',
      lastReviewedAt: now,
      nextReviewDue: now,
      changeLog: [{ version: '1.0.0', changedAt: now, summary: 'initial import' }],
      semanticSummary: 'summary',
    }, null, 2), 'utf8');

    const proc = startServer(dir);
    const out: string[] = [];
    proc.stdout.on('data', (d) => out.push(...d.toString().trim().split(/\n+/)));
    proc.stderr?.on('data', () => { /* drain to prevent stderr pipe backpressure stalling server */ });
    await new Promise((resolve) => setTimeout(resolve, 120));
    send(proc, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'invalid-existing-test', version: '0' }, capabilities: { tools: {} } } });
    await waitFor(() => !!findLine(out, 1));

    send(proc, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'index_dispatch',
        arguments: {
          action: 'add',
          entry: {
            id,
            title: 'Attempt overwrite collision',
            body: 'new body',
            priority: 50,
            audience: 'all',
            requirement: 'optional',
            categories: ['test'],
          },
          overwrite: false,
          lax: true,
        },
      },
    });

    const env = await getResponse(out, 2, 8000);
    const payload = parseToolPayload<{ error?: string; visibilityWarning?: string; validationErrors?: string[] }>(JSON.stringify(env));
    expect(payload?.error).toBe('existing_instruction_invalid');
    expect(payload?.visibilityWarning).toBeUndefined();
    expect(payload?.validationErrors?.some((issue) => issue.includes('classification'))).toBe(true);
    expect(fs.existsSync(file)).toBe(true);
    proc.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }, 15000);
});
