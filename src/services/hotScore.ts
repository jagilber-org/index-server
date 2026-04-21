/**
 * Phase 3: Hotness/Ranking System - Core Hot Score Algorithm
 *
 * Implements instruction ranking based on temporal usage patterns,
 * recency weighting, and usage frequency with configurable decay parameters.
 *
 * Hot Score Formula:
 * hotScore = (recentUsage * recencyWeight) + (historicalUsage * historyWeight) + bonuses
 *
 * @module HotScore
 * @version 1.0.0
 * @since Phase 3 Implementation
 */

import { logDebug, logInfo } from './logger.js';

/**
 * Configuration parameters for hot score calculation
 */
export interface HotScoreConfig {
  /** Weight for recent usage (last 24 hours). Default: 0.7 */
  recencyWeight: number;

  /** Weight for historical usage (beyond 24 hours). Default: 0.3 */
  historyWeight: number;

  /** Decay factor per hour for temporal weighting. Default: 0.95 */
  temporalDecay: number;

  /** Minimum score threshold for ranking inclusion. Default: 0.01 */
  minScoreThreshold: number;

  /** Maximum lookback hours for historical analysis. Default: 168 (7 days) */
  maxLookbackHours: number;

  /** Bonus points for first-time usage. Default: 0.1 */
  firstUseBonus: number;

  /** Bonus points for diverse usage patterns. Default: 0.05 */
  diversityBonus: number;
}

/**
 * Usage data point for hot score calculation
 */
export interface UsagePoint {
  /** Timestamp of usage event (Unix epoch ms) */
  timestamp: number;

  /** Usage count at this point */
  count: number;

  /** Optional context metadata */
  context?: Record<string, string | number | boolean>;
}

/**
 * Computed hot score result with breakdown
 */
export interface HotScoreResult {
  /** Final computed hot score */
  score: number;

  /** Breakdown of score components */
  breakdown: {
    recentUsage: number;
    historicalUsage: number;
    recencyContribution: number;
    historyContribution: number;
    bonuses: number;
  };

  /** Ranking metadata */
  metadata: {
    totalUsageEvents: number;
    uniqueHours: number;
    firstUsage?: number;
    lastUsage?: number;
    usageTrend: 'increasing' | 'decreasing' | 'stable';
  };
}

/**
 * Default hot score configuration optimized for enterprise usage patterns
 */
export const DEFAULT_HOT_SCORE_CONFIG: HotScoreConfig = {
  recencyWeight: 0.7,      // Favor recent activity
  historyWeight: 0.3,      // But consider historical patterns
  temporalDecay: 0.95,     // 5% decay per hour
  minScoreThreshold: 0.01, // Filter very low scores
  maxLookbackHours: 168,   // 7 days historical window
  firstUseBonus: 0.1,      // Encourage exploration
  diversityBonus: 0.05     // Reward varied usage
};

/**
 * Hot score calculation service
 *
 * Provides sophisticated instruction ranking based on temporal usage patterns
 * with configurable weighting, decay factors, and bonus systems.
 */
export class HotScoreService {
  private config: HotScoreConfig;

  /**
   * Initialize hot score service with configuration
   *
   * @param config - Hot score calculation parameters
   */
  constructor(config: HotScoreConfig = DEFAULT_HOT_SCORE_CONFIG) {
    this.config = { ...config };

    logInfo('[hotScore] HotScoreService initialized', {
      recencyWeight: this.config.recencyWeight,
      historyWeight: this.config.historyWeight,
      temporalDecay: this.config.temporalDecay,
      maxLookbackHours: this.config.maxLookbackHours
    });
  }

  /**
   * Calculate hot score for instruction based on usage history
   *
   * @param instructionId - Unique identifier for instruction
   * @param usageHistory - Temporal usage data points
   * @param currentTime - Current timestamp for recency calculation (defaults to now)
   * @returns Hot score result with detailed breakdown
   */
  public calculateHotScore(
    instructionId: string,
    usageHistory: UsagePoint[],
  _currentTime: number = Date.now()
  ): HotScoreResult {
    if (!usageHistory.length) {
      return this.createEmptyResult();
    }

    const currentTime = _currentTime; // internal alias; parameter intentionally prefixed underscore to satisfy lint
    const sortedHistory = usageHistory
      .filter(point => point.timestamp <= currentTime)
      .sort((a, b) => b.timestamp - a.timestamp); // Most recent first

  const cutoffTime = currentTime - (this.config.maxLookbackHours * 60 * 60 * 1000);
    const relevantHistory = sortedHistory.filter(point => point.timestamp >= cutoffTime);

    if (!relevantHistory.length) {
      return this.createEmptyResult();
    }

    // Calculate temporal weights and usage components
  const recentBoundary = currentTime - (24 * 60 * 60 * 1000); // 24 hours ago
  const recentUsage = this.calculateTimeWindowUsage(relevantHistory, recentBoundary, currentTime);
  const historicalUsage = this.calculateTimeWindowUsage(relevantHistory, cutoffTime, recentBoundary);

    // Apply configuration weights
    const recencyContribution = recentUsage * this.config.recencyWeight;
    const historyContribution = historicalUsage * this.config.historyWeight;

    // Calculate bonuses
  const bonuses = this.calculateBonuses(instructionId, relevantHistory, currentTime);

    // Compute final score
    const score = recencyContribution + historyContribution + bonuses;

    // Generate metadata
  const metadata = this.generateMetadata(relevantHistory, currentTime);

    const result: HotScoreResult = {
      score: Math.max(0, score),
      breakdown: {
        recentUsage,
        historicalUsage,
        recencyContribution,
        historyContribution,
        bonuses
      },
      metadata
    };

    logDebug('[hotScore] Hot score calculated', {
      instructionId,
      score: result.score,
      usagePoints: relevantHistory.length,
      ...result.breakdown
    });

    return result;
  }

