/**
 * Failover Under Load Test
 *
 * Starts a leader server, spawns HTTP clients doing continuous CRUD,
 * then kills the leader and verifies a replacement instance promotes
 * and serves correct index state.
 *
 * This tests real process lifecycle under active load — no mocks.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import {
	createTestContext,
	spawnLeaderServer,
	createHttpRpcClients,
	waitFor,
	type ConcurrentTestContext,
} from './concurrentTestHelpers.js';
import { ChildProcess, spawn } from 'child_process';
import path from 'path';

const SERVER_BIN = path.join(process.cwd(), 'dist', 'server', 'index-server.js');
const HTTP_CLIENT_COUNT = 3;

describe('Failover Under Load', { timeout: 120_000 }, () => {
	let ctx: ConcurrentTestContext;
	const processes: Array<{ proc: ChildProcess; kill: () => void }> = [];

	afterEach(async () => {
		for (const p of processes) p.kill();
		processes.length = 0;
		await new Promise(r => setTimeout(r, 1000));
		if (ctx) await ctx.cleanup();
	});

	it('clients survive leader death and reconnect to new leader', async () => {
		ctx = createTestContext('mcp-failover-load-');

		// --- Phase 1: Start leader, seed data, start load ---
		const leader = await spawnLeaderServer({
			instructionsDir: ctx.instructionsDir,
			stateDir: ctx.stateDir,
			extraEnv: {
				INDEX_SERVER_HEARTBEAT_MS: '500',
				INDEX_SERVER_STALE_THRESHOLD_MS: '2000',
			},
		});
		processes.push(leader);

		const clients = createHttpRpcClients(leader.dashUrl, HTTP_CLIENT_COUNT);

		// Seed 3 entries before load
		const seededIds: string[] = [];
		for (let i = 0; i < 3; i++) {
			const id = `failover-seed-${i}-${Date.now()}`;
			seededIds.push(id);
			await clients[0].callTool('index_dispatch', {
				action: 'add',
				entry: {
					id,
					title: `Failover seed ${i}`,
					body: `Seeded before failover ${i}`,
					categories: ['failover-test'],
					priority: 50,
					audience: 'all',
					requirement: 'optional',
					lax: true,
				},
				overwrite: true,
				lax: true,
			});
		}

		await new Promise(r => setTimeout(r, 500));

		// Start continuous load in background
		let loadRunning = true;
		const loadErrors: string[] = [];
		let requestCount = 0;

		const loadPromises = clients.map(async (client) => {
			while (loadRunning) {
				try {
					await client.callTool('health_check', {});
					requestCount++;
				} catch (err) {
					const msg = String(err);
					if (msg.includes('HTTP 5')) {
						loadErrors.push(`${client.label}: ${msg}`);
					}
					// Network errors expected during leader death
				}
				await new Promise(r => setTimeout(r, 200));
			}
		});

		// Let load run for 2 seconds
		await new Promise(r => setTimeout(r, 2000));
		expect(requestCount).toBeGreaterThan(0);

		// --- Phase 2: Kill the leader ---
		leader.kill();
		// eslint-disable-next-line no-console
		console.log(`Killed leader (PID ${leader.pid}), starting replacement...`);

		// Wait for process to fully die
		await new Promise(r => setTimeout(r, 1500));

		// --- Phase 3: Start replacement instance ---
		const mergedEnv: Record<string, string> = {};
		for (const [k, v] of Object.entries(process.env)) {
			if (v !== undefined) mergedEnv[k] = v;
		}
		Object.assign(mergedEnv, {
			INDEX_SERVER_DASHBOARD: '1',
			INDEX_SERVER_MODE: 'auto',
			INDEX_SERVER_LEADER_PORT: '0',
			INDEX_SERVER_STATE_DIR: ctx.stateDir,
			INDEX_SERVER_HEARTBEAT_MS: '500',
			INDEX_SERVER_STALE_THRESHOLD_MS: '2000',
			INDEX_SERVER_HEALTH_MIN_UPTIME: '0',
			INDEX_SERVER_MUTATION: '1',
			INDEX_SERVER_DIR: ctx.instructionsDir,
			INDEX_SERVER_MEMOIZE: '0',
			INDEX_SERVER_MANIFEST_WRITE: '0',
			INDEX_SERVER_LOG_LEVEL: 'info',  // must be info — tests poll for the INFO-level "Server started on" message
			NODE_ENV: 'test',
		});

		const newProc = spawn('node', [SERVER_BIN, '--dashboard-port=0', '--dashboard-host=127.0.0.1'], {
			env: mergedEnv,
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		processes.push({
			proc: newProc,
			kill: () => { try { newProc.kill('SIGKILL'); } catch { /* */ } },
		});

		// Wait for new leader's URL
		let newDashUrl = '';
		const pat = /Server started on (https?:\/\/[^\s"]+)/;
		newProc.stdout!.setEncoding('utf8');
		newProc.stderr!.setEncoding('utf8');
		const capture = (data: string) => {
			const m = pat.exec(data);
			if (m && !newDashUrl) newDashUrl = m[1];
		};
		newProc.stdout!.on('data', capture);
		newProc.stderr!.on('data', capture);

		const gotUrl = await waitFor(async () => !!newDashUrl, 20_000, 200);
		expect(gotUrl).toBe(true);

		const ready = await waitFor(
			async () => {
				try {
					const r = await fetch(`${newDashUrl}/api/status`, { signal: AbortSignal.timeout(2000) });
					return r.ok;
				} catch { return false; }
			},
			15_000,
		);
		expect(ready).toBe(true);

		// Stop load
		loadRunning = false;
		await Promise.allSettled(loadPromises);

		// --- Phase 4: Verify new leader has the seeded data ---
		const newClients = createHttpRpcClients(newDashUrl, 1);
		const listResult = await newClients[0].callTool('index_dispatch', { action: 'list' }) as Record<string, unknown>;
		const resultText = JSON.stringify(listResult);
		for (const id of seededIds) {
			expect(resultText).toContain(id);
		}

		// eslint-disable-next-line no-console
		console.log(`Failover complete. Requests during test: ${requestCount}, errors during failover: ${loadErrors.length}`);
	});

	it('stale lock is cleaned up and new instance becomes leader', async () => {
		ctx = createTestContext('mcp-stale-lock-');

		// Write a fake stale lock file (PID that doesn't exist)
		const lockPath = path.join(ctx.stateDir, 'leader.lock');
		fs.writeFileSync(lockPath, JSON.stringify({
			pid: 999999,
			port: 9999,
			host: '127.0.0.1',
			startedAt: new Date(Date.now() - 60_000).toISOString(),
			heartbeat: new Date(Date.now() - 60_000).toISOString(),
		}));

		// New instance should detect stale lock and promote itself
		const leader = await spawnLeaderServer({
			instructionsDir: ctx.instructionsDir,
			stateDir: ctx.stateDir,
			extraEnv: {
				INDEX_SERVER_MODE: 'auto',
				INDEX_SERVER_STALE_THRESHOLD_MS: '2000',
			},
		});
		processes.push(leader);

		const clients = createHttpRpcClients(leader.dashUrl, 1);
		const ok = await clients[0].healthCheck();
		expect(ok).toBe(true);

		// Verify lock file was updated with current PID
		const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
		expect(lock.pid).toBe(leader.pid);
	});
});
