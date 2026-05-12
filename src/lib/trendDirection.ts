/**
 * Source of truth for the "trend direction" categorical enum used across
 * dashboard analytics, security monitoring, admin panel, and the hot-score
 * service.
 *
 * Two related tuples:
 *   - TREND_DIRECTIONS: 3-value scale ('increasing', 'decreasing', 'stable')
 *     used by SecurityMonitor, AdminPanel, hotScore.
 *   - EXTENDED_TREND_DIRECTIONS: 4-value scale that adds 'volatile' for
 *     AnalyticsEngine's TrendAnalysis (which detects high-variance series
 *     that cannot be cleanly classified as monotonic).
 *
 * The 3-value tuple is a strict subset of the 4-value tuple, so `TrendDirection`
 * is assignable to `ExtendedTrendDirection`.
 *
 * Drift in either tuple is caught by the SOT scanner
 * (src/tests/contentTypeSourceOfTruth.spec.ts).
 */
export const TREND_DIRECTIONS = ['increasing', 'decreasing', 'stable'] as const;
export type TrendDirection = (typeof TREND_DIRECTIONS)[number];

export const EXTENDED_TREND_DIRECTIONS = [
  ...TREND_DIRECTIONS,
  'volatile',
] as const;
export type ExtendedTrendDirection = (typeof EXTENDED_TREND_DIRECTIONS)[number];
