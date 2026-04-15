/**
 * Lightweight MCP test client using @modelcontextprotocol/sdk directly.
 * Replaces the vendored portable-mcp-client for test infrastructure.
 *
 * Provides two levels of abstraction:
 * - `spawnServer()` — low-level: spawns server, performs MCP initialize handshake
 * - `createTestClient()` — high-level: CRUD operations via index_dispatch
 */
// Dynamic imports to handle CJS -> ESM boundary
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _Client: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _StdioClientTransport: any;

async function getSDK() {
	if (!_Client) {
		const clientMod = await import('@modelcontextprotocol/sdk/client/index.js');
		_Client = clientMod.Client;
	}
	if (!_StdioClientTransport) {
		const stdioMod = await import('@modelcontextprotocol/sdk/client/stdio.js');
		_StdioClientTransport = stdioMod.StdioClientTransport;
	}
	return { Client: _Client, StdioClientTransport: _StdioClientTransport };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpawnServerOptions {
	/** Command to run (default: 'node') */
	command?: string;
	/** Arguments (default: ['dist/server/index-server.js']) */
	args?: string[];
	/** Extra environment variables merged onto process.env */
	env?: Record<string, string>;
	/** Client name for MCP handshake (default: 'mcp-test-client') */
	clientName?: string;
	/** Connect timeout in ms (default: 6000) */
	connectTimeoutMs?: number;
	/** Readiness poll budget in ms (default: 4000) */
	readinessTimeoutMs?: number;
}

export interface ServerConnection {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	client: any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	transport: any;
	/** Available tool names discovered during handshake */
	toolNames: string[];
	/** Close the connection and kill the server process */
	close: () => Promise<void>;
}

export interface TestClientOptions extends SpawnServerOptions {
	/** Instructions directory (sets INDEX_SERVER_DIR env) */
	instructionsDir?: string;
	/** Force mutation mode (default: true, sets INDEX_SERVER_MUTATION=1) */
	forceMutation?: boolean;
	/** Additional env vars beyond instructionsDir/mutation */
	extraEnv?: Record<string, string>;
}

export interface InstructionEntry {
	id: string;
	title?: string;
	body: string;
	priority?: number;
	audience?: string;
	requirement?: string;
	categories?: string[];
	[key: string]: unknown;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonValue = any;

export interface TestClient {
	create: (entry: InstructionEntry, opts?: { overwrite?: boolean }) => Promise<JsonValue>;
	read: (id: string) => Promise<JsonValue>;
	update: (entry: InstructionEntry) => Promise<JsonValue>;
	remove: (id: string) => Promise<JsonValue>;
	list: () => Promise<{ items: JsonValue[]; count: number; hash?: string }>;
	/** Bulk import entries */
	importBulk: (entries: InstructionEntry[], opts?: { mode?: 'skip' | 'overwrite' }) => Promise<JsonValue>;
	/** Patch governance fields (owner, status, review dates, version bump) */
	governanceUpdate: (args: Record<string, unknown>) => Promise<JsonValue>;
	/** Call any tool by name with arbitrary arguments */
	callTool: (name: string, args: Record<string, unknown>) => Promise<JsonValue>;
	/** Call a tool and parse the JSON text response */
	callToolJSON: (name: string, args: Record<string, unknown>) => Promise<JsonValue>;
	/** Whether the server exposes index_dispatch */
	hasDispatcher: boolean;
	/** Available tool names */
	toolNames: string[];
	close: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Low-level: spawn server and connect
// ---------------------------------------------------------------------------

export async function spawnServer(opts: SpawnServerOptions = {}): Promise<ServerConnection> {
	const {
		command = 'node',
		args = ['dist/server/index-server.js'],
		env = {},
		clientName = 'mcp-test-client',
		connectTimeoutMs = 6000,
		readinessTimeoutMs = 4000,
	} = opts;

	const { Client, StdioClientTransport } = await getSDK();
	const mergedEnv: Record<string, string> = {};
	for (const [k, v] of Object.entries(process.env)) {
		if (v !== undefined) mergedEnv[k] = v;
	}
	Object.assign(mergedEnv, env);
	const transport = new StdioClientTransport({ command, args, env: mergedEnv });
	const client = new Client(
		{ name: clientName, version: '1.0.0' },
		{ capabilities: { tools: {} } },
	);

	// Connect with timeout
	let timedOut = false;
	const connectPromise = client.connect(transport);
	await Promise.race([
		connectPromise,
		new Promise<void>((resolve) =>
			setTimeout(() => {
				timedOut = true;
				resolve();
			}, connectTimeoutMs),
		),
	]);

	if (timedOut) {
		// eslint-disable-next-line no-console
		console.error(`[mcp-test-client] connect timeout after ${connectTimeoutMs}ms`);
	}

	// Readiness gating: poll listTools until it succeeds
	let toolNames: string[] = [];
	if (!timedOut) {
		const readinessStart = Date.now();
		const pollInterval = 125;
		while (Date.now() - readinessStart < readinessTimeoutMs) {
			try {
				const tl = await client.listTools();
				if (Array.isArray(tl?.tools)) {
					toolNames = tl.tools.map((t: { name: string }) => t.name);
					break;
				}
			} catch {
				/* retry */
			}
			await new Promise((r) => setTimeout(r, pollInterval));
		}
	}

	async function close() {
		await transport.close();
	}

	return { client, transport, toolNames, close };
}

// ---------------------------------------------------------------------------
// High-level: CRUD test client
// ---------------------------------------------------------------------------

export async function createTestClient(opts: TestClientOptions = {}): Promise<TestClient> {
	const {
		instructionsDir,
		forceMutation = true,
		extraEnv = {},
		...spawnOpts
	} = opts;

	const env: Record<string, string> = { ...extraEnv };
	if (forceMutation) {
		env.INDEX_SERVER_MUTATION = '1';
	}
	if (instructionsDir) {
		env.INDEX_SERVER_DIR = instructionsDir;
	}

	const conn = await spawnServer({ ...spawnOpts, env });
	const { client, toolNames } = conn;
	const hasDispatcher = toolNames.includes('index_dispatch');

	async function callToolRaw(name: string, args: Record<string, unknown>) {
		return client.callTool({ name, arguments: args });
	}

	async function callToolJSON(name: string, args: Record<string, unknown>): Promise<JsonValue> {
		const resp = await callToolRaw(name, args);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const txt = (resp as any).content?.[0]?.text;
		if (!txt) return undefined;
		try {
			return JSON.parse(txt);
		} catch {
			return undefined;
		}
	}

	function normalizeEntry(entry: InstructionEntry) {
		return {
			id: entry.id,
			title: entry.title || entry.id,
			body: entry.body,
			priority: entry.priority ?? 50,
			audience: entry.audience ?? 'all',
			requirement: entry.requirement ?? 'optional',
			categories: entry.categories ?? [],
			lax: true,
		};
	}

	// Track last created id for expectId hinting on list()
	let lastCreatedId: string | undefined;

	async function create(entry: InstructionEntry, { overwrite = true } = {}): Promise<JsonValue> {
		const norm = normalizeEntry(entry);
		let result: JsonValue;
		if (hasDispatcher) {
			result = await callToolJSON('index_dispatch', {
				action: 'add',
				entry: norm,
				overwrite,
				lax: true,
			});
		} else {
			const legacyName = toolNames.includes('index_add') ? 'index_add' : null;
			if (!legacyName) throw new Error('no add tool available');
			result = await callToolJSON(legacyName, { entry: norm, overwrite, lax: true });
		}
		if (result && (result.created || result.overwritten) && result.id) {
			lastCreatedId = result.id;
		}
		return result;
	}

	async function read(id: string): Promise<JsonValue> {
		if (hasDispatcher) {
			return callToolJSON('index_dispatch', { action: 'get', id });
		}
		if (toolNames.includes('instructions_get')) {
			return callToolJSON('instructions_get', { id });
		}
		throw new Error('no get tool available');
	}

	async function update(entry: InstructionEntry): Promise<JsonValue> {
		return create(entry, { overwrite: true });
	}

	async function remove(id: string): Promise<JsonValue> {
		if (hasDispatcher) {
			return callToolJSON('index_dispatch', { action: 'remove', id });
		}
		if (toolNames.includes('index_remove')) {
			return callToolJSON('index_remove', { ids: [id], missingOk: true });
		}
		throw new Error('no remove tool available');
	}

	async function list(): Promise<{ items: JsonValue[]; count: number; hash?: string }> {
		let obj: JsonValue;
		if (hasDispatcher) {
			const args: Record<string, unknown> = { action: 'list' };
			if (lastCreatedId) args.expectId = lastCreatedId;
			obj = await callToolJSON('index_dispatch', args);
		} else if (toolNames.includes('instructions_list')) {
			obj = await callToolJSON('instructions_list', {});
		} else {
			throw new Error('no list tool available');
		}

		if (Array.isArray(obj)) {
			return { items: obj, count: obj.length };
		}
		const items = Array.isArray(obj?.items) ? obj.items : [];
		return { items, count: obj?.count ?? items.length, hash: obj?.hash };
	}

	async function importBulk(entries: InstructionEntry[], { mode = 'overwrite' as 'skip' | 'overwrite' } = {}): Promise<JsonValue> {
		if (hasDispatcher) {
			return callToolJSON('index_dispatch', { action: 'import', entries, mode });
		}
		if (toolNames.includes('index_import')) {
			return callToolJSON('index_import', { entries, mode });
		}
		throw new Error('no import tool available');
	}

	async function governanceUpdate(args: Record<string, unknown>): Promise<JsonValue> {
		if (hasDispatcher) {
			return callToolJSON('index_dispatch', { action: 'governanceUpdate', ...args });
		}
		if (toolNames.includes('index_governanceUpdate')) {
			return callToolJSON('index_governanceUpdate', args);
		}
		throw new Error('no governanceUpdate tool available');
	}

	async function close() {
		await conn.close();
	}

	return {
		create,
		read,
		update,
		remove,
		list,
		importBulk,
		governanceUpdate,
		callTool: callToolRaw as TestClient['callTool'],
		callToolJSON,
		hasDispatcher,
		toolNames,
		close,
	};
}
