/**
 * `config/serviceEnv` — the accessors the #611 S-4 sweep routed the service
 * layer through.
 *
 * Two properties are pinned here, and they are the two a future "tidy this up
 * into RuntimeConfig" change would break silently:
 *
 * 1. **They re-read `process.env` on every call.** Every one of these settings
 *    was a live read before the sweep, and several suites depend on that —
 *    they repoint `INDEX_SERVER_ACTIVITY_DB`, `INDEX_SERVER_MANIFEST_PATH` and
 *    `INDEX_SERVER_USAGE_SNAPSHOT_PATH` at a temp directory *after* the module
 *    graph is loaded, precisely so parallel forks stop writing to a shared
 *    file. Moving them onto the memoized `getRuntimeConfig()` snapshot would
 *    not fail to compile and would not fail loudly; it would just send the
 *    writes back to wherever the first read resolved.
 *
 * 2. **The leader and the thin client resolve the state directory
 *    identically.** They are separate processes that meet only through the
 *    lock file in that directory, so a divergence produces no error anywhere —
 *    just a thin client that never discovers a leader.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import {
  activityDbConfigured,
  activityLogSetting,
  activityRetentionDays,
  eventBufferCapacity,
  mcpBackupRetention,
  resolveActivityDbPath,
  resolveStateDir,
  DEFAULT_ACTIVITY_RETENTION_DAYS,
  DEFAULT_EVENT_BUFFER_CAPACITY,
  DEFAULT_MCP_BACKUP_RETAIN,
} from '../../config/serviceEnv';
import { STATE_ROOT } from '../../config/configUtils';
import { parseDashboardConfig } from '../../config/dashboardConfig';

const KEYS = [
  'INDEX_SERVER_ACTIVITY_DB',
  'INDEX_SERVER_ACTIVITY_LOG',
  'INDEX_SERVER_ACTIVITY_RETENTION_DAYS',
  'INDEX_SERVER_METRICS_DIR',
  'INDEX_SERVER_EVENT_BUFFER_SIZE',
  'INDEX_SERVER_MCP_BACKUP_RETAIN',
  'INDEX_SERVER_STATE_DIR',
];

describe('config/serviceEnv (#611)', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] !== undefined) process.env[k] = saved[k];
      else delete process.env[k];
    }
  });

  describe('reads are live, not snapshotted', () => {
    it('eventBufferCapacity tracks a change made between calls', () => {
      expect(eventBufferCapacity()).toBe(DEFAULT_EVENT_BUFFER_CAPACITY);
      process.env.INDEX_SERVER_EVENT_BUFFER_SIZE = '1200';
      expect(eventBufferCapacity()).toBe(1200);
      process.env.INDEX_SERVER_EVENT_BUFFER_SIZE = '900';
      expect(eventBufferCapacity()).toBe(900);
    });

    it('resolveActivityDbPath tracks a change made between calls', () => {
      const first = resolveActivityDbPath();
      process.env.INDEX_SERVER_ACTIVITY_DB = path.join('tmp-a', 'activity.db');
      const second = resolveActivityDbPath();
      process.env.INDEX_SERVER_ACTIVITY_DB = path.join('tmp-b', 'activity.db');
      const third = resolveActivityDbPath();

      expect(second).not.toBe(first);
      expect(third).not.toBe(second);
      expect(third).toBe(path.resolve(path.join('tmp-b', 'activity.db')));
    });
  });

  describe('resolution rules moved out of the service layer', () => {
    it('activity db precedence: explicit db > metrics dir > STATE_ROOT/metrics', () => {
      expect(resolveActivityDbPath()).toBe(path.join(STATE_ROOT, 'metrics', 'activity.db'));

      process.env.INDEX_SERVER_METRICS_DIR = path.join('some', 'metrics');
      expect(resolveActivityDbPath()).toBe(path.join(path.resolve('some', 'metrics'), 'activity.db'));

      process.env.INDEX_SERVER_ACTIVITY_DB = path.join('explicit', 'a.db');
      expect(resolveActivityDbPath()).toBe(path.resolve('explicit', 'a.db'));
    });

    it('whitespace-only overrides do not count as configured', () => {
      process.env.INDEX_SERVER_ACTIVITY_DB = '   ';
      expect(activityDbConfigured()).toBe(false);
      // ...and the resolver falls through rather than resolving the blank.
      expect(resolveActivityDbPath()).toBe(path.join(STATE_ROOT, 'metrics', 'activity.db'));
    });

    it('activityLogSetting is tri-state, because the caller needs all three', () => {
      expect(activityLogSetting()).toBe('unset');
      for (const off of ['0', 'off', 'FALSE', ' no ']) {
        process.env.INDEX_SERVER_ACTIVITY_LOG = off;
        expect(activityLogSetting(), `"${off}" should read as off`).toBe('off');
      }
      for (const on of ['1', 'true', 'yes', 'anything-else']) {
        process.env.INDEX_SERVER_ACTIVITY_LOG = on;
        expect(activityLogSetting(), `"${on}" should read as on`).toBe('on');
      }
    });

    it('retention and backup counts reject junk rather than propagating NaN', () => {
      expect(activityRetentionDays()).toBe(DEFAULT_ACTIVITY_RETENTION_DAYS);
      process.env.INDEX_SERVER_ACTIVITY_RETENTION_DAYS = 'not-a-number';
      expect(activityRetentionDays()).toBe(DEFAULT_ACTIVITY_RETENTION_DAYS);
      process.env.INDEX_SERVER_ACTIVITY_RETENTION_DAYS = '-5';
      expect(activityRetentionDays()).toBe(DEFAULT_ACTIVITY_RETENTION_DAYS);
      process.env.INDEX_SERVER_ACTIVITY_RETENTION_DAYS = '7';
      expect(activityRetentionDays()).toBe(7);

      expect(mcpBackupRetention()).toBe(DEFAULT_MCP_BACKUP_RETAIN);
      process.env.INDEX_SERVER_MCP_BACKUP_RETAIN = '0';
      expect(mcpBackupRetention()).toBe(DEFAULT_MCP_BACKUP_RETAIN);
      process.env.INDEX_SERVER_MCP_BACKUP_RETAIN = '3.9';
      expect(mcpBackupRetention()).toBe(3);
    });

    it('event buffer capacity is clamped to [50, 5000]', () => {
      process.env.INDEX_SERVER_EVENT_BUFFER_SIZE = '1';
      expect(eventBufferCapacity()).toBe(50);
      process.env.INDEX_SERVER_EVENT_BUFFER_SIZE = '999999';
      expect(eventBufferCapacity()).toBe(5000);
      process.env.INDEX_SERVER_EVENT_BUFFER_SIZE = 'garbage';
      expect(eventBufferCapacity()).toBe(DEFAULT_EVENT_BUFFER_CAPACITY);
    });
  });

  describe('the leader and the thin client agree on the state directory', () => {
    // thin-client.ts reads the lock file that the leader writes into
    // dashboard.stateDir. It used to build `<cwd>/data/state` itself, which
    // stopped matching after #577 moved state under STATE_ROOT — with no error
    // on either side, just a leader that is never found.
    it('with INDEX_SERVER_STATE_DIR unset', () => {
      expect(resolveStateDir()).toBe(parseDashboardConfig(true, process.cwd()).admin.stateDir);
      // And specifically not the pre-#577 cwd-relative path the thin client used.
      expect(resolveStateDir()).not.toBe(path.join(process.cwd(), 'data', 'state'));
    });

    it('with INDEX_SERVER_STATE_DIR set to an absolute path', () => {
      const explicit = path.resolve(path.join('some', 'explicit', 'state'));
      process.env.INDEX_SERVER_STATE_DIR = explicit;
      expect(resolveStateDir()).toBe(explicit);
      expect(resolveStateDir()).toBe(parseDashboardConfig(true, process.cwd()).admin.stateDir);
    });

    it('with a RELATIVE INDEX_SERVER_STATE_DIR, which anchors to STATE_ROOT', () => {
      process.env.INDEX_SERVER_STATE_DIR = 'relative-state';
      expect(resolveStateDir()).toBe(path.resolve(STATE_ROOT, 'relative-state'));
      expect(resolveStateDir()).toBe(parseDashboardConfig(true, process.cwd()).admin.stateDir);
    });
  });
});
