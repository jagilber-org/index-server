// Performance baseline measurement script for Phase 1 usage tracking
// Measures mutation and list operation timing to establish <5% overhead target

import { spawn } from 'child_process';
import { performance } from 'perf_hooks';
import fs from 'fs';
import path from 'path';

interface PerformanceResults {
  listOperations: {
    withoutUsage: number[];
    withUsage: number[];
    overhead: number;
  };
  mutationOperations: {
    withoutUsage: number[];
    withUsage: number[];
    overhead: number;
  };
  summary: {
    listOverheadPercent: number;
    mutationOverheadPercent: number;
    meetsTarget: boolean;
  };
}

function startServer(enableUsage: boolean): Promise<{ server: ReturnType<typeof spawn>; output: string[] }> {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      INDEX_SERVER_MUTATION: '1',
      INDEX_SERVER_FEATURES: enableUsage ? 'usage' : '',
      INDEX_SERVER_VERBOSE_LOGGING: ''
    };

    const server = spawn('node', ['dist/server/index-server.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env
    });

    const output: string[] = [];
    server.stdout?.on('data', d => {
      output.push(...d.toString().trim().split(/\n+/).filter((l: string) => l));
    });

    // Wait for server to be ready
    setTimeout(() => resolve({ server, output }), 200);
  });
}

function send(server: ReturnType<typeof spawn>, msg: Record<string, unknown>): void {
  server.stdin?.write(JSON.stringify(msg) + '\n');
}

function waitFor(output: string[], predicate: (line: string) => boolean, timeout = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const line = output.find(predicate);
      if (line) {
        resolve(line);
      } else if (Date.now() - start > timeout) {
        reject(new Error('Timeout waiting for response'));
      } else {
        setTimeout(check, 10);
      }
    };
    check();
  });
}

async function measureListOperations(enableUsage: boolean, iterations = 50): Promise<number[]> {
  const { server, output } = await startServer(enableUsage);
  const timings: number[] = [];

  try {
    // Initialize
    send(server, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        clientInfo: { name: 'perf-baseline', version: '0' },
        capabilities: { tools: {} }
      }
    });
    await waitFor(output, line => line.includes('"id":1'));

    // Measure list operations
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
  // Use unified dispatcher (legacy instructions/list removed)
  send(server, { jsonrpc: '2.0', id: 100 + i, method: 'index_dispatch', params: { action: 'list' } });
      await waitFor(output, line => line.includes(`"id":${100 + i}`));
      const end = performance.now();
      timings.push(end - start);
    }

    server.kill();
    return timings;
  } catch (error) {
    server.kill();
    throw error;
  }
}

async function measureMutationOperations(enableUsage: boolean, iterations = 20): Promise<number[]> {
  const { server, output } = await startServer(enableUsage);
  const timings: number[] = [];

  try {
    // Initialize
    send(server, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        clientInfo: { name: 'perf-baseline', version: '0' },
        capabilities: { tools: {} }
      }
    });
    await waitFor(output, line => line.includes('"id":1'));

    // Measure add operations (mutations)
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const entry = {
        id: `perf-test-${i}`,
        title: `Performance Test ${i}`,
        body: 'Performance test entry for baseline measurement',
        priority: 10,
        audience: 'all',
        requirement: 'optional',
        categories: ['performance']
      };

      send(server, {
        jsonrpc: '2.0',
        id: 200 + i,
        method: 'index_add',
        params: { entry, overwrite: true }
      });
      await waitFor(output, line => line.includes(`"id":${200 + i}`));
      const end = performance.now();
      timings.push(end - start);
    }

    server.kill();
    return timings;
  } catch (error) {
    server.kill();
    throw error;
  }
}

function calculateStats(timings: number[]): { mean: number; p95: number; p99: number } {
  const sorted = [...timings].sort((a, b) => a - b);
  const mean = timings.reduce((sum, t) => sum + t, 0) / timings.length;
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  return { mean, p95, p99 };
}

function calculateOverhead(withoutUsage: number[], withUsage: number[]): number {
  const baselineP95 = calculateStats(withoutUsage).p95;
  const usageP95 = calculateStats(withUsage).p95;
  return ((usageP95 - baselineP95) / baselineP95) * 100;
}

export async function runPerformanceBaseline(): Promise<PerformanceResults> {
  console.log('🚀 Starting Phase 1 Performance Baseline Measurement...');
  console.log('Target: <5% overhead for usage tracking');
  console.log();

  // List operations
  console.log('📊 Measuring list operations...');
  const listWithoutUsage = await measureListOperations(false);
  const listWithUsage = await measureListOperations(true);
  const listOverhead = calculateOverhead(listWithoutUsage, listWithUsage);

  console.log('✅ List operations measured');
  console.log(`   Without usage: ${calculateStats(listWithoutUsage).p95.toFixed(2)}ms P95`);
  console.log(`   With usage: ${calculateStats(listWithUsage).p95.toFixed(2)}ms P95`);
  console.log(`   Overhead: ${listOverhead.toFixed(2)}%`);
  console.log();

  // Mutation operations
  console.log('📊 Measuring mutation operations...');
  const mutationWithoutUsage = await measureMutationOperations(false);
  const mutationWithUsage = await measureMutationOperations(true);
  const mutationOverhead = calculateOverhead(mutationWithoutUsage, mutationWithUsage);

  console.log('✅ Mutation operations measured');
  console.log(`   Without usage: ${calculateStats(mutationWithoutUsage).p95.toFixed(2)}ms P95`);
  console.log(`   With usage: ${calculateStats(mutationWithUsage).p95.toFixed(2)}ms P95`);
  console.log(`   Overhead: ${mutationOverhead.toFixed(2)}%`);
  console.log();

  // Summary
  const maxOverhead = Math.max(listOverhead, mutationOverhead);
  const meetsTarget = maxOverhead <= 5.0;

  console.log('📈 Performance Baseline Summary:');
  console.log(`   List operations overhead: ${listOverhead.toFixed(2)}%`);
  console.log(`   Mutation operations overhead: ${mutationOverhead.toFixed(2)}%`);
  console.log(`   Maximum overhead: ${maxOverhead.toFixed(2)}%`);
  console.log(`   Target met (<5%): ${meetsTarget ? '✅ YES' : '❌ NO'}`);

  const results = {
    listOperations: {
      withoutUsage: listWithoutUsage,
      withUsage: listWithUsage,
      overhead: listOverhead
    },
    mutationOperations: {
      withoutUsage: mutationWithoutUsage,
      withUsage: mutationWithUsage,
      overhead: mutationOverhead
    },
    summary: {
      listOverheadPercent: listOverhead,
      mutationOverheadPercent: mutationOverhead,
      meetsTarget
    }
  };

  // Save results
  const timestamp = new Date().toISOString();
  const baselineFile = `data/performance-baseline-${timestamp.slice(0, 10)}.json`;

  const dataDir = path.dirname(baselineFile);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  fs.writeFileSync(baselineFile, JSON.stringify({
    timestamp,
    phase: 'Phase 1 Usage Tracking',
    target: '<5% overhead',
    results
  }, null, 2));

  console.log();
  console.log(`💾 Detailed results saved to: ${baselineFile}`);

  return results;
}
