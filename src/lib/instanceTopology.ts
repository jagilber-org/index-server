/**
 * Instance topology taxonomies — single source of truth (SOT).
 *
 * Two related-but-distinct enums:
 *   • `INSTANCE_MODES`   — operator INTENT (configured via INDEX_SERVER_MODE).
 *                          'auto' delegates the decision to the leader-election
 *                          process at startup.
 *   • `INSTANCE_ROLES`   — runtime ELECTED STATE from the LeaderElection actor.
 *                          'candidate' is the transient pre-election state; not
 *                          a valid operator-configurable mode.
 *
 * They overlap on 'leader' | 'follower' | 'standalone' but the 4th member
 * differs ('auto' vs 'candidate') because the two enums describe different
 * lifecycle phases.
 *
 * @module instanceTopology
 */

/** Operator-configurable instance mode (INDEX_SERVER_MODE). */
export const INSTANCE_MODES = ['standalone', 'leader', 'follower', 'auto'] as const;
export type InstanceMode = (typeof INSTANCE_MODES)[number];

/** Runtime elected role from LeaderElection. */
export const INSTANCE_ROLES = ['leader', 'follower', 'standalone', 'candidate'] as const;
export type InstanceRole = (typeof INSTANCE_ROLES)[number];
