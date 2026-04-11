/**
 * AnalyticsEngine - Phase 3 Advanced Analytics & Business Intelligence
 *
 * Analytics engine providing:
 * - Real-time trend analysis and forecasting
 * - Business intelligence metrics and KPIs
 * - Performance analytics and optimization insights
 * - Usage pattern recognition and anomaly detection
 */

export interface TimeSeriesData {
  timestamp: number;
  value: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface TrendAnalysis {
  trend: 'increasing' | 'decreasing' | 'stable' | 'volatile';
  confidence: number; // 0-1
  slope: number;
  correlation: number;
  forecast: TimeSeriesData[];
  seasonality?: {
    detected: boolean;
    period: number;
    strength: number;
  };
}

export interface BusinessMetrics {
  // Core KPIs
  totalRequests: number;
  successRate: number;
  averageResponseTime: number;
  errorRate: number;

  // Performance metrics
  throughput: number; // requests per second
  latencyPercentiles: {
    p50: number;
    p90: number;
    p95: number;
    p99: number;
  };

  // Business intelligence
  topTools: Array<{
    name: string;
    usage: number;
    trend: number;
    revenue?: number;
  }>;

  userSegmentation: {
    powerUsers: number;
    regularUsers: number;
    casualUsers: number;
  };

  // Growth metrics
  growthRate: number;
  retentionRate: number;
  churnRate: number;
}

export interface AnomalyDetection {
  anomalies: Array<{
    timestamp: number;
    value: number;
    severity: 'low' | 'medium' | 'high' | 'critical';
    type: 'spike' | 'drop' | 'outlier' | 'pattern_break';
    description: string;
    confidence: number;
  }>;

  patterns: Array<{
    name: string;
    description: string;
    frequency: number;
    lastSeen: number;
  }>;
}

export interface PredictiveInsights {
  nextHourForecast: TimeSeriesData[];
  nextDayForecast: TimeSeriesData[];
  nextWeekForecast: TimeSeriesData[];

  recommendations: Array<{
    type: 'optimization' | 'scaling' | 'maintenance' | 'business';
    priority: 'low' | 'medium' | 'high' | 'critical';
    title: string;
    description: string;
    impact: string;
    effort: 'low' | 'medium' | 'high';
    expectedRoi?: number;
  }>;

  alerts: Array<{
    id: string;
    type: 'performance' | 'capacity' | 'security' | 'business';
    severity: 'info' | 'warning' | 'error' | 'critical';
    message: string;
    timestamp: number;
    actionRequired: boolean;
  }>;
}

export class AnalyticsEngine {
  private timeSeriesData: Map<string, TimeSeriesData[]> = new Map();
  private businessMetrics: BusinessMetrics;
  private anomaliesHistory: AnomalyDetection[] = [];

  constructor() {
    this.businessMetrics = this.initializeMetrics();
    this.startAnalyticsLoop();
  }

  private initializeMetrics(): BusinessMetrics {
    return {
      totalRequests: 0,
      successRate: 0.0,
      averageResponseTime: 0,
      errorRate: 0.0,
      throughput: 0,
      latencyPercentiles: { p50: 0, p90: 0, p95: 0, p99: 0 },
      topTools: [],
      userSegmentation: { powerUsers: 0, regularUsers: 0, casualUsers: 0 },
      growthRate: 0,
      retentionRate: 0,
      churnRate: 0
    };
  }

  /**
   * Add time series data point for analysis
   */
  addDataPoint(metric: string, value: number, metadata?: Record<string, string | number | boolean>): void {
    const dataPoint: TimeSeriesData = {
      timestamp: Date.now(),
      value,
      metadata
    };

    if (!this.timeSeriesData.has(metric)) {
      this.timeSeriesData.set(metric, []);
    }

    const series = this.timeSeriesData.get(metric)!;
    series.push(dataPoint);

    // Keep only last 24 hours of data for performance
    const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
    this.timeSeriesData.set(
      metric,
      series.filter(point => point.timestamp > twentyFourHoursAgo)
    );

    this.updateBusinessMetrics(metric, value, metadata);
  }

