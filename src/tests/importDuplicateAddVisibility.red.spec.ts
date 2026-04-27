import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
describe('import -> duplicate add -> immediate get visibility (mcp-server-testing-patterns-2025)', () => {
  it('import then duplicate add must retain immediate get visibility', async () => {
    process.env.INDEX_SERVER_MUTATION = '1';
    const id = 'mcp-server-testing-patterns-2025';
    const providedDir = process.env.TEST_INDEX_SERVER_DIR;
    const instructionsDir = providedDir || path.join(process.cwd(), 'tmp', `index-server-test-import-dup-${Date.now()}`);
    if (!providedDir) fs.mkdirSync(instructionsDir, { recursive: true });
    process.env.INDEX_SERVER_DIR = instructionsDir;

    const { createTestClient } = await import('./helpers/mcpTestClient.js');
    const client = await createTestClient({ forceMutation:true, instructionsDir });

    // Step 1: import (bulk path) — we deliberately include full governance fields as supplied by user
    const importEntry = {
      id,
      title: 'MCP Server Testing Patterns 2025 - Structured Validation Playbook',
      body: '# MCP Server Testing Patterns 2025 - Structured Validation Playbook\n\nInitial import body.',
      requirement: 'recommended',
      priority: 58,
      categories: ['testing','patterns','governance','validation','performance'],
      owner: 'quality-engineering',
      priorityTier: 'P2',
      reviewIntervalDays: 60,
      status: 'approved',
      classification: 'internal',
      audience: 'all'
    };

    const importResp = await client.importBulk([importEntry], { mode:'overwrite' });
    // Basic sanity: imported count 1 or overwritten count 1 acceptable depending on prior state.
    const acceptableImport = importResp && (importResp.imported === 1 || importResp.overwritten === 1);

    // Step 2: duplicate add without overwrite
    const addResp = await client.create({ id, body: '# DUPLICATE ADD BODY\nShould not break visibility.' }, { overwrite:false });
    const created = !!addResp?.created;
    const skipped = (addResp as any)?.skipped === true || (!created && !addResp?.overwritten);

    // Step 3: immediate get
    const readResp = await client.read(id);
    const notFound = !!readResp?.notFound;

    if (notFound) {
      // Deep diagnostics: list snapshot, file existence, overwrite repair probe
      const list = await client.list();
      const inList = (list.items||[]).some((i:any)=> i.id===id);
      const fs = await import('fs');
      const path = await import('path');
      const filePath = path.join(instructionsDir, id + '.json');
      const fileExists = fs.existsSync(filePath);
      let snippet: string | undefined;
      if(fileExists){ try { snippet = fs.readFileSync(filePath,'utf8').slice(0,220); } catch { /* ignore */ } }
      const overwriteResp = await client.create({ id, body: '# OVERWRITE REPAIR BODY' }, { overwrite:true });
      const postOverwriteRead = await client.read(id);
      console.error('[import-duplicate-add-visibility][anomaly]', JSON.stringify({
        importResp,
        acceptableImport,
        addResp,
        created,
        skipped,
        notFoundAfterDuplicate:true,
        listCount: list.items?.length,
        inList,
        fileExists,
        snippet,
        overwriteResp,
        postOverwriteRead
      }, null, 2));
    }

    try {
      expect(acceptableImport, 'Import (or overwrite) must succeed for test precondition').toBe(true);
      expect(notFound, 'Duplicate add after import produced immediate get notFound (anomaly) – see diagnostics').toBe(false);
    } finally {
      await client.close();
      if (!providedDir) {
        try { fs.rmSync(instructionsDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
  }, 25000);
});
