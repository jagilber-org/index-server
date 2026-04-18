/**
 * Message Ordering & Consistency Test
 *
 * Tests eventual consistency and race condition handling when multiple
 * MCP clients perform concurrent operations on the same index entries.
 *
 * Verifies:
 * - Read-after-write visibility (eventual consistency within bounded window)
 * - Concurrent update race (last-write-wins, no corruption)
 * - Delete + read race (clean not-found or valid entry)
 *
 * All tests use real server processes — no mocks.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
	createTestContext,
	spawnMcpClients,
	closeAllClients,
	testId,
	resetIdCounter,
	waitFor,
	type ConcurrentTestContext,
} from './concurrentTestHelpers.js';
import type { TestClient } from '../helpers/mcpTestClient.js';

const CLIENT_COUNT = 5;

describe('Message Ordering & Consistency', { timeout: 120_000 }, () => {
	let ctx: ConcurrentTestContext;
	let clients: TestClient[];

	beforeAll(async () => {
		ctx = createTestContext('mcp-ordering-');
		resetIdCounter();
		clients = await spawnMcpClients(CLIENT_COUNT, {
			instructionsDir: ctx.instructionsDir,
		});
	}, 90_000);

	afterAll(async () => {
		await closeAllClients(clients);
		await ctx.cleanup();
	});

	it('read-after-write: all clients eventually see a new entry', async () => {
		const id = testId(0, 'visibility');
		const CONSISTENCY_WINDOW_MS = 10_000; // generous for cross-process file sync

		// Client 0 creates the entry
		await clients[0].create({
			id,
			title: 'Visibility test',
			body: 'Should be visible to all clients eventually',
			categories: ['ordering-test'],
		});

		// Clients 1-4 poll until they see it
		const visibilityResults = await Promise.all(
			clients.slice(1).map(async (client, ri) => {
				const clientIdx = ri + 1;
				const start = Date.now();
				const visible = await waitFor(async () => {
					try {
						const entry = await client.read(id);
						return entry !== null && entry !== undefined;
					} catch {
						return false;
					}
				}, CONSISTENCY_WINDOW_MS, 250);
				const elapsed = Date.now() - start;
				return { clientIdx, visible, elapsed };
			}),
		);

		for (const r of visibilityResults) {
			expect(r.visible, `Client ${r.clientIdx} did not see entry within ${CONSISTENCY_WINDOW_MS}ms`).toBe(true);
		}

		// Log consistency latencies
		// eslint-disable-next-line no-console
		console.log('Visibility latencies:', visibilityResults.map(r => `client-${r.clientIdx}: ${r.elapsed}ms`).join(', '));
	});

	it('concurrent updates to same entry: last-write-wins, no corruption', async () => {
		const id = testId(0, 'update-race');

		// Seed the entry from client 0
		await clients[0].create({
			id,
			title: 'Update race seed',
			body: 'Original body',
			categories: ['ordering-test'],
		});

		await new Promise(r => setTimeout(r, 1000));

		// All clients update the same entry simultaneously
		const updatePromises = clients.map(async (client, ci) => {
			await client.update({
				id,
				title: `Updated by client ${ci}`,
				body: `Body written by client-${ci} at ${Date.now()}`,
			});
		});

		await Promise.allSettled(updatePromises);
		await new Promise(r => setTimeout(r, 1500));

		// Read the final state — it should be one of the client's writes, not corrupted
		const rawFinal = await clients[0].read(id) as Record<string, unknown>;
		expect(rawFinal).toBeTruthy();

		// Dispatch get returns { hash, item: { id, body, ... } }
		const final = (rawFinal.item ?? rawFinal) as Record<string, unknown>;
		expect(final.id).toBe(id);

		// Title should match one of the client patterns
		const title = final.title as string;
		expect(title).toMatch(/^Updated by client [0-4]$/);

		// Body should be a complete, non-corrupted string
		const body = final.body as string;
		expect(body).toMatch(/^Body written by client-[0-4] at \d+$/);
	});

	it('delete + read race: reader gets valid entry or clean not-found', async () => {
		const id = testId(0, 'delete-race');

		await clients[0].create({
			id,
			title: 'Delete race target',
			body: 'This entry will be deleted during reads',
			categories: ['ordering-test'],
		});

		await new Promise(r => setTimeout(r, 1000));

		// Client 0 deletes, clients 1-4 try to read simultaneously
		const readResults: Array<{ clientIdx: number; outcome: 'found' | 'not-found' | 'error'; detail?: string }> = [];

		const deletePromise = clients[0].remove(id);

		const readPromises = clients.slice(1).map(async (client, ri) => {
			const clientIdx = ri + 1;
			try {
				const entry = await client.read(id);
				// Check if the response indicates not-found
				const text = typeof entry === 'string' ? entry : JSON.stringify(entry);
				if (text.includes('not found') || text.includes('Not found') || text.includes('404')) {
					readResults.push({ clientIdx, outcome: 'not-found' });
				} else {
					readResults.push({ clientIdx, outcome: 'found' });
				}
			} catch (err) {
				const msg = String(err);
				if (msg.includes('not found') || msg.includes('Not found') || msg.includes('404')) {
					readResults.push({ clientIdx, outcome: 'not-found' });
				} else {
					readResults.push({ clientIdx, outcome: 'error', detail: msg });
				}
			}
		});

		await Promise.all([deletePromise, ...readPromises]);

		// Every reader should get either a valid entry or a clean not-found — never corruption
		for (const r of readResults) {
			expect(
				r.outcome === 'found' || r.outcome === 'not-found',
				`Client ${r.clientIdx} got unexpected error: ${r.detail}`,
			).toBe(true);
		}
	});

	it('rapid create-delete cycles do not leave orphaned state', async () => {
		const cycleCount = 5;
		const ids: string[] = [];

		// Rapid create-then-delete from client 0
		for (let i = 0; i < cycleCount; i++) {
			const id = testId(0, `rapid-cycle-${i}`);
			ids.push(id);
			await clients[0].create({
				id,
				title: `Rapid cycle ${i}`,
				body: `Cycle entry ${i}`,
				categories: ['ordering-test'],
			});
			await clients[0].remove(id);
		}

		await new Promise(r => setTimeout(r, 2000));

		// None of the entries should exist in Index
		const listing = await clients[0].list();
		const listedIds = listing.items.map((e: { id: string }) => e.id);
		for (const id of ids) {
			expect(listedIds, `Orphaned entry found: ${id}`).not.toContain(id);
		}
	});

	it('concurrent list calls return consistent count', async () => {
		// Seed a known number of entries
		const seedCount = 5;
		for (let i = 0; i < seedCount; i++) {
			await clients[0].create({
				id: testId(0, `list-consistency-${i}`),
				title: `List consistency seed ${i}`,
				body: `Seed body ${i}`,
				categories: ['ordering-test'],
			});
		}

		await new Promise(r => setTimeout(r, 2000));

		// All clients list simultaneously
		const counts: number[] = [];
		const listPromises = clients.map(async (client) => {
			const listing = await client.list();
			counts.push(listing.count);
		});

		await Promise.all(listPromises);

		// All clients should see the same count (eventual consistency achieved after 2s wait)
		const uniqueCounts = [...new Set(counts)];
		expect(uniqueCounts.length, `List counts diverged: ${counts.join(', ')}`).toBe(1);
	});
});
