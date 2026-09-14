import { describe, expect, it } from 'vitest';
import { FLAG_REGISTRY } from '../../services/handlers.dashboardConfig';
import {
  DEFAULT_LIMITS,
  DEFAULT_PORTS,
  DEFAULT_THRESHOLDS,
  DEFAULT_TIMEOUTS_MS,
} from '../../config/defaultValues';

/**
 * The Configuration panel's `default` fields are hand-written strings next to a
 * hand-written description, in a 148-entry array. Nothing checked them against
 * the values the server actually uses, and they drifted (#588):
 *
 *   INDEX_SERVER_MAX_BULK_DELETE          panel 1000   real 5
 *   INDEX_SERVER_FEEDBACK_MAX_ENTRIES     panel 10000  real 1000
 *   INDEX_SERVER_MESSAGING_MAX            panel 5000   real 10000
 *   INDEX_SERVER_BOOTSTRAP_TOKEN_TTL_SEC  panel 600    real 900
 *   INDEX_SERVER_READ_RETRIES             panel 5      real 3
 *   INDEX_SERVER_READ_BACKOFF_MS          panel 10     real 8
 *   INDEX_SERVER_ADMIN_MAX_SESSION_HISTORY panel 500   real 200
 *
 * MAX_BULK_DELETE is the one that mattered: it is the `force`-required
 * guardrail on destructive bulk delete and purge. An operator reading the panel
 * would believe 1000 ids pass unchallenged when the real threshold is 5 — the
 * panel understated a safety limit by 200x, in the permissive direction.
 *
 * This pins every panel default that is sourced from `defaultValues.ts`. It is
 * deliberately not a full sweep of all 148: many defaults are computed (profile
 * overlays, path resolution) and cannot be compared to a constant. Those are
 * covered by `check-config-parity.mjs` and by review; the numeric limits are
 * the ones a stale string actively misleads about.
 */
function panelDefault(name: string): string | undefined {
  const entry = FLAG_REGISTRY.find((f) => f.name === name);
  expect(entry, `${name} missing from FLAG_REGISTRY`).toBeDefined();
  return entry!.default;
}

