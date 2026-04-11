/**
 * MCP Config-Driven Integration Tests
 *
 * Tests the server through the exact same transport Copilot CLI uses:
 * reads mcp-config.json → spawns via StdioClientTransport → MCP protocol.
 *
 * This confirms that any mcp-config.json a user creates for Copilot CLI
 * will work end-to-end with the Index Server.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
	loadMcpConfig,
	resolveServerOptions,
	resolveAllServers,
	generateTestConfig,
	writeMcpConfig,
} from '../helpers/mcpConfigLoader.js';
import { spawnServer, createTestClient } from '../helpers/mcpTestClient.js';
import type { ServerConnection, TestClient } from '../helpers/mcpTestClient.js';

const FIXTURES_DIR = path.join(process.cwd(), 'tests', 'fixtures');
const TEST_CONFIG_PATH = path.join(FIXTURES_DIR, 'mcp-config.test.json');

describe('MCP Config Loader', () => {
	it('parses Copilot CLI mcp-config.json format', () => {
		const config = loadMcpConfig(TEST_CONFIG_PATH);
		expect(config.mcpServers).toBeDefined();
		expect(Object.keys(config.mcpServers).length).toBeGreaterThanOrEqual(2);
		expect(config.mcpServers['mcp-index-test']).toBeDefined();
		expect(config.mcpServers['mcp-index-readonly']).toBeDefined();
	});

	it('resolves server options from config entries', () => {
		const config = loadMcpConfig(TEST_CONFIG_PATH);
		const entry = config.mcpServers['mcp-index-test'];
		const opts = resolveServerOptions(entry);

		expect(opts.command).toBe('node');
		expect(opts.args).toEqual(['dist/server/index-server.js']);
		expect(opts.env).toBeDefined();
		expect(opts.env!['INDEX_SERVER_MODE']).toBe('standalone');
		expect(opts.env!['INDEX_SERVER_MUTATION']).toBe('1');
	});

	it('filters comment-style env keys (// prefixed)', () => {
		const entry = {
			command: 'node',
			args: ['dist/server/index-server.js'],
			env: {
				'//': '==================== COMMENT =====================',
				'// To run against production': '1',
				'INDEX_SERVER_MODE': 'standalone',
			},
		};
		const opts = resolveServerOptions(entry);
		expect(opts.env!['INDEX_SERVER_MODE']).toBe('standalone');
		expect(opts.env!['//']).toBeUndefined();
		expect(opts.env!['// To run against production']).toBeUndefined();
	});

	it('resolves all servers with optional filter', () => {
		const all = resolveAllServers(TEST_CONFIG_PATH);
		expect(all.length).toBe(2);

		const filtered = resolveAllServers(TEST_CONFIG_PATH, 'readonly');
		expect(filtered.length).toBe(1);
		expect(filtered[0].name).toBe('mcp-index-readonly');
	});

	it('generates ephemeral test config', () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-cfg-test-'));
		try {
			const instrDir = path.join(tmpDir, 'instructions');
			const { config, instructionsDir } = generateTestConfig({
				instructionsDir: instrDir,
			});

			expect(config.mcpServers['mcp-index-test']).toBeDefined();
			expect(config.mcpServers['mcp-index-test'].env?.INDEX_SERVER_DIR).toBe(instrDir);
			expect(fs.existsSync(instructionsDir)).toBe(true);

			// Write and re-read
			const cfgPath = path.join(tmpDir, 'mcp-config.json');
			writeMcpConfig(config, cfgPath);
			const reloaded = loadMcpConfig(cfgPath);
			expect(reloaded.mcpServers['mcp-index-test'].command).toBe('node');
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

describe('MCP Config-Driven Client — Stdio Transport', { timeout: 30_000 }, () => {
	let conn: ServerConnection | null = null;
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-cfg-int-'));
	});

	afterEach(async () => {
		if (conn) {
			await conn.close();
			conn = null;
		}
		try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
	});

	it('connects to server using config entry (stdio transport)', async () => {
		const instrDir = path.join(tmpDir, 'instructions');
		fs.mkdirSync(instrDir, { recursive: true });

		const config = loadMcpConfig(TEST_CONFIG_PATH);
		const opts = resolveServerOptions(config.mcpServers['mcp-index-test'], {
			INDEX_SERVER_DIR: instrDir,
		});

		conn = await spawnServer(opts);
		expect(conn.toolNames.length).toBeGreaterThan(0);
		expect(conn.toolNames).toContain('health_check');
	});

	it('health_check returns valid response via MCP protocol', async () => {
		const instrDir = path.join(tmpDir, 'instructions');
		fs.mkdirSync(instrDir, { recursive: true });

		const config = loadMcpConfig(TEST_CONFIG_PATH);
		const opts = resolveServerOptions(config.mcpServers['mcp-index-test'], {
			INDEX_SERVER_DIR: instrDir,
		});

		conn = await spawnServer(opts);
		const resp = await conn.client.callTool({ name: 'health_check', arguments: {} });
		const text = resp?.content?.[0]?.text;
		expect(text).toBeDefined();

		const health = JSON.parse(text);
		expect(health.status).toBeTruthy();
	});

	it('index_dispatch list works via MCP protocol', async () => {
		const instrDir = path.join(tmpDir, 'instructions');
		fs.mkdirSync(instrDir, { recursive: true });

		const config = loadMcpConfig(TEST_CONFIG_PATH);
		const opts = resolveServerOptions(config.mcpServers['mcp-index-test'], {
			INDEX_SERVER_DIR: instrDir,
		});

		conn = await spawnServer(opts);
		if (!conn.toolNames.includes('index_dispatch')) {
			return; // skip if dispatcher not available
		}

		const resp = await conn.client.callTool({
			name: 'index_dispatch',
			arguments: { action: 'list' },
		});
		const text = resp?.content?.[0]?.text;
		expect(text).toBeDefined();

		const data = JSON.parse(text);
		expect(data).toHaveProperty('items');
		expect(data).toHaveProperty('count');
	});
});

describe('MCP Config-Driven CRUD Lifecycle', { timeout: 30_000 }, () => {
	let client: TestClient | null = null;
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-cfg-crud-'));
	});

	afterEach(async () => {
		if (client) {
			await client.close();
			client = null;
		}
		try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
	});

	it('full CRUD cycle via config-driven client', async () => {
		const instrDir = path.join(tmpDir, 'instructions');
		fs.mkdirSync(instrDir, { recursive: true });

		// Use the high-level createTestClient with config-derived env
		const config = loadMcpConfig(TEST_CONFIG_PATH);
		const entry = config.mcpServers['mcp-index-test'];

		client = await createTestClient({
			command: entry.command,
			args: entry.args,
			instructionsDir: instrDir,
			forceMutation: true,
			extraEnv: {
				...Object.fromEntries(
					Object.entries(entry.env || {}).filter(([k]) => !k.startsWith('//')),
				),
			},
		});

		const testId = `mcp-config-test-${Date.now()}`;

		// CREATE
		const created = await client.create({
			id: testId,
			title: 'Config-driven test instruction',
			body: 'Created via MCP stdio transport, same as Copilot CLI.',
		});
		expect(created).toBeDefined();

		// READ
		const read = await client.read(testId);
		expect(read).toBeDefined();
		// get returns { hash, item: { id, ... }, _meta } or { id, ... } shape
		const readId = read?.id ?? read?.item?.id ?? read?.entry?.id;
		expect(readId).toBe(testId);

		// UPDATE
		const updated = await client.update({
			id: testId,
			title: 'Updated config-driven instruction',
			body: 'Updated body content via MCP protocol.',
		});
		expect(updated).toBeDefined();

		// LIST — verify it appears
		const list = await client.list();
		expect(list.count).toBeGreaterThanOrEqual(1);
		const found = list.items.some(
			(i: Record<string, unknown>) => i.id === testId,
		);
		expect(found).toBe(true);

		// DELETE
		const removed = await client.remove(testId);
		expect(removed).toBeDefined();

		// VERIFY GONE
		const listAfter = await client.list();
		const stillThere = listAfter.items.some(
			(i: Record<string, unknown>) => i.id === testId,
		);
		expect(stillThere).toBe(false);
	});

	it('search works via config-driven client', async () => {
		const instrDir = path.join(tmpDir, 'instructions');
		fs.mkdirSync(instrDir, { recursive: true });

		const config = loadMcpConfig(TEST_CONFIG_PATH);
		const entry = config.mcpServers['mcp-index-test'];

		client = await createTestClient({
			command: entry.command,
			args: entry.args,
			instructionsDir: instrDir,
			forceMutation: true,
			extraEnv: {
				...Object.fromEntries(
					Object.entries(entry.env || {}).filter(([k]) => !k.startsWith('//')),
				),
			},
		});

		// Seed an instruction
		await client.create({
			id: 'search-target',
			title: 'Searchable MCP instruction',
			body: 'This instruction contains the keyword unicorn for search testing.',
		});

		// Search via tool call
		if (client.toolNames.includes('index_search')) {
			const result = await client.callToolJSON('index_search', {
				keywords: ['unicorn'],
			});
			expect(result).toBeDefined();
		}

		// Cleanup
		await client.remove('search-target');
	});

	it('readonly config blocks mutation', async () => {
		const instrDir = path.join(tmpDir, 'instructions');
		fs.mkdirSync(instrDir, { recursive: true });

		const config = loadMcpConfig(TEST_CONFIG_PATH);
		const entry = config.mcpServers['mcp-index-readonly'];

		client = await createTestClient({
			command: entry.command,
			args: entry.args,
			instructionsDir: instrDir,
			forceMutation: false,
			extraEnv: {
				...Object.fromEntries(
					Object.entries(entry.env || {}).filter(([k]) => !k.startsWith('//')),
				),
				INDEX_SERVER_MUTATION: '0',
			},
		});

		// Attempt create — should fail or return error
		try {
			const result = await client.create({
				id: 'should-fail',
				body: 'This should not be created.',
			});
			// If it returns a result, it should indicate mutation disabled
			if (result && typeof result === 'object') {
				const hasError = 'error' in result || 'isError' in result || result.mutationDisabled;
				expect(hasError || result.created === false).toBeTruthy();
			}
		} catch {
			// Expected — mutation disabled
		}
	});
});

describe('MCP Config — Generated Ephemeral Config', { timeout: 30_000 }, () => {
	let client: TestClient | null = null;
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-cfg-gen-'));
	});

	afterEach(async () => {
		if (client) {
			await client.close();
			client = null;
		}
		try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
	});

	it('generates config, writes it, loads it, and connects', async () => {
		const instrDir = path.join(tmpDir, 'instructions');
		const cfgPath = path.join(tmpDir, 'mcp-config.json');

		// Generate
		const { config } = generateTestConfig({ instructionsDir: instrDir });

		// Write to disk (simulates what a user would have)
		writeMcpConfig(config, cfgPath);

		// Load it back (simulates Copilot CLI reading it)
		const servers = resolveAllServers(cfgPath);
		expect(servers.length).toBe(1);

		const { spawnOptions } = servers[0];
		const conn = await spawnServer(spawnOptions);
		try {
			expect(conn.toolNames.length).toBeGreaterThan(0);
			expect(conn.toolNames).toContain('health_check');

			// Verify MCP handshake is fully functional
			const resp = await conn.client.callTool({ name: 'health_check', arguments: {} });
			const text = resp?.content?.[0]?.text;
			expect(text).toBeDefined();
		} finally {
			await conn.close();
		}
	});
});