  /**
   * Perform trend analysis on time series data
   */
  analyzeTrend(metric: string, lookbackHours: number = 1): TrendAnalysis | null {
    const series = this.timeSeriesData.get(metric);
    if (!series || series.length < 10) return null;

    const lookbackMs = lookbackHours * 60 * 60 * 1000;
    const cutoff = Date.now() - lookbackMs;
    const recentData = series.filter(point => point.timestamp >= cutoff);

    if (recentData.length < 5) return null;

    // Calculate linear regression
    const { slope, correlation } = this.calculateLinearRegression(recentData);

    // Determine trend direction
    const trend = this.determineTrend(slope, recentData);

    // Calculate confidence based on correlation and data points
    const confidence = Math.min(0.95, Math.abs(correlation) * (recentData.length / 100));

    // Generate forecast
    const forecast = this.generateForecast(recentData, slope, 12); // 12 future points

    // Detect seasonality
    const seasonality = this.detectSeasonality(series);

    return {
      trend,
      confidence,
      slope,
      correlation,
      forecast,
      seasonality
    };
  }

  /**
   * Detect anomalies in time series data
   */
  detectAnomalies(metric: string): AnomalyDetection {
    const series = this.timeSeriesData.get(metric) || [];
    if (series.length < 20) {
      return { anomalies: [], patterns: [] };
    }

    const anomalies = this.findAnomalies(series);
    const patterns = this.identifyPatterns(series);

    return { anomalies, patterns };
  }

  /**
   * Generate predictive insights and recommendations
   */
  generateInsights(): PredictiveInsights {
    const recommendations = this.generateRecommendations();
    const alerts = this.generateAlerts();

    // Generate forecasts for key metrics
    const nextHourForecast = this.generateMetricForecast('requests_per_minute', 60);
    const nextDayForecast = this.generateMetricForecast('requests_per_hour', 24);
    const nextWeekForecast = this.generateMetricForecast('requests_per_day', 7);

    return {
      nextHourForecast,
      nextDayForecast,
      nextWeekForecast,
      recommendations,
      alerts
    };
  }

  /**
   * Get current business metrics
   */
  getBusinessMetrics(): BusinessMetrics {
    return { ...this.businessMetrics };
  }

  /**
   * Get time series data for visualization
   */
  getTimeSeriesData(metric: string, hours: number = 1): TimeSeriesData[] {
    const series = this.timeSeriesData.get(metric) || [];
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);
    return series.filter(point => point.timestamp >= cutoff);
  }

  /**
   * Get available metrics list
   */
  getAvailableMetrics(): string[] {
    return Array.from(this.timeSeriesData.keys());
  }

  // Private helper methods

  private calculateLinearRegression(data: TimeSeriesData[]): { slope: number; correlation: number } {
    const n = data.length;
    if (n < 2) return { slope: 0, correlation: 0 };

    const x = data.map(point => point.timestamp);
    const y = data.map(point => point.value);

    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((total, xi, i) => total + xi * y[i], 0);
    const sumXX = x.reduce((total, xi) => total + xi * xi, 0);
    const sumYY = y.reduce((total, yi) => total + yi * yi, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));
    const correlation = denominator === 0 ? 0 : numerator / denominator;

