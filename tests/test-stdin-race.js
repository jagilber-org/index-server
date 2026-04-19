/**
 * Test script to simulate PowerShell MCP client behavior:
 * - Launches server process
 * - Immediately sends Content-Length framed initialize request
 * - No artificial delay (unlike Python client)
 * - Validates response timing and buffering behavior
 */
const { spawn } = require('child_process');
const path = require('path');

const serverPath = path.join(__dirname, 'dist', 'server', 'index-server.js');

console.log('[test-client] Starting server:', serverPath);
console.log('[test-client] Environment: INDEX_SERVER_LOG_DIAG=1 (enable diagnostics)');

const proc = spawn('node', [serverPath], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    INDEX_SERVER_LOG_DIAG: '1',  // Enable our new diagnostics
    INDEX_SERVER_DISABLE_EARLY_STDIN_BUFFER: '0',  // Ensure buffering is enabled
  }
});

let stdoutBuffer = '';
let stderrBuffer = '';
const startTime = Date.now();

proc.stdout.on('data', (chunk) => {
  const elapsed = Date.now() - startTime;
  stdoutBuffer += chunk.toString();
  console.log(`[test-client] [+${elapsed}ms] STDOUT:`, chunk.toString().replace(/\n/g, '\\n').slice(0, 200));

  // Check for initialize response
  if (stdoutBuffer.includes('"result"') && stdoutBuffer.includes('protocolVersion')) {
    console.log('[test-client] ✅ Initialize response received!');
    console.log('[test-client] Response time:', elapsed, 'ms');

    // Send tools/list
    const toolsListReq = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {}
    };
    const json = JSON.stringify(toolsListReq);
    const frame = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}\r\n`;
    proc.stdin.write(frame);
    console.log(`[test-client] [+${Date.now() - startTime}ms] Sent tools/list request`);
  }

  // Check for tools/list response
  if (stdoutBuffer.includes('"id":2') && stdoutBuffer.includes('tools')) {
    console.log('[test-client] ✅ Tools list received!');

    // Extract tool count
    try {
      const lines = stdoutBuffer.split('\n');
      for (const line of lines) {
        if (line.includes('"id":2')) {
          const obj = JSON.parse(line.trim());
          if (obj.result && obj.result.tools) {
            console.log('[test-client] Tool count:', obj.result.tools.length);
          }
        }
      }
    } catch {
      // Content-Length framing - try to parse
      const match = stdoutBuffer.match(/{"jsonrpc":"2.0","id":2[^}]+}/);
      if (match) {
        try {
          const obj = JSON.parse(match[0]);
          if (obj.result && obj.result.tools) {
            console.log('[test-client] Tool count:', obj.result.tools.length);
          }
        } catch { /* nested parse failure */ }
      }
    }

    // Success - terminate
    setTimeout(() => {
      console.log('[test-client] ✅ TEST PASSED - Connection successful');
      proc.kill();
      process.exit(0);
    }, 100);
  }
});

proc.stderr.on('data', (chunk) => {
  const elapsed = Date.now() - startTime;
  const lines = chunk.toString().split('\n').filter(l => l.trim());
  lines.forEach(line => {
    stderrBuffer += line + '\n';
    if (line.includes('[handshake-buffer]') || line.includes('[transport-init]') || line.includes('[startup]')) {
      console.log(`[test-client] [+${elapsed}ms] STDERR:`, line);
    }
  });
});

proc.on('exit', (code) => {
  const elapsed = Date.now() - startTime;
  console.log(`[test-client] Process exited with code ${code} after ${elapsed}ms`);

  if (!stdoutBuffer.includes('"result"')) {
    console.error('[test-client] ❌ TEST FAILED - No initialize response received');
    console.error('[test-client] Diagnostics:');
    console.error(stderrBuffer);
    process.exit(1);
  }
});

// Send initialize immediately (no delay - simulates PowerShell behavior)
console.log('[test-client] [+0ms] Sending initialize request immediately...');
const initReq = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: {
      name: 'test-powershell-style-client',
      version: '1.0.0'
    }
  }
};

const json = JSON.stringify(initReq);
const frame = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}\r\n`;

// Send IMMEDIATELY after spawn (race condition scenario)
setImmediate(() => {
  const elapsed = Date.now() - startTime;
  console.log(`[test-client] [+${elapsed}ms] Writing initialize frame (${Buffer.byteLength(frame)} bytes)`);
  proc.stdin.write(frame);
});

// Timeout failsafe
setTimeout(() => {
  if (!stdoutBuffer.includes('"result"')) {
    console.error('[test-client] ❌ TIMEOUT - No response after 5 seconds');
    console.error('[test-client] STDOUT buffer:', stdoutBuffer);
    console.error('[test-client] STDERR (diagnostics):');
    console.error(stderrBuffer);
    proc.kill();
    process.exit(1);
  }
}, 5000);