  /**
   * Calculate usage score for a specific time window with temporal decay
   */
  private calculateTimeWindowUsage(
    history: UsagePoint[],
    windowStart: number,
    windowEnd: number
  ): number {
    const windowHistory = history.filter(
      point => point.timestamp >= windowStart && point.timestamp < windowEnd
    );

    if (!windowHistory.length) return 0;

    let totalScore = 0;
    for (const point of windowHistory) {
      const hoursFromEnd = (windowEnd - point.timestamp) / (60 * 60 * 1000);
      const decayFactor = Math.pow(this.config.temporalDecay, hoursFromEnd);
      totalScore += point.count * decayFactor;
    }

    return totalScore;
  }

  /**
   * Calculate bonus points for special usage patterns
   */
  private calculateBonuses(
  instructionId: string,
    history: UsagePoint[],
	_currentTime: number
  ): number {
    let bonuses = 0;

    // First use bonus (encourages exploration)
    const totalUsage = history.reduce((sum, point) => sum + point.count, 0);
    if (totalUsage === 1) {
      bonuses += this.config.firstUseBonus;
    }

    // Diversity bonus (rewards varied usage patterns)
    const uniqueHours = new Set(
      history.map(point => Math.floor(point.timestamp / (60 * 60 * 1000)))
    ).size;

    if (uniqueHours >= 3) {
      bonuses += this.config.diversityBonus;
    }

    return bonuses;
  }

  /**
   * Generate ranking metadata for analysis and debugging
   */
  private generateMetadata(history: UsagePoint[], _currentTime: number): HotScoreResult['metadata'] {
    const timestamps = history.map(p => p.timestamp);
    const totalUsageEvents = history.reduce((sum, point) => sum + point.count, 0);
    const uniqueHours = new Set(
      history.map(point => Math.floor(point.timestamp / (60 * 60 * 1000)))
    ).size;

    const firstUsage = Math.min(...timestamps);
    const lastUsage = Math.max(...timestamps);

    // Simple trend analysis (last quarter vs previous quarter)
    const quarterDuration = (_currentTime - firstUsage) / 4;
    const lastQuarterStart = _currentTime - quarterDuration;

    const lastQuarterUsage = history
      .filter(p => p.timestamp >= lastQuarterStart)
      .reduce((sum, point) => sum + point.count, 0);

    const previousQuarterEnd = lastQuarterStart;
    const previousQuarterStart = previousQuarterEnd - quarterDuration;
    const previousQuarterUsage = history
      .filter(p => p.timestamp >= previousQuarterStart && p.timestamp < previousQuarterEnd)
      .reduce((sum, point) => sum + point.count, 0);

    let usageTrend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    if (lastQuarterUsage > previousQuarterUsage * 1.1) {
      usageTrend = 'increasing';
    } else if (lastQuarterUsage < previousQuarterUsage * 0.9) {
      usageTrend = 'decreasing';
    }

    return {
      totalUsageEvents,
      uniqueHours,
      firstUsage,
      lastUsage,
      usageTrend
    };
  }

  /**
   * Create empty result for instructions with no usage history
   */
  private createEmptyResult(): HotScoreResult {
    return {
      score: 0,
      breakdown: {
        recentUsage: 0,
        historicalUsage: 0,
        recencyContribution: 0,
        historyContribution: 0,
        bonuses: 0
      },
      metadata: {
        totalUsageEvents: 0,
        uniqueHours: 0,
        usageTrend: 'stable'
      }
    };
  }

  /**
   * Update configuration parameters
   *
   * @param newConfig - Updated configuration parameters
   */
  public updateConfig(newConfig: Partial<HotScoreConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logInfo('[hotScore] Hot score configuration updated', newConfig);
  }

  /**
   * Get current configuration
   *
   * @returns Current hot score configuration
   */
  public getConfig(): HotScoreConfig {
    return { ...this.config };
  }

  /**
   * Batch calculate hot scores for multiple instructions
   *
   * @param instructionUsage - Map of instruction ID to usage history
   * @param currentTime - Current timestamp for calculations
   * @returns Map of instruction ID to hot score results
   */
  public calculateBatchHotScores(
    instructionUsage: Map<string, UsagePoint[]>,
  _currentTime: number = Date.now()
  ): Map<string, HotScoreResult> {
    const results = new Map<string, HotScoreResult>();

    for (const [instructionId, usageHistory] of instructionUsage) {
  const result = this.calculateHotScore(instructionId, usageHistory, _currentTime);

      // Apply minimum threshold filter
      if (result.score >= this.config.minScoreThreshold) {
        results.set(instructionId, result);
      }
    }

    logInfo('[hotScore] Batch hot scores calculated', {
      totalInstructions: instructionUsage.size,
      qualifyingInstructions: results.size,
      minThreshold: this.config.minScoreThreshold
    });

    return results;
  }
}

/**
 * Utility function to create hot score service with default configuration
 *
 * @param overrides - Configuration overrides
 * @returns Configured hot score service instance
 */
export function createHotScoreService(overrides?: Partial<HotScoreConfig>): HotScoreService {
  const config = overrides ? { ...DEFAULT_HOT_SCORE_CONFIG, ...overrides } : DEFAULT_HOT_SCORE_CONFIG;
  return new HotScoreService(config);
}