    return { slope, correlation };
  }

  private determineTrend(slope: number, data: TimeSeriesData[]): 'increasing' | 'decreasing' | 'stable' | 'volatile' {
    const values = data.map(point => point.value);
    const volatility = this.calculateVolatility(values);

    if (volatility > 0.5) return 'volatile';
    if (Math.abs(slope) < 0.001) return 'stable';
    return slope > 0 ? 'increasing' : 'decreasing';
  }

  private calculateVolatility(values: number[]): number {
    if (values.length < 2) return 0;

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((total, value) => total + Math.pow(value - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    return mean === 0 ? 0 : stdDev / Math.abs(mean);
  }

  private generateForecast(data: TimeSeriesData[], slope: number, points: number): TimeSeriesData[] {
    if (data.length === 0) return [];

    const lastPoint = data[data.length - 1];
    const timeInterval = data.length > 1 ?
      (lastPoint.timestamp - data[data.length - 2].timestamp) : 60000; // 1 minute default

    const forecast: TimeSeriesData[] = [];

    for (let i = 1; i <= points; i++) {
      const timestamp = lastPoint.timestamp + (i * timeInterval);
      const value = Math.max(0, lastPoint.value + (slope * i * timeInterval));

      forecast.push({
        timestamp,
        value,
        metadata: { forecasted: true }
      });
    }

    return forecast;
  }

  private detectSeasonality(data: TimeSeriesData[]): { detected: boolean; period: number; strength: number } {
    if (data.length < 48) return { detected: false, period: 0, strength: 0 };

    // Simple seasonality detection - check for repeating patterns
    const values = data.map(point => point.value);
    const periods = [12, 24, 48, 96]; // 5min, 10min, 20min, 40min intervals

    let bestPeriod = 0;
    let bestStrength = 0;

    for (const period of periods) {
      if (period * 2 > values.length) continue;

      const strength = this.calculateSeasonalStrength(values, period);
      if (strength > bestStrength) {
        bestStrength = strength;
        bestPeriod = period;
      }
    }

    return {
      detected: bestStrength > 0.3,
      period: bestPeriod,
      strength: bestStrength
    };
  }

  private calculateSeasonalStrength(values: number[], period: number): number {
    if (values.length < period * 2) return 0;

    let correlation = 0;
    let count = 0;

    for (let i = period; i < values.length; i++) {
      correlation += values[i] * values[i - period];
      count++;
    }

    return count === 0 ? 0 : Math.abs(correlation / count) / Math.max(1, Math.max(...values));
  }

  private findAnomalies(data: TimeSeriesData[]): Array<{
    timestamp: number;
    value: number;
    severity: 'low' | 'medium' | 'high' | 'critical';
    type: 'spike' | 'drop' | 'outlier' | 'pattern_break';
    description: string;
    confidence: number;
  }> {
    if (data.length < 10) return [];

    const values = data.map(point => point.value);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const stdDev = Math.sqrt(values.reduce((total, value) => total + Math.pow(value - mean, 2), 0) / values.length);

    const anomalies = [];

    for (let i = 0; i < data.length; i++) {
      const point = data[i];
      const zScore = stdDev === 0 ? 0 : Math.abs(point.value - mean) / stdDev;

      if (zScore > 2.5) {
        const severity: 'low' | 'medium' | 'high' | 'critical' = zScore > 4 ? 'critical' : zScore > 3.5 ? 'high' : zScore > 3 ? 'medium' : 'low';
        const type: 'spike' | 'drop' | 'outlier' | 'pattern_break' = point.value > mean ? 'spike' : 'drop';

        anomalies.push({
          timestamp: point.timestamp,
          value: point.value,
          severity,
          type,
          description: `${type === 'spike' ? 'Unusual spike' : 'Unusual drop'} detected (${zScore.toFixed(1)}σ from mean)`,
          confidence: Math.min(0.95, zScore / 4)
        });
      }
    }

    return anomalies;
  }

  private identifyPatterns(data: TimeSeriesData[]): Array<{
    name: string;
    description: string;
    frequency: number;
    lastSeen: number;
  }> {
    // Simple pattern identification - could be enhanced with more sophisticated algorithms
    const patterns = [];

    if (data.length >= 24) {
      const hourlyAverages = this.calculateHourlyAverages(data);
      const peakHour = hourlyAverages.indexOf(Math.max(...hourlyAverages));

      patterns.push({
        name: 'Daily Peak Pattern',
        description: `Peak usage typically occurs around hour ${peakHour}`,
        frequency: 1.0, // daily
        lastSeen: Date.now()
      });
    }

    return patterns;
  }

  private calculateHourlyAverages(data: TimeSeriesData[]): number[] {
    const hourlyBuckets: number[][] = Array(24).fill(0).map(() => []);

    data.forEach(point => {
      const hour = new Date(point.timestamp).getHours();
      hourlyBuckets[hour].push(point.value);
    });

    return hourlyBuckets.map(bucket =>
      bucket.length === 0 ? 0 : bucket.reduce((a, b) => a + b, 0) / bucket.length
    );
  }

  private generateRecommendations(): Array<{
    type: 'optimization' | 'scaling' | 'maintenance' | 'business';
    priority: 'low' | 'medium' | 'high' | 'critical';
    title: string;
    description: string;
    impact: string;
    effort: 'low' | 'medium' | 'high';
    expectedRoi?: number;
  }> {
    const recommendations = [];

    // Analyze current metrics and generate recommendations
    if (this.businessMetrics.errorRate > 0.05) {
      recommendations.push({
        type: 'optimization' as const,
        priority: 'high' as const,
        title: 'Reduce Error Rate',
        description: `Current error rate is ${(this.businessMetrics.errorRate * 100).toFixed(1)}%, which is above the 5% threshold`,
        impact: 'Improve user experience and system reliability',
        effort: 'medium' as const,
        expectedRoi: 0.15
      });
    }

    if (this.businessMetrics.averageResponseTime > 1000) {
      recommendations.push({
        type: 'optimization' as const,
        priority: 'medium' as const,
        title: 'Optimize Response Times',
        description: `Average response time is ${this.businessMetrics.averageResponseTime}ms, consider optimization`,
        impact: 'Better user experience and increased throughput',
        effort: 'medium' as const,
        expectedRoi: 0.12
      });
    }

    return recommendations;
  }

  private generateAlerts(): Array<{
    id: string;
    type: 'performance' | 'capacity' | 'security' | 'business';
    severity: 'info' | 'warning' | 'error' | 'critical';
    message: string;
    timestamp: number;
    actionRequired: boolean;
  }> {
    const alerts = [];
    const now = Date.now();

    // Generate alerts based on current metrics
    if (this.businessMetrics.errorRate > 0.1) {
      alerts.push({
        id: `error-rate-${now}`,
        type: 'performance' as const,
        severity: 'critical' as const,
        message: `Error rate critically high: ${(this.businessMetrics.errorRate * 100).toFixed(1)}%`,
        timestamp: now,
        actionRequired: true
      });
    }

    if (this.businessMetrics.throughput < 1) {
      alerts.push({
        id: `low-throughput-${now}`,
        type: 'performance' as const,
        severity: 'warning' as const,
        message: 'Low throughput detected, consider investigating performance',
        timestamp: now,
        actionRequired: false
      });
    }

    return alerts;
  }

  private generateMetricForecast(metric: string, points: number): TimeSeriesData[] {
    const trend = this.analyzeTrend(metric, 1);
    return trend?.forecast.slice(0, points) || [];
  }

  private updateBusinessMetrics(metric: string, value: number, _metadata?: Record<string, string | number | boolean>): void {
    // Update business metrics based on incoming data
    switch (metric) {
      case 'total_requests':
        this.businessMetrics.totalRequests = value;
        break;
      case 'response_time':
        this.businessMetrics.averageResponseTime = value;
        break;
      case 'error_rate':
        this.businessMetrics.errorRate = value;
        break;
      case 'throughput':
        this.businessMetrics.throughput = value;
        break;
    }
  }

  private startAnalyticsLoop(): void {
    // Start background analytics processing
    setInterval(() => {
      this.performBackgroundAnalytics();
    }, 60000); // Every minute
  }

  private performBackgroundAnalytics(): void {
    // Background processing for continuous analytics
    const metrics = this.getAvailableMetrics();

    metrics.forEach(metric => {
      const anomalies = this.detectAnomalies(metric);
      if (anomalies.anomalies.length > 0) {
        this.anomaliesHistory.push(anomalies);
        // Keep only recent history
        this.anomaliesHistory = this.anomaliesHistory.slice(-100);
      }
    });
  }
}

// Singleton instance
let analyticsEngine: AnalyticsEngine | null = null;

export function getAnalyticsEngine(): AnalyticsEngine {
  if (!analyticsEngine) {
    analyticsEngine = new AnalyticsEngine();
  }
  return analyticsEngine;
}
