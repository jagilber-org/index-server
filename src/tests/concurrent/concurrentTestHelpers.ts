/**
 * Concurrent Test Helpers
 *
 * Provides utilities for spawning multiple MCP clients and servers
 * to exercise concurrent access patterns. Builds on existing
 * mcpTestClient.ts and multiInstanceFailover.spec.ts patterns.
 */
import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createTestClient, type TestClient } from '../helpers/mcpTestClient.js';

const SERVER_BIN = path.join(process.cwd(), 'dist', 'server', 'index-server.js');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardServer {
	proc: ChildProcess;
	dashUrl: string;
	pid: number;
	kill: () => void;
}

export interface HttpRpcClient {
	label: string;
	/** Send a JSON-RPC 2.0 call to the leader's /mcp/rpc endpoint */
	rpc: (method: string, params?: unknown, id?: number) => Promise<RpcResponse>;
	/** Convenience: call a tool by name */
	callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
	/** Health check via dashboard /api/status */
	healthCheck: () => Promise<boolean>;
}

export interface RpcResponse {
	httpStatus: number;
	jsonrpc?: string;
	id?: number;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

export interface ConcurrentTestContext {
	tmpDir: string;
	instructionsDir: string;
	stateDir: string;
	cleanup: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Temp directory & context setup
// ---------------------------------------------------------------------------

export function createTestContext(prefix = 'mcp-concurrent-'): ConcurrentTestContext {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	const instructionsDir = path.join(tmpDir, 'instructions');
	const stateDir = path.join(tmpDir, 'state');
	fs.mkdirSync(instructionsDir, { recursive: true });
	fs.mkdirSync(stateDir, { recursive: true });

	return {
		tmpDir,
		instructionsDir,
		stateDir,
		async cleanup() {
			try {
				fs.rmSync(tmpDir, { recursive: true, force: true });
			} catch { /* best effort */ }
		},
	};
}

// ---------------------------------------------------------------------------
// Deterministic test ID generation
// ---------------------------------------------------------------------------

let _idCounter = 0;

export function testId(clientIdx: number, suffix = ''): string {
	const seq = _idCounter++;
	const s = suffix ? `-${suffix}` : '';
	return `ct-${clientIdx}-${seq}${s}`;
}

export function resetIdCounter(): void {
	_idCounter = 0;
}

// ---------------------------------------------------------------------------
// Spawn N stdio-based MCP test clients (each is its own server process)
// ---------------------------------------------------------------------------

export async function spawnMcpClients(
	count: number,
	opts: {
		instructionsDir: string;
		extraEnv?: Record<string, string>;
		connectTimeoutMs?: number;
		readinessTimeoutMs?: number;
	},
): Promise<TestClient[]> {
	const clients: TestClient[] = [];
	// Spawn sequentially to avoid port/lock contention during init
	for (let i = 0; i < count; i++) {
		const client = await createTestClient({
			instructionsDir: opts.instructionsDir,
			forceMutation: true,
			extraEnv: {
				INDEX_SERVER_MEMOIZE: '0',           // disable memoize for cross-process freshness
				INDEX_SERVER_ENABLE_INDEX_SERVER_POLLER: '1',      // enable cross-process poll
				INDEX_SERVER_POLL_MS: '500',           // fast poll for tests
				INDEX_SERVER_MANIFEST_WRITE: '0',              // skip manifest overhead
				INDEX_SERVER_LOG_LEVEL: 'warn',
				...opts.extraEnv,
			},
			connectTimeoutMs: opts.connectTimeoutMs ?? 10_000,
			readinessTimeoutMs: opts.readinessTimeoutMs ?? 8_000,
		});
		clients.push(client);
	}
	return clients;
}

export async function closeAllClients(clients: TestClient[]): Promise<void> {
	await Promise.allSettled(clients.map(c => c.close()));
}

// ---------------------------------------------------------------------------
// Spawn a leader server with dashboard (HTTP RPC endpoint)
// ---------------------------------------------------------------------------

export async function spawnLeaderServer(opts: {
	instructionsDir: string;
	stateDir: string;
	extraEnv?: Record<string, string>;
	startupTimeoutMs?: number;
}): Promise<DashboardServer> {
	const startupTimeout = opts.startupTimeoutMs ?? 20_000;

	const mergedEnv: Record<string, string> = {};
	for (const [k, v] of Object.entries(process.env)) {
		if (v !== undefined) mergedEnv[k] = v;
	}
	Object.assign(mergedEnv, {
		INDEX_SERVER_DASHBOARD: '1',
		INDEX_SERVER_MODE: 'leader',
		INDEX_SERVER_LEADER_PORT: '0',
		INDEX_SERVER_STATE_DIR: opts.stateDir,
		INDEX_SERVER_HEARTBEAT_MS: '1000',
		INDEX_SERVER_HEALTH_MIN_UPTIME: '0',
		INDEX_SERVER_MUTATION: '1',
		INDEX_SERVER_DIR: opts.instructionsDir,
		INDEX_SERVER_MEMOIZE: '0',
		INDEX_SERVER_MANIFEST_WRITE: '0',
		INDEX_SERVER_LOG_LEVEL: 'warn',
		NODE_ENV: 'test',
		...opts.extraEnv,
	});

	const proc = spawn('node', [SERVER_BIN, '--dashboard-port=0', '--dashboard-host=127.0.0.1'], {
		env: mergedEnv,
		stdio: ['pipe', 'pipe', 'pipe'],
	});

	let dashUrl = '';
	const pat = /Server started on (http:\/\/[^\s]+)/;

	proc.stdout!.setEncoding('utf8');
	proc.stderr!.setEncoding('utf8');

	const capture = (data: string) => {
		const m = pat.exec(data);
		if (m && !dashUrl) dashUrl = m[1];
	};
	proc.stdout!.on('data', capture);
	proc.stderr!.on('data', capture);

	const start = Date.now();
	while (!dashUrl && Date.now() - start < startupTimeout) {
		if (proc.exitCode !== null) break;
		await new Promise(r => setTimeout(r, 100));
	}

	if (!dashUrl) {
		try { proc.kill(); } catch { /* */ }
		throw new Error(`Leader server start timeout after ${startupTimeout}ms`);
	}

	// Wait for health endpoint
	const ready = await waitFor(
		async () => {
			try {
				const r = await fetch(`${dashUrl}/api/status`, { signal: AbortSignal.timeout(2000) });
				return r.ok;
			} catch { return false; }
		},
		startupTimeout - (Date.now() - start),
	);

	if (!ready) {
		try { proc.kill(); } catch { /* */ }
		throw new Error('Leader health readiness timeout');
	}

	return {
		proc,
		dashUrl,
		pid: proc.pid!,
		kill: () => { try { proc.kill('SIGKILL'); } catch { /* */ } },
	};
}

// ---------------------------------------------------------------------------
// Create HTTP RPC clients pointing at a leader's /mcp/rpc endpoint
// ---------------------------------------------------------------------------

export function createHttpRpcClient(dashUrl: string, label: string): HttpRpcClient {
	let nextId = 1;

	async function rpc(method: string, params?: unknown, id?: number): Promise<RpcResponse> {
		const rpcId = id ?? nextId++;
		const body = JSON.stringify({ jsonrpc: '2.0', method, params, id: rpcId });
		try {
			const resp = await fetch(`${dashUrl}/mcp/rpc`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body,
				signal: AbortSignal.timeout(15_000),
			});
			const data = await resp.json() as Record<string, unknown>;
			return {
				httpStatus: resp.status,
				jsonrpc: data.jsonrpc as string | undefined,
				id: data.id as number | undefined,
				result: data.result,
				error: data.error as RpcResponse['error'],
			};
		} catch (err) {
			return { httpStatus: 0, error: { code: -1, message: String(err) } };
		}
	}

