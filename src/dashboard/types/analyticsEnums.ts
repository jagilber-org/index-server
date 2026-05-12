/**
 * Analytics-engine internal taxonomies — single source of truth (SOT).
 *
 * These tuples are consumed exclusively by the dashboard analytics surface
 * (src/dashboard/analytics/*) for anomaly classification, recommendation
 * routing, alert severity, and effort estimation.
 *
 * Distinct from:
 *  - `SEVERITY_LEVELS`  (low/medium/high/critical — feedback/threat severity)
 *  - `HEALTH_STATUSES`  (healthy/warning/critical — system health rollup)
 *  - `LOG_LEVELS_*`     (logger / NDJSON / wire-format)
 *
 * @module analyticsEnums
 */

export const ANOMALY_TYPES = ['spike', 'drop', 'outlier', 'pattern_break'] as const;
export type AnomalyType = (typeof ANOMALY_TYPES)[number];

export const RECOMMENDATION_TYPES = ['optimization', 'scaling', 'maintenance', 'business'] as const;
export type RecommendationType = (typeof RECOMMENDATION_TYPES)[number];

export const ALERT_CATEGORIES = ['performance', 'capacity', 'security', 'business'] as const;
export type AlertCategory = (typeof ALERT_CATEGORIES)[number];

export const ALERT_SEVERITIES = ['info', 'warning', 'error', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const EFFORT_LEVELS = ['low', 'medium', 'high'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];
