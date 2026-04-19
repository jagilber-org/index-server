#!/usr/bin/env node

/**
 * Pure MCP Protocol Query Script
 * Activates production Index Server and queries instruction count using only MCP protocol
 */

const { spawn } = require('child_process');
const { EventEmitter } = require('events');

class MCPClient extends EventEmitter {
  constructor() {
    super();
    this.server = null;
    this.requestId = 1;
    this.pendingRequests = new Map();
  }

  async start() {
    return new Promise((resolve, reject) => {
      // Spawn production server with exact config from mcp.json
      this.server = spawn('node', ['dist/server/index-server.js', '--dashboard', '--dashboard-port', '2000'], {
        cwd: 'C:/mcp/index-server',
        env: {
          ...process.env,
          FEEDBACK_DIR: 'C:/mcp/index-server/feedback',
          INDEX_SERVER_ALWAYS_RELOAD: '1',
          INDEX_SERVER_DIR: 'C:/mcp/index-server/instructions',
          INDEX_SERVER_FILE_TRACE: '1',
          INDEX_SERVER_DEBUG: '1',
          INDEX_SERVER_MUTATION: '1',
          INDEX_SERVER_LOG_FILE: '1',
          INDEX_SERVER_MEMORY_MONITOR: '1',
          INDEX_SERVER_METRICS_FILE_STORAGE: '1',
          INDEX_SERVER_METRICS_MAX_FILES: '720',
          INDEX_SERVER_TRACE_FILE: '1',
          INDEX_SERVER_VISIBILITY_DIAG: '1'
        },
        stdio: ['pipe', 'pipe', 'inherit']
      });

      this.server.on('error', reject);

      let buffer = '';
      this.server.stdout.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.trim()) {
            try {
              const message = JSON.parse(line);
              this.handleMessage(message);
            } catch {
              // Ignore non-JSON output (startup logs, etc.)
            }
          }
        }
      });

      // Wait for server to be ready (look for initialization completion)
      setTimeout(() => {
        console.log('Server started, beginning MCP handshake...');
        resolve();
      }, 2000);
    });
  }

  handleMessage(message) {
    if (message.id && this.pendingRequests.has(message.id)) {
      const { resolve, reject } = this.pendingRequests.get(message.id);
      this.pendingRequests.delete(message.id);

      if (message.error) {
        reject(new Error(`MCP Error: ${message.error.message || JSON.stringify(message.error)}`));
      } else {
        resolve(message.result);
      }
    }
  }

  async sendRequest(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.requestId++;
      const request = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      this.pendingRequests.set(id, { resolve, reject });

      // Set timeout for request
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 10000);

      this.server.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  async initialize() {
    console.log('Sending MCP initialize request...');
    const result = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {}
      },
      clientInfo: {
        name: 'mcp-prod-query',
        version: '1.0.0'
      }
    });
    console.log('Initialize result:', JSON.stringify(result, null, 2));

    // Send initialized notification
    this.server.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    }) + '\n');

    return result;
  }

  async listInstructions() {
    console.log('Sending instructions/dispatch request with action=list...');
    const result = await this.sendRequest('tools/call', {
      name: 'instructions/dispatch',
      arguments: {
        action: 'list'
      }
    });
    return result;
  }

  async listScopedInstructions() {
    console.log('Sending instructions/dispatch request with action=listScoped...');
    const result = await this.sendRequest('tools/call', {
      name: 'instructions/dispatch',
      arguments: {
        action: 'listScoped'
      }
    });
    return result;
  }

  async getCategories() {
    console.log('Sending instructions/dispatch request with action=categories...');
    const result = await this.sendRequest('tools/call', {
      name: 'instructions/dispatch',
      arguments: {
        action: 'categories'
      }
    });
    return result;
  }

  async getDirInfo() {
    console.log('Sending instructions/dispatch request with action=dir...');
    const result = await this.sendRequest('tools/call', {
      name: 'instructions/dispatch',
      arguments: {
        action: 'dir'
      }
    });
    return result;
  }

  async close() {
    if (this.server) {
      this.server.kill();
    }
  }
}

async function main() {
  const client = new MCPClient();

  try {
    console.log('🚀 Starting production MCP server query...');
    console.log('Production directory: C:/mcp/index-server/instructions');
    console.log('Using ONLY MCP protocol');
    console.log('=' .repeat(60));

    await client.start();
    await client.initialize();

    console.log('\n📊 Querying instruction data via MCP...');

    // Get full list
    const listResult = await client.listInstructions();
    console.log('\n📋 Full instruction list (action=list):');
    console.log(`Count: ${listResult.content?.[0]?.text ? JSON.parse(listResult.content[0].text).count : 'N/A'}`);

    // Get scoped list
    const scopedResult = await client.listScopedInstructions();
    console.log('\n🎯 Scoped instruction list (action=listScoped):');
    const scopedData = scopedResult.content?.[0]?.text ? JSON.parse(scopedResult.content[0].text) : {};
    console.log(`Count: ${scopedData.count || 'N/A'}`);
    console.log(`Scope: ${scopedData.scope || 'N/A'}`);

    // Get categories
    const categoriesResult = await client.getCategories();
    console.log('\n📂 Categories (action=categories):');
    const categoriesData = categoriesResult.content?.[0]?.text ? JSON.parse(categoriesResult.content[0].text) : {};
    console.log(`Count: ${categoriesData.count || 'N/A'}`);

    // Get directory info
    const dirResult = await client.getDirInfo();
    console.log('\n📁 Directory info (action=dir):');
    const dirData = dirResult.content?.[0]?.text ? JSON.parse(dirResult.content[0].text) : {};
    console.log(`Files count: ${dirData.filesCount || 'N/A'}`);
    console.log(`Directory: ${dirData.dir || 'N/A'}`);

    console.log('\n' + '=' .repeat(60));
    console.log('✅ MCP query complete');

    // Parse and display summary
    const fullCount = listResult.content?.[0]?.text ? JSON.parse(listResult.content[0].text).count : 0;
    const scopedCount = scopedData.count || 0;
    const categoriesCount = categoriesData.count || 0;
    const filesCount = dirData.filesCount || 0;

    console.log('\n📈 SUMMARY:');
    console.log(`Full Index instructions: ${fullCount}`);
    console.log(`Scoped instructions (${scopedData.scope || 'unknown'}): ${scopedCount}`);
    console.log(`Categories: ${categoriesCount}`);
    console.log(`Raw .json files on disk: ${filesCount}`);

    if (fullCount !== scopedCount) {
      console.log(`\n⚠️  DISCREPANCY DETECTED: Full (${fullCount}) vs Scoped (${scopedCount})`);
      console.log(`   → Difference of ${fullCount - scopedCount} instructions`);
      console.log(`   → This suggests client may be using 'listScoped' instead of 'list'`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Shutting down...');
  process.exit(0);
});

main().catch(console.error);