	/** Call a tool handler via the dashboard REST API (POST /api/tools/:name) */
	async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
		try {
			const resp = await fetch(`${dashUrl}/api/tools/${name}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(args),
				signal: AbortSignal.timeout(15_000),
			});
			if (!resp.ok) {
				const text = await resp.text();
				throw new Error(`HTTP ${resp.status}: ${text}`);
			}
			return await resp.json();
		} catch (err) {
			throw new Error(`callTool(${name}) failed: ${err}`);
		}
	}

	async function healthCheck(): Promise<boolean> {
		try {
			const r = await fetch(`${dashUrl}/health`, { signal: AbortSignal.timeout(5000) });
			return r.ok;
		} catch { return false; }
	}

	return { label, rpc, callTool, healthCheck };
}

export function createHttpRpcClients(dashUrl: string, count: number): HttpRpcClient[] {
	return Array.from({ length: count }, (_, i) => createHttpRpcClient(dashUrl, `http-client-${i}`));
}

// ---------------------------------------------------------------------------
// Run work function concurrently across all clients
// ---------------------------------------------------------------------------

export async function runConcurrent<T>(
	items: T[],
	workFn: (item: T, index: number) => Promise<void>,
): Promise<{ successes: number; failures: Array<{ index: number; error: Error }> }> {
	const failures: Array<{ index: number; error: Error }> = [];
	let successes = 0;

	const results = await Promise.allSettled(
		items.map((item, i) => workFn(item, i)),
	);

	for (let i = 0; i < results.length; i++) {
		if (results[i].status === 'fulfilled') {
			successes++;
		} else {
			failures.push({ index: i, error: (results[i] as PromiseRejectedResult).reason as Error });
		}
	}

	return { successes, failures };
}

// ---------------------------------------------------------------------------
// HTTP RPC with retry (for failover scenarios)
// ---------------------------------------------------------------------------

export async function rpcWithRetry(
	client: HttpRpcClient,
	method: string,
	params?: unknown,
	opts?: { retries?: number; backoffMs?: number },
): Promise<RpcResponse> {
	const retries = opts?.retries ?? 3;
	const backoff = opts?.backoffMs ?? 500;
	let lastError: RpcResponse | undefined;

	for (let attempt = 0; attempt <= retries; attempt++) {
		const resp = await client.rpc(method, params);
		if (resp.httpStatus >= 200 && resp.httpStatus < 500) return resp;
		lastError = resp;
		if (attempt < retries) {
			await new Promise(r => setTimeout(r, backoff * Math.pow(2, attempt)));
		}
	}
	return lastError!;
}

// ---------------------------------------------------------------------------
// Utility: waitFor polling helper
// ---------------------------------------------------------------------------

export async function waitFor(
	fn: () => Promise<boolean>,
	timeoutMs: number,
	intervalMs = 500,
): Promise<boolean> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try { if (await fn()) return true; } catch { /* retry */ }
		await new Promise(r => setTimeout(r, intervalMs));
	}
	return false;
}
