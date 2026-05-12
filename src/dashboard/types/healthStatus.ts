/**
 * Dashboard health-status taxonomy — single source of truth (SOT).
 *
 * Three-value health status emitted by the dashboard's metrics-aggregation
 * pipeline and admin panel:
 *
 *   - `healthy`  — all monitored thresholds within normal range
 *   - `warning`  — at least one threshold breached, but service usable
 *   - `critical` — severe threshold breach requiring attention
 *
 * The optional `EXTENDED_HEALTH_STATUSES` variant adds `down` for the
 * SecurityMonitor surface (4-state taxonomy for monitored sub-services
 * that may be entirely offline).
 *
 * Distinct from:
 *  - `SEVERITY_LEVELS`     (low/medium/high/critical — feedback/threat severity)
 *  - `MESSAGE_PRIORITIES`  (low/normal/high/critical — messaging surface)
 *  - per-route `'healthy'|'degraded'` 2-value liveness pings, which are a
 *    structurally distinct binary readiness signal owned by status.routes.ts.
 *
 * @module healthStatus
 */

export const HEALTH_STATUSES = ['healthy', 'warning', 'critical'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const EXTENDED_HEALTH_STATUSES = [...HEALTH_STATUSES, 'down'] as const;
export type ExtendedHealthStatus = (typeof EXTENDED_HEALTH_STATUSES)[number];
