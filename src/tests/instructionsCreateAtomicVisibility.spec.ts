/**
 * Regression / contract test: A successful create MUST mean the instruction
 * JSON file was written to disk AND its parsed contents were incorporated
 * into the index (read-after-write). No exceptions.
 *
 * Invariants enforced here:
 * 1. create response -> { created:true || overwritten:true } implies:
 *    a. File <id>.json exists on disk.
 *    b. File parses to JSON with matching id, non-empty body & title.
 *    c. Immediate read(id) returns same body & title (verified=true on response).
 * 2. Overwrite path updates on-disk body and is reflected in immediate read.
 * 3. List count increments exactly by number of new IDs created in a fresh dir.
 *
 * These tests use an isolated temporary instructions directory so they are
 * insensitive to repository baseline contents.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTestClient } from './helpers/mcpTestClient.js';

function makeTempDir(){
  const dir = path.join(process.cwd(), 'tmp', 'atomic-create-visibility');
  if(fs.existsSync(dir)){
    for(const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir,f));
  } else fs.mkdirSync(dir, { recursive:true });
  return dir;
}

describe('instructions: create atomic visibility contract', () => {
  const instructionsDir = makeTempDir();
  let client: any; // eslint-disable-line @typescript-eslint/no-explicit-any

  beforeAll(async () => {
  // Enable strict server-side create verification for this contract test.
  process.env.INDEX_SERVER_STRICT_CREATE = '1';
  client = await createTestClient({ instructionsDir, forceMutation:true, extraEnv:{ INDEX_SERVER_STRICT_CREATE:'1' } });
  }, 30000);

  afterAll(async () => { await client?.close(); });

  function readDisk(id:string){
    const file = path.join(instructionsDir, id + '.json');
    if(!fs.existsSync(file)) return { exists:false };
    try { const raw = JSON.parse(fs.readFileSync(file,'utf8')); return { exists:true, raw }; } catch(e){ return { exists:true, parseError:(e as Error).message }; }
  }

  it('creates new instruction: on-disk + index consistency', async () => {
    const id = 'atomic-create-' + Date.now();
    const body = 'Body created at ' + new Date().toISOString();
    const title = 'Atomic Create Test';
    const before = await client.list();
    expect(before.count).toBe(0);

    const resp = await client.create({ id, title, body });
    expect(resp?.id).toBe(id);
    expect(resp?.created).toBe(true);
    expect(resp?.verified).toBe(true); // server asserts atomic visibility
  expect(resp?.strictVerified).toBe(true); // strict mode on

    // Disk verification
    const disk = readDisk(id);
    expect(disk.exists).toBe(true);
    expect(disk.parseError).toBeUndefined();
    expect(disk.raw.id).toBe(id);
    expect(typeof disk.raw.body).toBe('string');
    expect(disk.raw.body.length).toBeGreaterThan(0);
    expect(typeof disk.raw.title).toBe('string');
    expect(disk.raw.title.length).toBeGreaterThan(0);

    // index read-after-write
    const read = await client.read(id);
    const readBody = read?.item?.body || read?.body;
    const readTitle = read?.item?.title || read?.title;
    expect(readBody).toBe(disk.raw.body);
    expect(readTitle).toBe(disk.raw.title);

    const after = await client.list();
    expect(after.count).toBe(1);
    expect(after.items.some((i:any)=> i.id === id)).toBe(true);
  }, 30000);

  it('overwrites existing instruction and reflects new body immediately', async () => {
    const id = 'atomic-overwrite-' + Date.now();
    const body1 = 'Initial body';
    await client.create({ id, title: 'Overwrite Test', body: body1 });
    const disk1 = readDisk(id); expect(disk1.exists).toBe(true); expect(disk1.raw.body).toBe(body1);

    const body2 = 'Updated body @ ' + Date.now();
    const resp2 = await client.create({ id, title: 'Overwrite Test Updated', body: body2 });
    expect(resp2?.overwritten).toBe(true);
    expect(resp2?.verified).toBe(true);
  expect(resp2?.strictVerified).toBe(true);
    const disk2 = readDisk(id); expect(disk2.raw.body).toBe(body2);
    const read2 = await client.read(id); const read2Body = read2?.item?.body || read2?.body; expect(read2Body).toBe(body2);
  }, 30000);
});
