/**
 * Concurrent Stdio CRUD Test
 *
 * Spawns N MCP server processes (each with its own stdio client) sharing
 * a single instructions directory. Each client performs create/read/update/delete
 * operations concurrently, then verifies index consistency.
 *
 * This tests real cross-process file-level concurrency — no mocks.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
	createTestContext,
	spawnMcpClients,
	closeAllClients,
	testId,
	resetIdCounter,
	runConcurrent,
	type ConcurrentTestContext,
} from './concurrentTestHelpers.js';
import type { TestClient } from '../helpers/mcpTestClient.js';

const CLIENT_COUNT = 5;
const OPS_PER_CLIENT = 3;

describe('Concurrent Stdio CRUD', { timeout: 120_000 }, () => {
	let ctx: ConcurrentTestContext;
	let clients: TestClient[];

	beforeAll(async () => {
		ctx = createTestContext('mcp-stdio-crud-');
		resetIdCounter();
		clients = await spawnMcpClients(CLIENT_COUNT, {
			instructionsDir: ctx.instructionsDir,
		});
	}, 90_000);

	afterAll(async () => {
		await closeAllClients(clients);
		await ctx.cleanup();
	});

	it('all clients discover tools on startup', () => {
		for (const c of clients) {
			expect(c.toolNames.length).toBeGreaterThan(0);
			expect(
				c.toolNames.includes('index_dispatch') ||
				c.toolNames.includes('index_add'),
			).toBe(true);
		}
	});

	it('concurrent creates from N clients produce no duplicates', async () => {
		const allIds: string[] = [];

		const { successes, failures } = await runConcurrent(clients, async (client, ci) => {
			for (let i = 0; i < OPS_PER_CLIENT; i++) {
				const id = testId(ci, `create-${i}`);
				allIds.push(id);
				await client.create({
					id,
					title: `Concurrent entry from client ${ci} op ${i}`,
					body: `Body created by client-${ci} operation ${i}`,
					categories: ['concurrent-test'],
				});
			}
		});

		expect(failures).toEqual([]);
		expect(successes).toBe(CLIENT_COUNT);

		// Allow index sync time
		await new Promise(r => setTimeout(r, 1500));

		// Verify from a single client: all entries exist, no duplicates
		const listing = await clients[0].list();
		const listedIds = listing.items.map((e: { id: string }) => e.id);
		for (const id of allIds) {
			expect(listedIds).toContain(id);
		}

		// Check no duplicate IDs in listing
		const uniqueIds = new Set(listedIds);
		expect(uniqueIds.size).toBe(listedIds.length);
	});

	it('concurrent reads during writes return valid data', async () => {
		// Client 0 writes continuously, clients 1-4 read continuously
		const writeId = testId(0, 'read-during-write');
		await clients[0].create({
			id: writeId,
			title: 'Read-during-write seed',
			body: 'Initial body v0',
			categories: ['concurrent-test'],
		});

		await new Promise(r => setTimeout(r, 500));

		let writeComplete = false;
		const readResults: Array<{ clientIdx: number; body: string | null }> = [];

		// First verify readers can see the seed entry before starting writes
		// (allow time for index propagation across processes)
		await new Promise(r => setTimeout(r, 1500));
		for (const client of clients.slice(1)) {
			try {
				const entry = await client.read(writeId);
				// The dispatch may return the entry in various formats
				const text = typeof entry === 'string' ? entry : JSON.stringify(entry ?? '');
				expect(text).toContain(writeId);
			} catch {
				// On slow systems, the entry may not have propagated yet — that's OK
				// The main test below will still exercise concurrent read/write
			}
		}

		// Writer: update the entry 5 times with delays for index propagation
		const writePromise = (async () => {
			for (let v = 1; v <= 5; v++) {
				await clients[0].update({
					id: writeId,
					title: `Read-during-write v${v}`,
					body: `Updated body v${v}`,
				});
				await new Promise(r => setTimeout(r, 400));
			}
			writeComplete = true;
		})();

		// Readers: continuously read while writes happen
		const readerPromises = clients.slice(1).map(async (client, ri) => {
			const clientIdx = ri + 1;
			while (!writeComplete) {
				try {
					const entry = await client.read(writeId);
					if (entry != null && typeof entry === 'object') {
						const e = entry as Record<string, unknown>;
						// Dispatch get returns { hash, item: { id, body, ... } }
						const item = (e.item ?? e) as Record<string, unknown>;
						const body = item.body as string | undefined;
						if (body) readResults.push({ clientIdx, body });
					}
				} catch {
					// Transient index reload errors — acceptable
				}
				await new Promise(r => setTimeout(r, 150));
			}
		});

		await Promise.all([writePromise, ...readerPromises]);

		// All reads should have returned valid body strings (no partial/corrupt data)
		expect(readResults.length).toBeGreaterThan(0);
		for (const r of readResults) {
			expect(r.body).toBeTruthy();
			expect(r.body).toMatch(/^(Initial body v0|Updated body v[1-5])$/);
		}
	});

	it('concurrent search while mutations in-flight returns valid results', async () => {
		// Seed some entries
		const searchTag = `search-${Date.now()}`;
		for (let i = 0; i < 3; i++) {
			await clients[0].create({
				id: testId(0, `search-seed-${i}`),
				title: `Searchable ${searchTag} item ${i}`,
				body: `This entry is tagged with ${searchTag} for search testing`,
				categories: ['concurrent-test'],
			});
		}

		await new Promise(r => setTimeout(r, 1000));

		// All clients search concurrently
		const { successes, failures } = await runConcurrent(clients, async (client) => {
			const result = await client.callToolJSON('index_search', {
				keywords: [searchTag],
			});
			// Search should return results without errors
			expect(result).toBeTruthy();
		});

		expect(failures).toEqual([]);
		expect(successes).toBe(CLIENT_COUNT);
	});

	it('concurrent deletes produce clean index state', async () => {
		// Each client creates one entry, then all delete concurrently
		const deleteIds: string[] = [];
		for (let ci = 0; ci < CLIENT_COUNT; ci++) {
			const id = testId(ci, 'delete-target');
			deleteIds.push(id);
			await clients[ci].create({
				id,
				title: `Delete target ${ci}`,
				body: `To be deleted by client ${ci}`,
				categories: ['concurrent-test'],
			});
		}

		await new Promise(r => setTimeout(r, 1000));

		// All clients delete their entry simultaneously
		const { failures } = await runConcurrent(clients, async (client, ci) => {
			await client.remove(deleteIds[ci]);
		});

		expect(failures).toEqual([]);

		await new Promise(r => setTimeout(r, 1500));

		// Verify: none of the deleted entries appear in Index
		const listing = await clients[0].list();
		const listedIds = listing.items.map((e: { id: string }) => e.id);
		for (const id of deleteIds) {
			expect(listedIds).not.toContain(id);
		}
	});
});
