/**
 * Tests for the SDK-based MCP test client helper.
 * Validates spawnServer() and createTestClient() work correctly
 * against the actual Index.
 */
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { spawnServer, createTestClient, type TestClient } from './mcpTestClient.js';

const tmpDir = path.join(process.cwd(), 'tmp', 'mcp-test-client-tests');

function ensureCleanDir(dir: string) {
	if (fs.existsSync(dir)) {
		for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
	} else {
		fs.mkdirSync(dir, { recursive: true });
	}
}

describe('mcpTestClient helper', () => {
	describe('spawnServer', () => {
		it('connects to server and discovers tools', async () => {
			const conn = await spawnServer();
			try {
				expect(conn.toolNames.length).toBeGreaterThan(0);
				expect(conn.toolNames).toContain('index_dispatch');
			} finally {
				await conn.close();
			}
		}, 30000);
	});

	describe('createTestClient', () => {
		const dir = path.join(tmpDir, 'crud-test');
		let client: TestClient;

		afterAll(async () => {
			await client?.close();
		});

		it('performs full CRUD lifecycle', async () => {
			ensureCleanDir(dir);
			client = await createTestClient({ instructionsDir: dir });

			expect(client.hasDispatcher).toBe(true);

			// Create
			const id = 'test-helper-' + Date.now();
			const body = 'Test body created at ' + new Date().toISOString();
			const resp = await client.create({ id, body, title: 'Test Helper' });
			expect(resp?.id).toBe(id);
			expect(resp?.created || resp?.overwritten).toBeTruthy();

			// List
			const listing = await client.list();
			expect(listing.count).toBeGreaterThan(0);
			expect(listing.items.some((i: { id: string }) => i.id === id)).toBe(true);

			// Read
			const readResp = await client.read(id);
			const readBody = readResp?.item?.body || readResp?.body;
			expect(readBody).toBe(body);

			// Update
			const newBody = 'Updated body at ' + Date.now();
			const updateResp = await client.update({ id, body: newBody, title: 'Test Helper Updated' });
			expect(updateResp?.overwritten).toBe(true);

			// Read after update
			const readAfter = await client.read(id);
			const afterBody = readAfter?.item?.body || readAfter?.body;
			expect(afterBody).toBe(newBody);

			// Remove
			await client.remove(id);

			// Verify removal
			const listAfter = await client.list();
			expect(listAfter.items.some((i: { id: string }) => i.id === id)).toBe(false);
		}, 60000);
	});
});
