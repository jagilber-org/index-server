/**
 * MCP Config Loader — parses Copilot CLI mcp-config.json format
 * and produces SpawnServerOptions for the existing mcpTestClient.
 *
 * Format reference (all env values are quoted strings):
 * {
 *   "mcpServers": {
 *     "<name>": {
 *       "type": "stdio",
 *       "command": "node",
 *       "args": ["dist/server/index-server.js"],
 *       "cwd": "/path/to/server",
 *       "env": { "KEY": "value" },
 *       "tools": ["*"]
 *     }
 *   }
 * }
 */
import fs from 'fs';
import path from 'path';
import type { SpawnServerOptions } from './mcpTestClient.js';

// ---------------------------------------------------------------------------
// Types matching Copilot CLI mcp-config.json schema
// ---------------------------------------------------------------------------

export interface McpServerEntry {
	type?: string;
	command: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
	tools?: string[];
}

export interface McpConfig {
	mcpServers: Record<string, McpServerEntry>;
}

export interface ResolvedServer {
	name: string;
	entry: McpServerEntry;
	spawnOptions: SpawnServerOptions;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load and parse a Copilot CLI mcp-config.json file.
 * Strips JSON comment lines (// prefixed values) automatically.
 */
export function loadMcpConfig(configPath: string): McpConfig {
	const abs = path.resolve(configPath);
	if (!fs.existsSync(abs)) {
		throw new Error(`MCP config not found: ${abs}`);
	}
	const raw = fs.readFileSync(abs, 'utf8');
	const parsed = JSON.parse(raw) as unknown;

	if (!parsed || typeof parsed !== 'object') {
		throw new Error(`Invalid MCP config: expected JSON object`);
	}

	const obj = parsed as Record<string, unknown>;
	const servers = obj.mcpServers;
	if (!servers || typeof servers !== 'object') {
		throw new Error(`Invalid MCP config: missing "mcpServers" object`);
	}

	return { mcpServers: servers as Record<string, McpServerEntry> };
}

/**
 * Resolve a single server entry into SpawnServerOptions.
 * @param entry  Server config from mcp-config.json
 * @param envOverrides  Additional env vars merged last (test isolation)
 */
export function resolveServerOptions(
	entry: McpServerEntry,
	envOverrides?: Record<string, string>,
): SpawnServerOptions {
	// Filter out comment-style env keys (keys starting with "//" or "//")
	const cleanEnv: Record<string, string> = {};
	if (entry.env) {
		for (const [k, v] of Object.entries(entry.env)) {
			if (!k.startsWith('//')) {
				cleanEnv[k] = v;
			}
		}
	}

	// Merge overrides
	if (envOverrides) {
		Object.assign(cleanEnv, envOverrides);
	}

	return {
		command: entry.command,
		args: entry.args,
		env: cleanEnv,
		connectTimeoutMs: 10_000,
		readinessTimeoutMs: 8_000,
	};
}

/**
 * Load config and resolve all server entries.
 * @param configPath  Path to mcp-config.json
 * @param filter      Optional server name filter (regex or exact match)
 * @param envOverrides  Additional env vars for all servers
 */
export function resolveAllServers(
	configPath: string,
	filter?: string | RegExp,
	envOverrides?: Record<string, string>,
): ResolvedServer[] {
	const config = loadMcpConfig(configPath);
	const results: ResolvedServer[] = [];

	for (const [name, entry] of Object.entries(config.mcpServers)) {
		if (filter) {
			const re = typeof filter === 'string' ? new RegExp(filter) : filter;
			if (!re.test(name)) continue;
		}

		// Skip non-stdio entries
		if (entry.type && entry.type !== 'stdio') continue;

		results.push({
			name,
			entry,
			spawnOptions: resolveServerOptions(entry, envOverrides),
		});
	}

	return results;
}

/**
 * Generate a test-ready mcp-config.json for an ephemeral test instance.
 * Returns the config object and path of the temp instructions dir.
 */
export function generateTestConfig(opts: {
	serverName?: string;
	instructionsDir: string;
	extraEnv?: Record<string, string>;
	cwd?: string;
}): { config: McpConfig; instructionsDir: string } {
	const {
		serverName = 'mcp-index-test',
		instructionsDir,
		extraEnv = {},
		cwd,
	} = opts;

	// Ensure instructions dir exists
	if (!fs.existsSync(instructionsDir)) {
		fs.mkdirSync(instructionsDir, { recursive: true });
	}

	const config: McpConfig = {
		mcpServers: {
			[serverName]: {
				type: 'stdio',
				command: 'node',
				args: ['dist/server/index-server.js'],
				cwd: cwd || process.cwd(),
				tools: ['*'],
				env: {
					INDEX_SERVER_MODE: 'standalone',
					INDEX_SERVER_MUTATION: '1',
					INDEX_SERVER_DASHBOARD: '0',
					INDEX_SERVER_AUTO_BACKUP: '0',
					INDEX_SERVER_DIR: instructionsDir,
					NODE_ENV: 'test',
					...extraEnv,
				},
			},
		},
	};

	return { config, instructionsDir };
}

/**
 * Write an MCP config to a file (for debugging or passing to external tools).
 */
export function writeMcpConfig(config: McpConfig, outPath: string): void {
	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	fs.writeFileSync(outPath, JSON.stringify(config, null, 2), 'utf8');
}
