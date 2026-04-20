/**
 * ThinClient - Stdio-to-HTTP bridge for MCP clients.
 *
 * **EXPERIMENTAL** — APIs, configuration, and behavior may change.
 *
 * A lightweight process that MCP hosts (VS Code, Claude) spawn via stdio.
 * Instead of loading the full index, it forwards JSON-RPC frames to
 * the leader server's HTTP endpoint.
 *
 * Flow:  MCP Host --stdio--> ThinClient --HTTP--> Leader Server
 *
 * Features:
 * - Reads JSON-RPC frames from stdin, POSTs to leader
 * - Writes responses to stdout
 * - Auto-discovers leader from instance state files
 * - Reconnects on leader failover
 */

import fs from 'fs';
import path from 'path';
import http from 'http';

export interface ThinClientOptions {
  /** URL of the leader's MCP transport (e.g., http://127.0.0.1:9090/mcp) */
  leaderUrl?: string;
  /** State directory to discover leader from port files */
  stateDir?: string;
  /** Retry settings */
  maxRetries?: number;
  retryDelayMs?: number;
  /** Health check interval (ms) */
  healthCheckMs?: number;
}

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_RETRY_DELAY = 500;
const LOCK_FILE = 'leader.lock';

export class ThinClient {
  private leaderUrl: string | null;
  private readonly stateDir: string | null;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private _connected = false;
  private _stopped = false;
  private healthTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: ThinClientOptions = {}) {
    this.leaderUrl = options.leaderUrl ?? null;
    this.stateDir = options.stateDir ?? null;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY;
  }

  get connected(): boolean { return this._connected; }

  /**
   * Discover the leader URL from the state directory.
   */
  discoverLeader(): string | null {
    if (!this.stateDir) return null;
    const lockPath = path.join(this.stateDir, LOCK_FILE);

    try {
      if (!fs.existsSync(lockPath)) return null;
      const raw = fs.readFileSync(lockPath, 'utf8');
      const entry = JSON.parse(raw);
      if (entry.host && entry.port) {
        return `http://${entry.host}:${entry.port}/mcp`;
      }
    } catch {
      // Can't read lock file
    }
    return null;
  }

  /**
   * Resolve the leader URL (explicit or discovered).
   * Re-discovers if the cached URL might be stale (leader changed port/host).
   */
  resolveLeaderUrl(): string | null {
    if (this.leaderUrl && this.stateDir) {
      // Validate cached URL still matches current leader.lock
      const freshUrl = this.discoverLeader();
      if (freshUrl && freshUrl !== this.leaderUrl) {
        this.leaderUrl = freshUrl;
        this._connected = false;
      }
    } else if (!this.leaderUrl) {
      const discovered = this.discoverLeader();
      if (discovered) {
        this.leaderUrl = discovered;
      }
    }
    return this.leaderUrl;
  }

  /**
   * Send a JSON-RPC request to the leader and return the response.
   */
  async sendRpc(method: string, params: unknown = {}, id: number | string = 1): Promise<unknown> {
    const url = this.resolveLeaderUrl();
    if (!url) {
      throw new Error('No leader URL available');
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await this.httpPost(`${url}/rpc`, {
          jsonrpc: '2.0',
          method,
          params,
          id,
        });

        this._connected = true;
        return response;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this._connected = false;

        // On failure, try re-discovering leader (may have failed over)
        if (this.stateDir && attempt < this.maxRetries - 1) {
          this.leaderUrl = null; // Force re-discovery
          await this.sleep(this.retryDelayMs * Math.pow(2, attempt));
        }
      }
    }

    throw lastError ?? new Error('Failed to connect to leader');
  }

  /**
   * Check if the leader is healthy.
   */
  async checkHealth(): Promise<boolean> {
    const url = this.resolveLeaderUrl();
    if (!url) return false;

    try {
      const response = await this.httpGet(`${url}/health`);
      return response?.status === 'ok';
    } catch {
      return false;
    }
  }

  /**
   * Process a raw JSON-RPC frame (as received from stdin).
   */
  async processFrame(frame: string): Promise<string> {
    let parsed: { jsonrpc: string; method: string; params?: unknown; id?: unknown };
    try {
      parsed = JSON.parse(frame);
    } catch {
      return JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32700, message: 'Parse error' },
        id: null,
      });
    }

    try {
      const result = await this.sendRpc(parsed.method, parsed.params, parsed.id as number);
      return JSON.stringify(result);
    } catch (err) {
      return JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32603, message: err instanceof Error ? err.message : 'Internal error' },
        id: parsed.id ?? null,
      });
    }
  }

  stop(): void {
    this._stopped = true;
    this._connected = false;
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  private async httpPost(url: string, body: unknown): Promise<unknown> {
    const bodyStr = JSON.stringify(body);

    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const req = http.request({
        hostname: urlObj.hostname,
        port: parseInt(urlObj.port),
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
        timeout: 10000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Invalid JSON response: ${data.slice(0, 100)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.write(bodyStr);
      req.end();
    });
  }

  private async httpGet(url: string): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const req = http.request({
        hostname: urlObj.hostname,
        port: parseInt(urlObj.port),
        path: urlObj.pathname,
        method: 'GET',
        timeout: 5000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Invalid JSON response`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.end();
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
