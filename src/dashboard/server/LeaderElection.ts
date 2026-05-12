/**
 * LeaderElection - Manages leader/follower roles for multi-instance MCP servers.
 *
 * **EXPERIMENTAL** — APIs, configuration, and behavior may change.
 *
 * Uses a lock file + PID-based election strategy:
 * - Leader is the instance that successfully acquires the lock file
 * - On leader death, the surviving instance with the lowest PID promotes
 * - Heartbeat mechanism keeps leader.lock fresh (stale = dead leader)
 *
 * Lock file location: `<stateDir>/leader.lock`
 */

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import type { InstanceRole } from '../../lib/instanceTopology';

export type { InstanceRole };

export interface LeaderLockEntry {
  pid: number;
  port: number;
  host: string;
  startedAt: string;
  heartbeat: string;
}

export interface LeaderElectionOptions {
  stateDir: string;
  port: number;
  host: string;
  heartbeatIntervalMs?: number;
  staleThresholdMs?: number;
}

const LOCK_FILE = 'leader.lock';
const DEFAULT_HEARTBEAT_MS = 5000;
const DEFAULT_STALE_MS = 15000;

export class LeaderElection extends EventEmitter {
  private readonly stateDir: string;
  private readonly port: number;
  private readonly host: string;
  private readonly heartbeatIntervalMs: number;
  private readonly staleThresholdMs: number;
  private _role: InstanceRole = 'candidate';
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private watchTimer: ReturnType<typeof setInterval> | null = null;
  private _leaderInfo: LeaderLockEntry | null = null;
  private _stopped = false;

  constructor(options: LeaderElectionOptions) {
    super();
    this.stateDir = options.stateDir;
    this.port = options.port;
    this.host = options.host;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS;
    this.staleThresholdMs = options.staleThresholdMs ?? DEFAULT_STALE_MS;
  }

  get role(): InstanceRole { return this._role; }
  get leaderInfo(): LeaderLockEntry | null { return this._leaderInfo; }
  get lockFilePath(): string { return path.join(this.stateDir, LOCK_FILE); }

  /**
   * Attempt to become leader via atomic lock file creation.
   * Returns true if this instance is now the leader.
   */
  tryAcquireLock(): boolean {
    this.ensureStateDir();
    const lockPath = this.lockFilePath;

    try {
      // O_CREAT | O_EXCL = fail if file exists (atomic create)
      const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
      const entry = this.buildLockEntry();
      fs.writeSync(fd, JSON.stringify(entry, null, 2));
      fs.closeSync(fd);
      this._role = 'leader';
      this._leaderInfo = entry;
      this.emit('promoted', entry);
      return true;
    } catch {
      // Lock file exists — check if holder is alive
      return this.handleExistingLock();
    }
  }

  /**
   * Check existing lock file. If holder is dead or stale, try to take over.
   */
  private handleExistingLock(): boolean {
    const lockPath = this.lockFilePath;
    let entry: LeaderLockEntry;

    try {
      const raw = fs.readFileSync(lockPath, 'utf8');
      entry = JSON.parse(raw);
    } catch {
      // Corrupt lock file — remove and retry
      try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
      return this.tryAcquireLock();
    }

    if (!this.isProcessAlive(entry.pid)) {
      // Leader is dead — remove lock and retry
      try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
      return this.tryAcquireLock();
    }

    // Check if heartbeat is stale
    const heartbeatAge = Date.now() - new Date(entry.heartbeat).getTime();
    if (heartbeatAge > this.staleThresholdMs) {
      // Leader heartbeat is stale — assume dead
      try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
      return this.tryAcquireLock();
    }

    // Leader is alive and fresh — become follower
    this._role = 'follower';
    this._leaderInfo = entry;
    this.emit('following', entry);
    return false;
  }

  /**
   * Start the election process and heartbeat/watch timers.
   */
  start(): InstanceRole {
    this._stopped = false;
    const isLeader = this.tryAcquireLock();

    if (isLeader) {
      this.startHeartbeat();
    } else {
      this.startWatcher();
    }

    return this._role;
  }

  /**
   * Stop all timers and release the lock if leader.
   */
  stop(): void {
    this._stopped = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }

    if (this._role === 'leader') {
      this.releaseLock();
    }
    this._role = 'candidate';
  }

  /**
   * Update the heartbeat timestamp in the lock file (leader only).
   * Uses atomic write-to-temp-then-rename to prevent corruption if
   * the process dies mid-write.
   */
  updateHeartbeat(): void {
    if (this._role !== 'leader') return;
    const lockPath = this.lockFilePath;
    const tmpPath = lockPath + '.tmp';
    try {
      const entry = this.buildLockEntry();
      fs.writeFileSync(tmpPath, JSON.stringify(entry, null, 2), 'utf8');
      fs.renameSync(tmpPath, lockPath);
      this._leaderInfo = entry;
    } catch {
      // Clean up temp file on failure
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      // Lost the lock file -- try to re-acquire
      this.tryAcquireLock();
    }
  }

  /**
   * Remove the lock file (leader relinquishing).
   */
  releaseLock(): void {
    try {
      const lockPath = this.lockFilePath;
      if (fs.existsSync(lockPath)) {
        const raw = fs.readFileSync(lockPath, 'utf8');
        const entry: LeaderLockEntry = JSON.parse(raw);
        // Only remove if we own it
        if (entry.pid === process.pid) {
          fs.unlinkSync(lockPath);
        }
      }
    } catch {
      // Best-effort
    }
  }

  /**
   * Check if the current leader is still alive.
   */
  isLeaderAlive(): boolean {
    if (this._role === 'leader') return true;
    if (!this._leaderInfo) return false;
    return this.isProcessAlive(this._leaderInfo.pid);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this._stopped) return;
      this.updateHeartbeat();
    }, this.heartbeatIntervalMs);
  }

  private startWatcher(): void {
    this.watchTimer = setInterval(() => {
      if (this._stopped) return;
      if (!this.isLeaderAlive() || this.isLeaderStale()) {
        // Leader is dead or stale — attempt promotion
        this.emit('leader-lost', this._leaderInfo);
        const promoted = this.tryAcquireLock();
        if (promoted) {
          if (this.watchTimer) { clearInterval(this.watchTimer); this.watchTimer = null; }
          this.startHeartbeat();
        }
      }
    }, this.heartbeatIntervalMs);
  }

  private isLeaderStale(): boolean {
    try {
      const raw = fs.readFileSync(this.lockFilePath, 'utf8');
      const entry: LeaderLockEntry = JSON.parse(raw);
      const heartbeatTime = new Date(entry.heartbeat).getTime();
      // Guard against clock drift or invalid timestamps
      if (isNaN(heartbeatTime)) return true;
      const age = Date.now() - heartbeatTime;
      // Negative age means clock skew -- treat as fresh to avoid
      // premature stale detection across machines with clock drift
      if (age < 0) return false;
      return age > this.staleThresholdMs;
    } catch {
      return true; // Can't read = stale
    }
  }

  private buildLockEntry(): LeaderLockEntry {
    const now = new Date().toISOString();
    return {
      pid: process.pid,
      port: this.port,
      host: this.host,
      startedAt: this._leaderInfo?.startedAt ?? now,
      heartbeat: now,
    };
  }

  private ensureStateDir(): void {
    if (!fs.existsSync(this.stateDir)) {
      fs.mkdirSync(this.stateDir, { recursive: true });
    }
  }

  isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}
