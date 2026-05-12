/**
 * Source of truth for dashboard "severity" / "priority" 4-level scale.
 *
 * Used by SecurityMonitor (security event severity), AnalyticsEngine
 * (anomaly severity + recommendation priority), metricsAggregation (alert
 * severity), and WebSocketManager (broadcast severity).
 *
 * This is conceptually distinct from:
 *   - feedback severity (FEEDBACK_SEVERITIES in src/services/feedbackStorage.ts)
 *     — happens to share the same value names, but lives on the MCP feedback
 *     protocol surface and is validated separately.
 *   - message priority (MESSAGE_PRIORITIES in src/services/messaging/messagingTypes.ts)
 *     — uses 'normal' instead of 'medium'; different scale.
 *
 * Drift in this tuple is caught by the SOT scanner
 * (src/tests/contentTypeSourceOfTruth.spec.ts).
 */
export const SEVERITY_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
export type SeverityLevel = (typeof SEVERITY_LEVELS)[number];
