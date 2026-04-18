import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { performHandshake } from './util/handshakeHelper.js';
import { buildContentLengthFrame } from './util/stdioFraming.js';

// Regression coverage for list/get transient omission fixed by self-healing logic in instructionActions.list.
// Strategy:
//  1. Start server (mutation enabled)
//  2. Create an instruction JSON file directly on disk AFTER initial index load to force a potential visibility gap
//     (by writing file without using the add action the index may not yet have reloaded)
//  3. Immediately call list with expectId; expect the server to detect on-disk file and late-materialize it, returning
//     repairedVisibility=true & lateMaterialized=true and the item present in items[]
//  4. Call get to verify lateMaterialization path updates index hash consistently (lateMaterialized may be present)

describe('instructions disappearing regression self-healing', () => {
	it('list with expectId repairs visibility for newly created on-disk file', async () => {
		const id = 'disappear-regression-' + Date.now();
		const body = 'Body for disappearing-regression test';
		// Use isolated temp instructions directory for deterministic cross-process external add simulation.
		const instructionsDir = path.join(process.cwd(), 'tmp', 'disappear-reg-' + Date.now());
		fs.mkdirSync(instructionsDir, { recursive: true });
		// Spawn server pointing at empty isolated dir so first list loads empty Index.
		const { server, parser } = await performHandshake({ protocolVersion: '2025-06-18', extraEnv: { INDEX_SERVER_DIR: instructionsDir } });
		const send = (m: Record<string, unknown>) => server.stdin.write(buildContentLengthFrame(m));
		const wait = (reqId: number, ms = 15000) => parser.waitForId(reqId, ms, 40);

		// Initial list to force index snapshot (without our file)
		send({ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'list' }}});
		await wait(2);

		// Write file directly to disk (simulate external creation)
		const filePath = path.join(instructionsDir, `${id}.json`);
		const entry = { id, title: id, body, priority: 50, audience: 'all', requirement: 'optional', categories: [] };
		fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf8');

		// Immediate list with expectId should trigger repair if race existed.
		let attempt = 0; let listObj: any; let found=false;
		for(; attempt<3 && !found; attempt++){
			const reqId = 3+attempt;
			send({ jsonrpc:'2.0', id:reqId, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'list', expectId: id }}});
			const list = await wait(reqId);
			const listTxt = (list as any).result?.content?.[0]?.text;
			if(!listTxt){ continue; }
			listObj = JSON.parse(listTxt);
			found = !!listObj.items?.find((e: any)=> e.id === id);
			if(!found){ await new Promise(r=>setTimeout(r, 60)); }
		}
		expect(found).toBe(true);
		if(listObj){
			// Legacy repairedVisibility/lateMaterialized flags removed (Phase E). Presence validated purely by items[] now.
			const existsOnDisk = fs.existsSync(path.join(instructionsDir, `${id}.json`));
			if(!existsOnDisk) throw new Error('File unexpectedly missing after write');
		}

		// Follow-up get should succeed.
		send({ jsonrpc:'2.0', id:4, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'get', id }}});
		const get = await wait(4);
		const getTxt = (get as any).result?.content?.[0]?.text;
		expect(getTxt).toBeTruthy();
		const getObj = JSON.parse(getTxt!);
		expect(getObj.notFound).not.toBe(true);

		server.kill();
	}, 40000);
});
