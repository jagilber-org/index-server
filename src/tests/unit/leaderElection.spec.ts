/**
 * LeaderElection Tests - TDD
 *
 * Tests for the leader election mechanism:
 * - Lock file acquisition
 * - Follower detection when leader exists
 * - Stale leader promotion
 * - Dead leader promotion
 * - Heartbeat updates
 * - Lock release on stop
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { LeaderElection, LeaderLockEntry, LeaderElectionOptions } from '../../dashboard/server/LeaderElection';

describe('LeaderElection', () => {
  let tempDir: string;
  let election: LeaderElection;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-leader-test-'));
  });

  afterEach(() => {
    if (election) election.stop();
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function createElection(opts: Partial<LeaderElectionOptions> = {}): LeaderElection {
    election = new LeaderElection({
      stateDir: tempDir,
      port: 9090,
      host: '127.0.0.1',
      heartbeatIntervalMs: 100,
      staleThresholdMs: 300,
      ...opts,
    });
    return election;
  }

  describe('Lock Acquisition', () => {
    it('should become leader when no lock file exists', () => {
      const e = createElection();
      const acquired = e.tryAcquireLock();
      expect(acquired).toBe(true);
      expect(e.role).toBe('leader');
    });

    it('should write a valid lock file', () => {
      const e = createElection();
      e.tryAcquireLock();

      const lockPath = path.join(tempDir, 'leader.lock');
      expect(fs.existsSync(lockPath)).toBe(true);

      const entry: LeaderLockEntry = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      expect(entry.pid).toBe(process.pid);
      expect(entry.port).toBe(9090);
      expect(entry.host).toBe('127.0.0.1');
      expect(entry.startedAt).toBeTruthy();
      expect(entry.heartbeat).toBeTruthy();
    });

    it('should become follower when live leader lock exists', () => {
      // Create a lock file from this process (simulating another leader)
      const lockPath = path.join(tempDir, 'leader.lock');
      const existingEntry: LeaderLockEntry = {
        pid: process.pid, // Use current PID so it appears alive
        port: 8080,
        host: '127.0.0.1',
        startedAt: new Date().toISOString(),
        heartbeat: new Date().toISOString(),
      };
      fs.writeFileSync(lockPath, JSON.stringify(existingEntry), 'utf8');

      const e = createElection({ port: 9090 });
      const acquired = e.tryAcquireLock();
      // Since the lock is held by our own PID (alive), the atomic create will fail
      // and handleExistingLock will see it as alive — follower
      expect(acquired).toBe(false);
      expect(e.role).toBe('follower');
    });

    it('should take over when lock holder PID is dead', () => {
      const lockPath = path.join(tempDir, 'leader.lock');
      const deadEntry: LeaderLockEntry = {
        pid: 99999999, // Almost certainly not running
        port: 8080,
        host: '127.0.0.1',
        startedAt: new Date().toISOString(),
        heartbeat: new Date().toISOString(),
      };
      fs.writeFileSync(lockPath, JSON.stringify(deadEntry), 'utf8');

      const e = createElection();
      const acquired = e.tryAcquireLock();
      expect(acquired).toBe(true);
      expect(e.role).toBe('leader');
    });

    it('should take over when heartbeat is stale', () => {
      const lockPath = path.join(tempDir, 'leader.lock');
      const staleEntry: LeaderLockEntry = {
        pid: process.pid, // Alive but stale
        port: 8080,
        host: '127.0.0.1',
        startedAt: new Date().toISOString(),
        heartbeat: new Date(Date.now() - 60000).toISOString(), // 60 seconds old
      };
      fs.writeFileSync(lockPath, JSON.stringify(staleEntry), 'utf8');

      const e = createElection({ staleThresholdMs: 300 });
      const acquired = e.tryAcquireLock();
      expect(acquired).toBe(true);
      expect(e.role).toBe('leader');
    });

    it('should handle corrupt lock file by taking over', () => {
      const lockPath = path.join(tempDir, 'leader.lock');
      fs.writeFileSync(lockPath, 'NOT VALID JSON', 'utf8');

      const e = createElection();
      const acquired = e.tryAcquireLock();
      expect(acquired).toBe(true);
      expect(e.role).toBe('leader');
    });
  });

  describe('Heartbeat', () => {
    it('should update heartbeat timestamp', () => {
      const e = createElection();
      e.tryAcquireLock();
      expect(e.role).toBe('leader');

      const firstInfo = e.leaderInfo!;
      const _firstHeartbeat = firstInfo.heartbeat;

      // Small delay to ensure different timestamp
      const before = Date.now();
      // Force heartbeat update
      e.updateHeartbeat();
      const updated = e.leaderInfo!;

      expect(new Date(updated.heartbeat).getTime()).toBeGreaterThanOrEqual(before);
    });

    it('should not update heartbeat if not leader', () => {
      const e = createElection();
      e.updateHeartbeat();
      // Should not throw or create files
      expect(e.leaderInfo).toBeNull();
    });
  });

  describe('Lock Release', () => {
    it('should remove lock file on stop', () => {
      const e = createElection();
      e.tryAcquireLock();
      expect(e.role).toBe('leader');

      const lockPath = path.join(tempDir, 'leader.lock');
      expect(fs.existsSync(lockPath)).toBe(true);

      e.stop();
      expect(fs.existsSync(lockPath)).toBe(false);
      expect(e.role).toBe('candidate');
    });

    it('should not remove lock file if not owner', () => {
      // Write lock owned by different PID
      const lockPath = path.join(tempDir, 'leader.lock');
      const otherEntry: LeaderLockEntry = {
        pid: process.pid + 1, // Different PID
        port: 8080,
        host: '127.0.0.1',
        startedAt: new Date().toISOString(),
        heartbeat: new Date().toISOString(),
      };
      fs.writeFileSync(lockPath, JSON.stringify(otherEntry), 'utf8');

      const e = createElection();
      // Manually set role without acquiring lock
      (e as any)._role = 'leader';
      e.stop();

      // Lock should still exist (not ours to remove)
      expect(fs.existsSync(lockPath)).toBe(true);
    });
  });

  describe('Start/Stop Lifecycle', () => {
    it('should start as leader when no other instances', () => {
      const e = createElection();
      const role = e.start();
      expect(role).toBe('leader');
    });

    it('should emit promoted event on becoming leader', () => {
      const e = createElection();
      let promoted = false;
      e.on('promoted', () => { promoted = true; });
      e.start();
      expect(promoted).toBe(true);
    });

    it('should clean up timers on stop', () => {
      const e = createElection();
      e.start();
      e.stop();
      // No assertion needed — just should not throw or leave timers
      expect(e.role).toBe('candidate');
    });
  });

  describe('isProcessAlive', () => {
    it('should return true for current PID', () => {
      const e = createElection();
      expect(e.isProcessAlive(process.pid)).toBe(true);
    });

    it('should return false for non-existent PID', () => {
      const e = createElection();
      expect(e.isProcessAlive(99999999)).toBe(false);
    });
  });

  describe('leaderInfo', () => {
    it('should return leader info after acquisition', () => {
      const e = createElection();
      e.tryAcquireLock();
      const info = e.leaderInfo;
      expect(info).not.toBeNull();
      expect(info!.pid).toBe(process.pid);
      expect(info!.port).toBe(9090);
    });

    it('should return follower leader info after following', () => {
      const lockPath = path.join(tempDir, 'leader.lock');
      const leaderEntry: LeaderLockEntry = {
        pid: process.pid,
        port: 8080,
        host: '127.0.0.1',
        startedAt: new Date().toISOString(),
        heartbeat: new Date().toISOString(),
      };
      fs.writeFileSync(lockPath, JSON.stringify(leaderEntry), 'utf8');

      const e = createElection({ port: 9090 });
      e.tryAcquireLock();
      const info = e.leaderInfo;
      expect(info).not.toBeNull();
      expect(info!.port).toBe(8080); // Leader's port, not ours
    });
  });
});
