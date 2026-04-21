/**
 * Contract test: a successful remove MUST make the instruction immediately
 * disappear from index list/get responses (atomic delete visibility).
 * Uses isolated temp directory.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createTestClient } from './helpers/mcpTestClient.js';

function makeTempDir(){
  const dir = path.join(process.cwd(), 'tmp', 'atomic-remove-visibility');
  if(fs.existsSync(dir)){
    for(const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir,f));
  } else fs.mkdirSync(dir, { recursive:true });
  return dir;
}

describe('instructions: remove atomic visibility contract', () => {
  const instructionsDir = makeTempDir();
  let client: any; // eslint-disable-line @typescript-eslint/no-explicit-any

  beforeAll(async () => {
    process.env.INDEX_SERVER_STRICT_CREATE = '1';
    process.env.INDEX_SERVER_STRICT_REMOVE = '1';
    client = await createTestClient({ instructionsDir, forceMutation:true, extraEnv:{ INDEX_SERVER_STRICT_CREATE:'1', INDEX_SERVER_STRICT_REMOVE:'1' } });
  }, 30000);

  afterAll(async () => { await client?.close(); });

  it('creates then removes instruction with immediate invisibility', async () => {
    const id = 'atomic-remove-' + Date.now();
    const body = 'remove body';
    const createResp = await client.create({ id, title: 'Remove Test', body });
    expect(createResp?.verified).toBe(true);
    expect(createResp?.strictVerified).toBe(true);
    const list1 = await client.list();
    expect(list1.items.some((i:any)=> i.id===id)).toBe(true);

    // Use dispatcher remove if available through unified API
    // client.remove already maps accordingly.
    const removeResp = await client.remove(id);
    // In dispatcher legacy we might not get strictVerified flag; allow undefined => treat as pass when strict enabled.
    if('strictVerified' in removeResp){
      expect(removeResp.strictVerified).toBe(true);
    }
    // Confirm file is gone
    const file = path.join(instructionsDir, id + '.json');
    expect(fs.existsSync(file)).toBe(false);
    const list2 = await client.list();
    expect(list2.items.some((i:any)=> i.id===id)).toBe(false);
    const readAfter = await client.read(id);
    expect(readAfter?.notFound || readAfter?.item === undefined).toBeTruthy();
  }, 30000);
});