const PINNED: Array<[string, number]> = [
  ['INDEX_SERVER_MAX_BULK_DELETE', DEFAULT_LIMITS.MAX_BULK_DELETE],
  ['INDEX_SERVER_FEEDBACK_MAX_ENTRIES', DEFAULT_LIMITS.MAX_FEEDBACK_ENTRIES],
  ['INDEX_SERVER_MESSAGING_MAX', DEFAULT_LIMITS.MAX_MESSAGES],
  ['INDEX_SERVER_ADMIN_MAX_SESSION_HISTORY', DEFAULT_LIMITS.MAX_SESSION_HISTORY],
  ['INDEX_SERVER_READ_RETRIES', DEFAULT_LIMITS.READ_RETRIES],
  ['INDEX_SERVER_READ_BACKOFF_MS', DEFAULT_LIMITS.READ_BACKOFF_MS],
  // INDEX_SERVER_ATOMIC_WRITE_RETRIES and _BACKOFF_MS are deliberately absent:
  // both are documented in docs/configuration.md and read by the server, but
  // have no FLAG_REGISTRY entry, so the Configuration panel does not show them
  // at all. Registering them belongs with the #611 config-layer sweep, which is
  // already adding panel entries; recorded here rather than silently skipped.
  ['INDEX_SERVER_BODY_WARN_LENGTH', DEFAULT_LIMITS.BODY_WARN_LENGTH],
  ['INDEX_SERVER_DEFAULT_PAGE_SIZE', DEFAULT_LIMITS.DEFAULT_PAGE_SIZE],
  ['INDEX_SERVER_MAX_CONNECTIONS', DEFAULT_LIMITS.MAX_CONNECTIONS],
  ['INDEX_SERVER_AUTO_BACKUP_MAX_COUNT', DEFAULT_LIMITS.AUTO_BACKUP_MAX_COUNT],
  ['INDEX_SERVER_TOOLCALL_CHUNK_SIZE', DEFAULT_LIMITS.TOOLCALL_CHUNK_SIZE],
  ['INDEX_SERVER_BOOTSTRAP_TOKEN_TTL_SEC', DEFAULT_PORTS.BOOTSTRAP_TOKEN_TTL_SEC],
  ['INDEX_SERVER_DASHBOARD_PORT', DEFAULT_PORTS.DASHBOARD],
  ['INDEX_SERVER_LEADER_PORT', DEFAULT_PORTS.LEADER],
  ['INDEX_SERVER_DASHBOARD_TRIES', DEFAULT_LIMITS.MAX_PORT_TRIES],
  ['INDEX_SERVER_HEARTBEAT_MS', DEFAULT_TIMEOUTS_MS.HEARTBEAT],
  ['INDEX_SERVER_STALE_THRESHOLD_MS', DEFAULT_TIMEOUTS_MS.STALE_THRESHOLD],
  ['INDEX_SERVER_POLL_MS', DEFAULT_TIMEOUTS_MS.POLL_INTERVAL],
  ['INDEX_SERVER_REQUEST_TIMEOUT', DEFAULT_TIMEOUTS_MS.REQUEST_TIMEOUT],
  ['INDEX_SERVER_IDLE_KEEPALIVE_MS', DEFAULT_TIMEOUTS_MS.IDLE_KEEPALIVE],
  ['INDEX_SERVER_FATAL_EXIT_DELAY_MS', DEFAULT_TIMEOUTS_MS.FATAL_EXIT_DELAY],
  ['INDEX_SERVER_TOOLCALL_FLUSH_MS', DEFAULT_TIMEOUTS_MS.TOOLCALL_FLUSH],
  ['INDEX_SERVER_TOOLCALL_COMPACT_MS', DEFAULT_TIMEOUTS_MS.TOOLCALL_COMPACT],
  ['INDEX_SERVER_HEALTH_MIN_UPTIME', DEFAULT_TIMEOUTS_MS.HEALTH_MIN_UPTIME],
  ['INDEX_SERVER_MESSAGING_SWEEP_MS', DEFAULT_TIMEOUTS_MS.MESSAGING_SWEEP],
  ['INDEX_SERVER_HEALTH_MEMORY_THRESHOLD', DEFAULT_THRESHOLDS.MEMORY_THRESHOLD],
  ['INDEX_SERVER_HEALTH_ERROR_THRESHOLD', DEFAULT_THRESHOLDS.ERROR_RATE_THRESHOLD],
  ['INDEX_SERVER_RESOURCE_CAPACITY', DEFAULT_THRESHOLDS.RESOURCE_CAPACITY],
  ['INDEX_SERVER_RESOURCE_SAMPLE_INTERVAL_MS', DEFAULT_THRESHOLDS.RESOURCE_SAMPLE_INTERVAL_MS],
];

describe('dashboard Configuration panel defaults', () => {
  it.each(PINNED)('%s advertises the value the server actually uses', (name, expected) => {
    expect(panelDefault(name)).toBe(String(expected));
  });

  it('does not advertise a numeric limit as "(unset)" when a default exists', () => {
    // Eight entries claimed `(unset)` while the server had a concrete default
    // (720 resource samples, 250-item tool-call chunks, a 0.95 memory
    // threshold). "(unset)" tells an operator the feature is unconfigured;
    // it was running with values they could not see.
    const offenders = PINNED.filter(([name]) => panelDefault(name) === '(unset)');
    expect(offenders.map(([n]) => n)).toEqual([]);
  });

  it('marks removed variables as deprecated and non-editable', () => {
    // INDEX_SERVER_BODY_MAX_LENGTH was `stability:'stable', editable:true`
    // long after runtimeConfig.ts started warning that it is "no longer
    // recognized" — the panel offered a control whose only effect was a
    // startup warning. INDEX_SERVER_METRICS_MAX_FILES was never implemented
    // at all.
    for (const name of ['INDEX_SERVER_BODY_MAX_LENGTH', 'INDEX_SERVER_METRICS_MAX_FILES']) {
      const entry = FLAG_REGISTRY.find((f) => f.name === name);
      expect(entry, `${name} missing`).toBeDefined();
      expect(entry!.stability, `${name} stability`).toBe('deprecated');
      expect(entry!.editable, `${name} editable`).toBe(false);
    }
  });

  it('has a unique entry per flag name', () => {
    const names = FLAG_REGISTRY.map((f) => f.name);
    expect(names.length).toBe(new Set(names).size);
  });
});
