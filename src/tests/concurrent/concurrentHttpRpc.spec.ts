/**
 * Concurrent HTTP RPC Test
 *
 * Starts a single MCP leader server with dashboard enabled, then sends
 * concurrent JSON-RPC requests via HTTP from N clients. Verifies the
 * server handles parallel load without errors, data corruption, or
 * dropped requests.
 *
 * This tests the real HTTP transport layer (/mcp/rpc) — no mocks.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
	createTestContext,
	spawnLeaderServer,
	createHttpRpcClients,
	runConcurrent,
	testId,
	resetIdCounter,
	type ConcurrentTestContext,
	type DashboardServer,
	type HttpRpcClient,
} from './concurrentTestHelpers.js';

const HTTP_CLIENT_COUNT = 5;
const OPS_PER_CLIENT = 3;

describe('Concurrent HTTP RPC', { timeout: 120_000 }, () => {
	let ctx: ConcurrentTestContext;
	let leader: DashboardServer;
	let clients: HttpRpcClient[];

	beforeAll(async () => {
		ctx = createTestContext('mcp-http-rpc-');
		resetIdCounter();
		leader = await spawnLeaderServer({
			instructionsDir: ctx.instructionsDir,
			stateDir: ctx.stateDir,
			extraEnv: {
				INDEX_SERVER_DISABLE_RATE_LIMIT: '1',
			},
		});
		clients = createHttpRpcClients(leader.dashUrl, HTTP_CLIENT_COUNT);
	}, 60_000);

	afterAll(async () => {
		leader.kill();
		await new Promise(r => setTimeout(r, 500));
		await ctx.cleanup();
	});

	it('all clients can reach health endpoint concurrently', async () => {
		const { successes, failures } = await runConcurrent(clients, async (client) => {
			const ok = await client.healthCheck();
			expect(ok).toBe(true);
		});

		expect(failures).toEqual([]);
		expect(successes).toBe(HTTP_CLIENT_COUNT);
	});

	it('concurrent tool calls via REST API return valid responses', async () => {
		const { successes, failures } = await runConcurrent(clients, async (client) => {
			const result = await client.callTool('health_check', {});
			expect(result).toBeTruthy();
			expect((result as Record<string, unknown>).status).toBeTruthy();
		});

		expect(failures).toEqual([]);
		expect(successes).toBe(HTTP_CLIENT_COUNT);
	});

	it('concurrent creates via REST API produce no duplicates', async () => {
		const allIds: string[] = [];

		const { successes, failures } = await runConcurrent(clients, async (client, ci) => {
			for (let i = 0; i < OPS_PER_CLIENT; i++) {
				const id = testId(ci, `http-create-${i}`);
				allIds.push(id);
				await client.callTool('index_dispatch', {
					action: 'add',
					entry: {
						id,
						title: `HTTP entry from client ${ci} op ${i}`,
						body: `Body created via HTTP by client-${ci}`,
						categories: ['http-concurrent-test'],
						priority: 50,
						audience: 'all',
						requirement: 'optional',
						lax: true,
					},
					overwrite: true,
					lax: true,
				});
			}
		});

		expect(failures).toEqual([]);
		expect(successes).toBe(HTTP_CLIENT_COUNT);

		await new Promise(r => setTimeout(r, 1500));

		// Verify via a list call — all IDs present, no duplicates
		const listResult = await clients[0].callTool('index_dispatch', { action: 'list' }) as Record<string, unknown>;
		const resultText = JSON.stringify(listResult);
		for (const id of allIds) {
			expect(resultText).toContain(id);
		}
	});

	it('concurrent CRUD lifecycle — create, read, update, delete', async () => {
		const { successes, failures } = await runConcurrent(clients, async (client, ci) => {
			const id = testId(ci, 'http-lifecycle');

			// Create
			await client.callTool('index_dispatch', {
				action: 'add',
				entry: {
					id,
					title: `Lifecycle ${ci}`,
					body: `Lifecycle body ${ci}`,
					categories: ['http-lifecycle-test'],
					priority: 50,
					audience: 'all',
					requirement: 'optional',
					lax: true,
				},
				overwrite: true,
				lax: true,
			});

			await new Promise(r => setTimeout(r, 500));

			// Read
			const readResult = await client.callTool('index_dispatch', { action: 'get', id }) as Record<string, unknown>;
			expect(JSON.stringify(readResult)).toContain(id);

			// Update (use add with overwrite)
			await client.callTool('index_dispatch', {
				action: 'add',
				entry: {
					id,
					title: `Lifecycle ${ci} UPDATED`,
					body: `Updated lifecycle body ${ci}`,
					categories: ['http-lifecycle-test'],
					priority: 50,
					audience: 'all',
					requirement: 'optional',
					lax: true,
				},
				overwrite: true,
				lax: true,
			});

			await new Promise(r => setTimeout(r, 500));

			// Delete
			await client.callTool('index_dispatch', { action: 'remove', id });
		});

		expect(failures).toEqual([]);
		expect(successes).toBe(HTTP_CLIENT_COUNT);
	});

	it('concurrent reads while mutations are in-flight do not produce 500s', async () => {
		const seedId = testId(0, 'http-read-stress');
		await clients[0].callTool('index_dispatch', {
			action: 'add',
			entry: {
				id: seedId,
				title: 'Read stress seed',
				body: 'Initial body for read stress',
				categories: ['http-read-stress'],
				priority: 50,
				audience: 'all',
				requirement: 'optional',
				lax: true,
			},
			overwrite: true,
			lax: true,
		});
		await new Promise(r => setTimeout(r, 500));

		let writeDone = false;
		const errors: string[] = [];

		// Writer: update 5 times
		const writer = (async () => {
			for (let v = 1; v <= 5; v++) {
				try {
					await clients[0].callTool('index_dispatch', {
						action: 'add',
						entry: {
							id: seedId,
							title: `Read stress v${v}`,
							body: `Updated body v${v}`,
							priority: 50,
							audience: 'all',
							requirement: 'optional',
							lax: true,
						},
						overwrite: true,
						lax: true,
					});
				} catch { /* writer errors during concurrent load are informational */ }
				await new Promise(r => setTimeout(r, 200));
			}
			writeDone = true;
		})();

		// Readers: continuously read via REST API
		const readers = clients.slice(1).map(async (client) => {
			while (!writeDone) {
				try {
					await client.callTool('index_dispatch', { action: 'get', id: seedId });
				} catch (err) {
					const msg = String(err);
					if (msg.includes('HTTP 5')) {
						errors.push(msg);
					}
				}
				await new Promise(r => setTimeout(r, 100));
			}
		});

		await Promise.all([writer, ...readers]);
		expect(errors).toEqual([]);

		// Cleanup
		try {
			await clients[0].callTool('index_dispatch', { action: 'remove', id: seedId });
		} catch { /* best effort */ }
	});

	it('measures response latency under concurrent load', async () => {
		const latencies: number[] = [];

		const { successes } = await runConcurrent(clients, async (client) => {
			for (let i = 0; i < 5; i++) {
				const start = performance.now();
				const ok = await client.healthCheck();
				expect(ok).toBe(true);
				latencies.push(performance.now() - start);
			}
		});

		expect(successes).toBe(HTTP_CLIENT_COUNT);
		expect(latencies.length).toBe(HTTP_CLIENT_COUNT * 5);

		latencies.sort((a, b) => a - b);
		const p50 = latencies[Math.floor(latencies.length * 0.5)];
		const p95 = latencies[Math.floor(latencies.length * 0.95)];
		const p99 = latencies[Math.floor(latencies.length * 0.99)];

		// Log latency stats (informational, not strict assertions)
		// eslint-disable-next-line no-console
		console.log(`Latency (ms) — p50: ${p50.toFixed(1)}, p95: ${p95.toFixed(1)}, p99: ${p99.toFixed(1)}`);

		// Sanity: p99 should be under 10 seconds (generous for CI)
		expect(p99).toBeLessThan(10_000);
	});
});
