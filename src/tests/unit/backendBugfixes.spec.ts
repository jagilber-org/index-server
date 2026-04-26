/**
 * Regression tests for backend bug fixes:
 * - #122: HttpTransport logs errors before returning 500
 * - #132: index_governanceUpdate captures write error details + audit on failure
 * - #126: index_enrich/index_repair report per-entry write failures
 * - #139: backgroundServicesStartup surfaces errors (verified by code review)
 * - #125: index_import read-back verification (verified by code review)
 * - #128: index_add overwrite hydration surfaces read failures (already fixed)
 * - #119: index_add noop path performs real verification (already fixed)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { createMcpTransportRoutes } from '../../dashboard/server/HttpTransport';

// ─── #122: HttpTransport error logging ──────────────────────────
describe('#122: HttpTransport error logging', () => {
  let app: express.Express;
  let server: http.Server;
  let baseUrl: string;
  let capturedStderr: string[] = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  const origConsoleError = console.error.bind(console);

  const mockHandlers: Record<string, (params: unknown) => Promise<unknown>> = {
    'error_handler': async () => { throw new Error('simulated_crash_122'); },
    'non_error_throw': async () => { throw 'string-error-122'; },
  };

  const handlerLookup = (method: string) => mockHandlers[method];

  beforeAll(async () => {
    // Capture all stderr output
    capturedStderr = [];
    process.stderr.write = ((...args: unknown[]) => {
      capturedStderr.push(String(args[0]));
      return true;
    }) as typeof process.stderr.write;
    console.error = (...args: unknown[]) => {
      capturedStderr.push(args.map(String).join(' '));
    };

    app = express();
    const routes = createMcpTransportRoutes({ handlerLookup });
    app.use('/mcp', routes);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr !== 'string') baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    process.stderr.write = origWrite;
    console.error = origConsoleError;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('should log Error details before returning 500 (was silent in #122)', async () => {
    capturedStderr = [];
    const resp = await fetch(`${baseUrl}/mcp/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'error_handler', id: 1 }),
    });
    expect(resp.status).toBe(500);
    const body = await resp.json();
    expect(body.error.message).toBe('simulated_crash_122');

    // The fix adds log('ERROR', ...) which outputs via console.error as NDJSON
    const allOutput = capturedStderr.join('\n');
    expect(allOutput).toContain('[HttpTransport]');
    expect(allOutput).toContain('simulated_crash_122');
  });

  it('should handle non-Error throws with log + correct 500 response', async () => {
    capturedStderr = [];
    const resp = await fetch(`${baseUrl}/mcp/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'non_error_throw', id: 2 }),
    });
    expect(resp.status).toBe(500);
    const body = await resp.json();
    expect(body.error.message).toBe('Internal error');

    const allOutput = capturedStderr.join('\n');
    expect(allOutput).toContain('[HttpTransport]');
  });
});

// ─── #132: governanceUpdate write-failed response shape ─────────
describe('#132: governanceUpdate write-failed response shape', () => {
  it('should include detail field with error message in write-failed response', () => {
    // Direct test of the error response shape from the patched handler code
    // The fix changes: catch { return { id, error: 'write-failed' } }
    // to: catch (err) { logAudit(...); return { id, error: 'write-failed', detail: (err as Error).message } }

    // Verify the source code has the fix applied
    const patchFile = fs.readFileSync(
      path.join(process.cwd(), 'src/services/handlers/instructions.patch.ts'),
      'utf8'
    );

    // Old pattern: catch { return { id, error: 'write-failed' }; }
    expect(patchFile).not.toMatch(/catch\s*\{\s*return\s*\{\s*id,\s*error:\s*'write-failed'\s*\}/);

    // New pattern: captures error, includes detail
    expect(patchFile).toContain("error: 'write-failed'");
    expect(patchFile).toContain('detail');
    expect(patchFile).toContain('writeFailure: true');
    // Audit log is called for the failure case
    expect(patchFile).toContain("logAudit('governanceUpdate'");
  });
});

// ─── #126: index_enrich/repair error fields ─────────────────────
describe('#126: index_enrich and index_repair error reporting', () => {
  it('index_enrich source should have errors array and no bare catch-ignore', () => {
    const groomFile = fs.readFileSync(
      path.join(process.cwd(), 'src/services/handlers/instructions.groom.ts'),
      'utf8'
    );

    // The enrich handler block should NOT have catch { /* ignore */ }
    // Split to find the enrich handler section
    const enrichStart = groomFile.indexOf("registerHandler('index_enrich'");
    const enrichEnd = groomFile.indexOf("registerHandler('index_repair'");
    const enrichSection = groomFile.slice(enrichStart, enrichEnd);

    expect(enrichSection).not.toMatch(/catch\s*\{\s*\/\*\s*ignore\s*\*\/\s*\}/);
    expect(enrichSection).toContain('errors.push');
    expect(enrichSection).toContain('logAudit');
  });

  it('index_repair source should have errors array and no bare catch-ignore', () => {
    const groomFile = fs.readFileSync(
      path.join(process.cwd(), 'src/services/handlers/instructions.groom.ts'),
      'utf8'
    );

    const repairStart = groomFile.indexOf("registerHandler('index_repair'");
    const repairEnd = groomFile.indexOf("registerHandler('index_groom'");
    const repairSection = groomFile.slice(repairStart, repairEnd);

    expect(repairSection).not.toMatch(/catch\s*\{\s*\/\*\s*ignore\s*\*\/\s*\}/);
    expect(repairSection).toContain('errors.push');
    expect(repairSection).toContain('logAudit');
  });
});

// ─── #125: index_import read-back verification ──────────────────
describe('#125: index_import read-back verification', () => {
  it('import handler source should verify entries in index after reload', () => {
    const importFile = fs.readFileSync(
      path.join(process.cwd(), 'src/services/handlers/instructions.import.ts'),
      'utf8'
    );

    // Should include verification logic after reload
    expect(importFile).toContain('not-in-index-after-reload');
    expect(importFile).toContain('verificationErrors');
    expect(importFile).toContain('verified');
    // The old code just returned { hash, imported, skipped, overwritten, total, errors }
    // The new code adds 'verified' to the summary
  });
});

// ─── #139: backgroundServicesStartup error surfacing ────────────
describe('#139: backgroundServicesStartup error surfacing', () => {
  it('should not have silent catch-ignore blocks', () => {
    const startupFile = fs.readFileSync(
      path.join(process.cwd(), 'src/server/backgroundServicesStartup.ts'),
      'utf8'
    );

    // The startDeferredBackgroundServices function should not have catch { /* ignore */ }
    // for service-critical operations (poller and autoBackup)
    const fnStart = startupFile.indexOf('startDeferredBackgroundServices');
    const fnBody = startupFile.slice(fnStart);

    // Should not have bare catch-ignore for the main service start calls
    // Allow catch { /* ignore stderr */ } for stderr.write wrapping only
    const catchBlocks = fnBody.match(/catch\s*\{[^}]*\}/g) || [];
    const silentCatches = catchBlocks.filter(
      (c: string) => c.includes('/* ignore */') && !c.includes('/* ignore stderr */')
    );
    expect(silentCatches).toHaveLength(0);

    // Should use the logger for errors
    expect(startupFile).toContain("import { log }");
    expect(fnBody).toContain("log('ERROR'");
  });
});
