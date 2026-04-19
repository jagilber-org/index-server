/**
 * Test to verify tool response ordering
 * Repro for: "server sends notifications/tools/list_changed after tools/call but never sends the actual response"
 */

const { spawn } = require('child_process');
const path = require('path');

// Helper to build Content-Length frames
function buildFrame(obj) {
  const body = JSON.stringify(obj);
  const bytes = Buffer.byteLength(body, 'utf8');
  return `Content-Length: ${bytes}\r\n\r\n${body}`;
}

async function runTest() {
  const serverPath = path.join(__dirname, 'dist', 'server', 'index-server.js');
  const proc = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const frames = [];
  let buffer = '';

  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');

    // Parse Content-Length frames
    while (true) {
      const match = buffer.match(/Content-Length:\s*(\d+)\r\n\r\n/);
      if (!match) break;

      const headerEnd = match.index + match[0].length;
      const bodyLength = parseInt(match[1], 10);

      if (buffer.length < headerEnd + bodyLength) break; // incomplete frame

      const body = buffer.slice(headerEnd, headerEnd + bodyLength);
      buffer = buffer.slice(headerEnd + bodyLength);

      try {
        const frame = JSON.parse(body);
        frames.push(frame);
        console.log(`[FRAME ${frames.length}]`, JSON.stringify(frame).slice(0, 150));
      } catch (e) {
        console.error('[PARSE ERROR]', e.message, body.slice(0, 100));
      }
    }
  });

  proc.stderr.on('data', () => {
    // Suppress stderr unless debugging
    // process.stderr.write(chunk);
  });

  // Send initialize
  console.log('\n=== Sending initialize ===');
  proc.stdin.write(buildFrame({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: { listChanged: true } },
      clientInfo: { name: 'test-client', version: '1.0.0' }
    }
  }));

  // Wait for initialize response + server/ready + tools/list_changed
  await new Promise(resolve => setTimeout(resolve, 200));

  console.log('\n=== Sending tools/call for health/check ===');
  proc.stdin.write(buildFrame({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'health/check',
      arguments: {}
    }
  }));

  // Wait for response
  await new Promise(resolve => setTimeout(resolve, 200));

  console.log('\n=== Sending tools/call for instructions/dispatch list ===');
  proc.stdin.write(buildFrame({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'instructions/dispatch',
      arguments: { action: 'list' }
    }
  }));

  // Wait for response
  await new Promise(resolve => setTimeout(resolve, 300));

  proc.kill();

  // Analyze frames
  console.log('\n=== ANALYSIS ===');
  console.log(`Total frames received: ${frames.length}`);

  // Find initialize response
  const initResp = frames.find(f => f.id === 1 && f.result);
  console.log(`Initialize response: ${initResp ? 'FOUND' : 'MISSING'}`);

  // Find server/ready
  const serverReady = frames.find(f => f.method === 'server/ready');
  console.log(`server/ready notification: ${serverReady ? 'FOUND' : 'MISSING'}`);

  // Find tools/list_changed
  const toolsChanged = frames.filter(f => f.method === 'notifications/tools/list_changed');
  console.log(`tools/list_changed notifications: ${toolsChanged.length}`);

  // Find tools/call responses
  const healthResp = frames.find(f => f.id === 2 && (f.result || f.error));
  console.log(`tools/call health/check response (id=2): ${healthResp ? 'FOUND' : 'MISSING'}`);
  if (!healthResp) {
    console.log('  BUG DETECTED: No response for id=2');
  }

  const dispatchResp = frames.find(f => f.id === 3 && (f.result || f.error));
  console.log(`tools/call instructions/dispatch response (id=3): ${dispatchResp ? 'FOUND' : 'MISSING'}`);
  if (!dispatchResp) {
    console.log('  BUG DETECTED: No response for id=3');
  }

  // Check for spurious tools/list_changed AFTER tools/call requests
  const healthCallIdx = frames.findIndex(f => f.id === 2 && (f.result || f.error));
  const changedAfterHealth = frames.slice(healthCallIdx + 1).filter(f => f.method === 'notifications/tools/list_changed');
  if (changedAfterHealth.length > 0) {
    console.log(`\nWARNING: ${changedAfterHealth.length} tools/list_changed notifications AFTER health response`);
  }

  // Detailed frame listing
  console.log('\n=== ALL FRAMES ===');
  frames.forEach((f, i) => {
    if (f.method) {
      console.log(`${i + 1}. NOTIFICATION: ${f.method}`);
    } else if (f.result) {
      console.log(`${i + 1}. RESPONSE id=${f.id} (success)`);
    } else if (f.error) {
      console.log(`${i + 1}. RESPONSE id=${f.id} (error: ${f.error.message})`);
    } else {
      console.log(`${i + 1}. UNKNOWN: ${JSON.stringify(f).slice(0, 80)}`);
    }
  });

  process.exit(healthResp && dispatchResp ? 0 : 1);
}

runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
