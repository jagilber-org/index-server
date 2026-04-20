/**
 * Index Server - Thin Client Entry Point
 *
 * **EXPERIMENTAL** — APIs, configuration, and behavior may change.
 *
 * Lightweight stdio-to-HTTP bridge for MCP hosts.
 * Instead of loading the full index and handler registry, this process
 * reads JSON-RPC frames from stdin and forwards them to the leader server
 * over HTTP.
 *
 * Usage:
 *   node dist/server/thin-client.js
 *
 * Environment:
 *   INDEX_SERVER_STATE_DIR    - State directory to discover leader (default: ./data/state)
 *   INDEX_SERVER_LEADER_URL   - Explicit leader URL (e.g., http://127.0.0.1:9090/mcp)
 *
 * The thin client auto-discovers the leader from the lock file in INDEX_SERVER_STATE_DIR,
 * or connects to INDEX_SERVER_LEADER_URL if provided. On leader failover, it re-discovers
 * and reconnects automatically.
 */

import path from 'path';
import { ThinClient } from '../dashboard/server/ThinClient.js';

const stateDir = process.env.INDEX_SERVER_STATE_DIR || path.join(process.cwd(), 'data', 'state');
const leaderUrl = process.env.INDEX_SERVER_LEADER_URL || undefined;

const client = new ThinClient({
  leaderUrl,
  stateDir,
  maxRetries: 5,
  retryDelayMs: 500,
});

process.stderr.write(`[thin-client] Starting stdio bridge (pid=${process.pid})\n`);
process.stderr.write(`[thin-client] State dir: ${stateDir}\n`);
if (leaderUrl) {
  process.stderr.write(`[thin-client] Explicit leader URL: ${leaderUrl}\n`);
} else {
  const discovered = client.discoverLeader();
  process.stderr.write(`[thin-client] Discovered leader: ${discovered || '(none yet — will retry on first request)'}\n`);
}

// Read JSON-RPC frames from stdin (Content-Length delimited or newline-delimited)
let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;

  // Try Content-Length framing first (standard MCP protocol)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const headerMatch = buffer.match(/^Content-Length:\s*(\d+)\r?\n\r?\n/);
    if (headerMatch) {
      const contentLength = parseInt(headerMatch[1], 10);
      const headerEnd = headerMatch[0].length;
      if (buffer.length >= headerEnd + contentLength) {
        const frame = buffer.slice(headerEnd, headerEnd + contentLength);
        buffer = buffer.slice(headerEnd + contentLength);
        handleFrame(frame);
        continue;
      }
      break; // Wait for more data
    }

    // Fallback: newline-delimited JSON
    const newlineIdx = buffer.indexOf('\n');
    if (newlineIdx >= 0) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (line.length > 0 && line.startsWith('{')) {
        handleFrame(line);
      }
      continue;
    }

    break; // Wait for more data
  }
});

async function handleFrame(frame: string): Promise<void> {
  try {
    const response = await client.processFrame(frame);
    const responseBytes = Buffer.from(response, 'utf8');
    process.stdout.write(`Content-Length: ${responseBytes.length}\r\n\r\n`);
    process.stdout.write(responseBytes);
  } catch (err) {
    const errorResponse = JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32603, message: err instanceof Error ? err.message : 'Internal error' },
      id: null,
    });
    const errorBytes = Buffer.from(errorResponse, 'utf8');
    process.stdout.write(`Content-Length: ${errorBytes.length}\r\n\r\n`);
    process.stdout.write(errorBytes);
  }
}

process.stdin.on('end', () => {
  process.stderr.write('[thin-client] stdin closed, shutting down\n');
  client.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  process.stderr.write('[thin-client] SIGINT received, shutting down\n');
  client.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  process.stderr.write('[thin-client] SIGTERM received, shutting down\n');
  client.stop();
  process.exit(0);
});
