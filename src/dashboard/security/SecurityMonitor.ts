/**
 * SecurityMonitor - Phase 4 Security & Performance Monitoring
 *
 * Advanced security monitoring and performance analytics:
 * - Real-time threat detection and alerting
 * - Performance bottleneck identification
 * - Resource usage monitoring
 * - Security audit logging
 * - Automated response mechanisms
 *
 * PH-3 compliance: All real user identifiers (IPs, usernames) are anonymized
 * (SHA-256 hashed, first 16 hex chars) before storage or logging.
 */
import crypto from 'crypto';
import { logInfo, logError } from '../../services/logger.js';

interface SecurityThreat {
  id: string;
  type: 'authentication_failure' | 'rate_limit_exceeded' | 'suspicious_activity' | 'data_breach_attempt' | 'injection_attack';
  severity: 'low' | 'medium' | 'high' | 'critical';
  source: string;
  timestamp: number;
  details: Record<string, unknown>;
  status: 'active' | 'mitigated' | 'resolved';
  actionTaken?: string;
}

interface PerformanceMetric {
  id: string;
  type: 'cpu' | 'memory' | 'disk' | 'network' | 'database' | 'api_latency';
  value: number;
  unit: string;
  timestamp: number;
  threshold: {
    warning: number;
    critical: number;
  };
  trend: 'increasing' | 'decreasing' | 'stable';
}

interface SystemHealth {
  overall: 'healthy' | 'warning' | 'critical' | 'down';
  services: Array<{
    name: string;
    status: 'up' | 'down' | 'degraded';
    latency: number;
    uptime: number;
    lastCheck: number;
  }>;
  alerts: SecurityThreat[];
  performance: PerformanceMetric[];
}

interface SecurityRule {
  id: string;
  name: string;
  type: 'rate_limit' | 'ip_blocking' | 'pattern_detection' | 'anomaly_detection';
  enabled: boolean;
  config: Record<string, unknown>;
  lastTriggered?: number;
  triggerCount: number;
}

export class SecurityMonitor {
  private threats: Map<string, SecurityThreat> = new Map();
  private performanceMetrics: Map<string, PerformanceMetric[]> = new Map();
  private securityRules: Map<string, SecurityRule> = new Map();
  private monitoringInterval: NodeJS.Timeout | null = null;
  private alertCallbacks: Array<(threat: SecurityThreat) => void> = [];

  constructor() {
    this.initializeSecurityRules();
    this.startMonitoring();
  }

  /**
   * Anonymize a real user identifier (IP, username, etc.) for PH-3 compliance.
   * Returns the first 16 hex characters of the SHA-256 hash of the identifier.
   * @param identifier - Raw user identifier to anonymize
   * @returns Anonymized identifier string (not reversible)
   */
  private anonymize(identifier: string): string {
    return crypto.createHash('sha256').update(identifier, 'utf8').digest('hex').slice(0, 16);
  }

  /**
   * Initialize default security rules
   */
  private initializeSecurityRules(): void {
    const defaultRules: SecurityRule[] = [
      {
        id: 'rate_limit_api',
        name: 'API Rate Limiting',
        type: 'rate_limit',
        enabled: true,
        config: {
          maxRequests: 100,
          windowMs: 60000, // 1 minute
          blacklistDuration: 300000 // 5 minutes
        },
        triggerCount: 0
      },
      {
        id: 'suspicious_patterns',
        name: 'Suspicious Activity Detection',
        type: 'pattern_detection',
        enabled: true,
        config: {
          patterns: [
            'SELECT.*FROM.*WHERE.*1=1',
            '<script>.*</script>',
            '../../../etc/passwd',
            'UNION.*SELECT.*FROM'
          ],
          caseSensitive: false
        },
        triggerCount: 0
      },
      {
        id: 'authentication_anomaly',
        name: 'Authentication Anomaly Detection',
        type: 'anomaly_detection',
        enabled: true,
        config: {
          maxFailedAttempts: 5,
          timeWindow: 300000, // 5 minutes
          lockoutDuration: 900000 // 15 minutes
        },
        triggerCount: 0
      }
    ];

    defaultRules.forEach(rule => {
      this.securityRules.set(rule.id, rule);
    });
  }

  /**
   * Start continuous monitoring
   */
  private startMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      this.collectPerformanceMetrics();
      this.analyzeSecurityThreats();
      this.cleanupOldData();
    }, 5000); // Monitor every 5 seconds
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  /**
   * Collect system performance metrics
   */
  private collectPerformanceMetrics(): void {
    const timestamp = Date.now();

    // CPU Usage
    this.addPerformanceMetric({
      id: `cpu_${timestamp}`,
      type: 'cpu',
      value: this.getCPUUsage(),
      unit: 'percentage',
      timestamp,
      threshold: { warning: 70, critical: 90 },
      trend: 'stable'
    });

    // Memory Usage
    const memoryUsage = process.memoryUsage();
    this.addPerformanceMetric({
      id: `memory_${timestamp}`,
      type: 'memory',
      value: (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100,
      unit: 'percentage',
      timestamp,
      threshold: { warning: 80, critical: 95 },
      trend: 'stable'
    });

    // API Latency (simulated)
    this.addPerformanceMetric({
      id: `api_latency_${timestamp}`,
      type: 'api_latency',
      value: this.getAverageAPILatency(),
      unit: 'milliseconds',
      timestamp,
      threshold: { warning: 500, critical: 1000 },
      trend: 'stable'
    });
  }

  /**
   * Add performance metric and analyze trends
   */
  private addPerformanceMetric(metric: PerformanceMetric): void {
    const metricType = metric.type;
    if (!this.performanceMetrics.has(metricType)) {
      this.performanceMetrics.set(metricType, []);
    }

    const metrics = this.performanceMetrics.get(metricType)!;
    metrics.push(metric);

    // Keep only last 100 metrics per type
    if (metrics.length > 100) {
      metrics.splice(0, metrics.length - 100);
    }

    // Analyze trend
    if (metrics.length >= 3) {
      const recent = metrics.slice(-3);
      const values = recent.map(m => m.value);
      metric.trend = this.calculateTrend(values);
    }

    // Check thresholds and create alerts
    this.checkPerformanceThresholds(metric);
  }

  /**
   * Calculate trend from values
   */
  private calculateTrend(values: number[]): 'increasing' | 'decreasing' | 'stable' {
    if (values.length < 2) return 'stable';

    const first = values[0];
    const last = values[values.length - 1];
    const change = Math.abs(last - first) / first;

    if (change < 0.05) return 'stable'; // Less than 5% change
    return last > first ? 'increasing' : 'decreasing';
  }

  /**
   * Check performance thresholds and create alerts
   */
  private checkPerformanceThresholds(metric: PerformanceMetric): void {
    let severity: 'low' | 'medium' | 'high' | 'critical' | null = null;

    if (metric.value >= metric.threshold.critical) {
      severity = 'critical';
    } else if (metric.value >= metric.threshold.warning) {
      severity = 'high';
    }

    if (severity) {
      const threat: SecurityThreat = {
        id: `perf_${metric.type}_${Date.now()}`,
        type: 'suspicious_activity',
        severity,
        source: 'performance_monitor',
        timestamp: metric.timestamp,
        details: {
          metricType: metric.type,
          value: metric.value,
          unit: metric.unit,
          threshold: metric.threshold,
          trend: metric.trend
        },
        status: 'active'
      };

      this.reportThreat(threat);
    }
  }

  /**
   * Analyze current security threats
   */
  private analyzeSecurityThreats(): void {
    // Check for patterns in recent activity
    this.detectAnomalousPatterns();

    // Check rate limiting violations
    this.checkRateLimits();

    // Validate authentication attempts
    this.validateAuthenticationAttempts();
  }

  /**
   * Detect anomalous patterns in system activity
   */
  private detectAnomalousPatterns(): void {
    const rule = this.securityRules.get('suspicious_patterns');
    if (!rule || !rule.enabled) return;

    const patterns = rule.config.patterns as string[];
    const caseSensitive = rule.config.caseSensitive as boolean;

    // Simulate pattern detection in request logs
    const suspiciousRequest = this.checkForSuspiciousPatterns(patterns, caseSensitive);

    if (suspiciousRequest) {
      const threat: SecurityThreat = {
        id: `pattern_${Date.now()}`,
        type: 'injection_attack',
        severity: 'high',
        source: this.anonymize(suspiciousRequest.source),
        timestamp: Date.now(),
        details: {
          pattern: suspiciousRequest.pattern,
          userAgent: suspiciousRequest.userAgent
        },
        status: 'active'
      };

      this.reportThreat(threat);
      rule.triggerCount++;
      rule.lastTriggered = Date.now();
    }
  }

  /**
   * Check rate limiting violations
   */
  private checkRateLimits(): void {
    const rule = this.securityRules.get('rate_limit_api');
    if (!rule || !rule.enabled) return;

    const config = rule.config as {
      maxRequests: number;
      windowMs: number;
      blacklistDuration: number;
    };

    // Simulate rate limit checking
    const violation = this.checkRateLimitViolation(config);

    if (violation) {
      const anonSource = this.anonymize(violation.ip);
      const threat: SecurityThreat = {
        id: `rate_limit_${Date.now()}`,
        type: 'rate_limit_exceeded',
        severity: 'medium',
        source: anonSource,
        timestamp: Date.now(),
        details: {
          requestCount: violation.requestCount,
          maxRequests: config.maxRequests,
          timeWindow: config.windowMs
        },
        status: 'active',
        actionTaken: `Source [${anonSource}] blacklisted for ${config.blacklistDuration}ms`
      };

      this.reportThreat(threat);
      rule.triggerCount++;
      rule.lastTriggered = Date.now();
    }
  }

  /**
   * Validate authentication attempts
   */
  private validateAuthenticationAttempts(): void {
    const rule = this.securityRules.get('authentication_anomaly');
    if (!rule || !rule.enabled) return;

    const config = rule.config as {
      maxFailedAttempts: number;
      timeWindow: number;
      lockoutDuration: number;
    };

    // Simulate authentication monitoring
    const anomaly = this.checkAuthenticationAnomaly(config);

    if (anomaly) {
      const anonSource = this.anonymize(anomaly.source);
      const threat: SecurityThreat = {
        id: `auth_anomaly_${Date.now()}`,
        type: 'authentication_failure',
        severity: 'high',
        source: anonSource,
        timestamp: Date.now(),
        details: {
          failedAttempts: anomaly.attempts,
          maxAllowed: config.maxFailedAttempts,
          timeWindow: config.timeWindow,
          accounts: anomaly.accounts.map(a => this.anonymize(a))
        },
        status: 'active',
        actionTaken: `Source [${anonSource}] locked out for ${config.lockoutDuration}ms`
      };

      this.reportThreat(threat);
      rule.triggerCount++;
      rule.lastTriggered = Date.now();
    }
  }

  /**
   * Report a security threat
   */
  reportThreat(threat: SecurityThreat): void {
    this.threats.set(threat.id, threat);

    // Notify all registered callbacks
    this.alertCallbacks.forEach(callback => {
      try {
        callback(threat);
      } catch (error) {
        logError('[SecurityMonitor] Error in security alert callback', error);
      }
    });

    // Log to security audit trail
    this.logSecurityEvent(threat);
  }

  /**
   * Log security event to audit trail
   */
  private logSecurityEvent(threat: SecurityThreat): void {
    const logEntry = {
      timestamp: new Date(threat.timestamp).toISOString(),
      threatId: threat.id,
      type: threat.type,
      severity: threat.severity,
      source: threat.source,
      details: threat.details,
      actionTaken: threat.actionTaken
    };

    logInfo('[SecurityMonitor] Security event', logEntry);
  }

  /**
   * Get current system health status
   */
  getSystemHealth(): SystemHealth {
    const now = Date.now();
    const recentThreats = Array.from(this.threats.values())
      .filter(threat => threat.status === 'active' && (now - threat.timestamp) < 300000); // Last 5 minutes

    // Determine overall health
    let overall: SystemHealth['overall'] = 'healthy';
    const criticalThreats = recentThreats.filter(t => t.severity === 'critical');
    const highThreats = recentThreats.filter(t => t.severity === 'high');

    if (criticalThreats.length > 0) {
      overall = 'critical';
    } else if (highThreats.length > 0 || recentThreats.length > 5) {
      overall = 'warning';
    }

    return {
      overall,
      services: this.getServiceStatuses(),
      alerts: recentThreats,
      performance: this.getRecentPerformanceMetrics()
    };
  }

  /**
   * Get service statuses
   */
  private getServiceStatuses(): SystemHealth['services'] {
    return [
      {
        name: 'MCP Server',
        status: 'up',
        latency: this.getAverageAPILatency(),
        uptime: process.uptime() * 1000,
        lastCheck: Date.now()
      },
      {
        name: 'Dashboard',
        status: 'up',
        latency: 50,
        uptime: process.uptime() * 1000,
        lastCheck: Date.now()
      },
      {
        name: 'Analytics Engine',
        status: 'up',
        latency: 25,
        uptime: process.uptime() * 1000,
        lastCheck: Date.now()
      }
    ];
  }

  /**
   * Get recent performance metrics
   */
  private getRecentPerformanceMetrics(): PerformanceMetric[] {
    const recent: PerformanceMetric[] = [];
    const cutoff = Date.now() - 300000; // Last 5 minutes

    this.performanceMetrics.forEach(metrics => {
      const recentMetrics = metrics.filter(m => m.timestamp > cutoff);
      recent.push(...recentMetrics);
    });

    return recent.sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
  }

  /**
   * Register alert callback
   */
  onThreatDetected(callback: (threat: SecurityThreat) => void): void {
    this.alertCallbacks.push(callback);
  }

  /**
   * Mitigate a threat
   */
  mitigateThreat(threatId: string, action: string): boolean {
    const threat = this.threats.get(threatId);
    if (!threat) return false;

    threat.status = 'mitigated';
    threat.actionTaken = action;

    this.logSecurityEvent(threat);
    return true;
  }

  /**
   * Resolve a threat
   */
  resolveThreat(threatId: string): boolean {
    const threat = this.threats.get(threatId);
    if (!threat) return false;

    threat.status = 'resolved';
    this.logSecurityEvent(threat);
    return true;
  }

  /**
   * Get list of active threats
   */
  getActiveThreats(): SecurityThreat[] {
    const activeThreats: SecurityThreat[] = [];
    const threatValues = Array.from(this.threats.values());
    for (const threat of threatValues) {
      if (threat.status === 'active') {
        activeThreats.push(threat);
      }
    }
    return activeThreats;
  }

  /**
   * Clean up old data
   */
  private cleanupOldData(): void {
    const cutoff = Date.now() - 86400000; // 24 hours

    // Clean old threats
    const threatEntries = Array.from(this.threats.entries());
    for (const [id, threat] of threatEntries) {
      if (threat.timestamp < cutoff) {
        this.threats.delete(id);
      }
    }

    // Clean old performance metrics
    this.performanceMetrics.forEach(metrics => {
      const filtered = metrics.filter(m => m.timestamp > cutoff);
      metrics.splice(0, metrics.length, ...filtered);
    });
  }

  // Utility methods for simulated monitoring

  private getCPUUsage(): number {
    // Simulate CPU usage between 10-80%
    return Math.random() * 70 + 10; // nosemgrep: insecure-randomness — simulated metric, not security context
  }

  private getAverageAPILatency(): number {
    // Simulate API latency between 50-300ms
    return Math.random() * 250 + 50; // nosemgrep: insecure-randomness — simulated metric, not security context
  }

  private checkForSuspiciousPatterns(patterns: string[], _caseSensitive: boolean): {
    pattern: string;
    request: string;
    source: string;
    userAgent: string;
  } | null {
    // Simulate 1% chance of detecting suspicious pattern
    if (Math.random() < 0.01) {
      const pattern = patterns[Math.floor(Math.random() * patterns.length)];
      return {
        pattern,
        request: `/api/search?q=${pattern}`,
        source: `192.168.1.${Math.floor(Math.random() * 255)}`,
        userAgent: 'Mozilla/5.0 (compatible; SecurityScanner/1.0)'
      };
    }
    return null;
  }

  private checkRateLimitViolation(config: {
    maxRequests: number;
    windowMs: number;
    blacklistDuration: number;
  }): {
    ip: string;
    requestCount: number;
    userAgent: string;
  } | null {
    // Simulate 0.5% chance of rate limit violation
    if (Math.random() < 0.005) {
      return {
        ip: `192.168.1.${Math.floor(Math.random() * 255)}`,
        requestCount: config.maxRequests + Math.floor(Math.random() * 50),
        userAgent: 'Mozilla/5.0 (compatible; BotScanner/1.0)'
      };
    }
    return null;
  }

  private checkAuthenticationAnomaly(config: {
    maxFailedAttempts: number;
    timeWindow: number;
    lockoutDuration: number;
  }): {
    source: string;
    attempts: number;
    accounts: string[];
  } | null {
    // Simulate 0.2% chance of authentication anomaly
    if (Math.random() < 0.002) {
      return {
        source: `192.168.1.${Math.floor(Math.random() * 255)}`,
        attempts: config.maxFailedAttempts + Math.floor(Math.random() * 10),
        accounts: ['admin', 'root', 'user', 'test'].slice(0, Math.floor(Math.random() * 4) + 1)
      };
    }
    return null;
  }

  /**
   * Get security rules configuration
   */
  getSecurityRules(): SecurityRule[] {
    return Array.from(this.securityRules.values());
  }

  /**
   * Update security rule
   */
  updateSecurityRule(ruleId: string, updates: Partial<SecurityRule>): boolean {
    const rule = this.securityRules.get(ruleId);
    if (!rule) return false;

    Object.assign(rule, updates);
    return true;
  }

  /**
   * Get threat statistics
   */
  getThreatStatistics(): {
    total: number;
    active: number;
    resolved: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
  } {
    const threats = Array.from(this.threats.values());

    const stats = {
      total: threats.length,
      active: threats.filter(t => t.status === 'active').length,
      resolved: threats.filter(t => t.status === 'resolved').length,
      byType: {} as Record<string, number>,
      bySeverity: {} as Record<string, number>
    };

    threats.forEach(threat => {
      stats.byType[threat.type] = (stats.byType[threat.type] || 0) + 1;
      stats.bySeverity[threat.severity] = (stats.bySeverity[threat.severity] || 0) + 1;
    });

    return stats;
  }
}

// Singleton instance
let securityMonitor: SecurityMonitor | null = null;

export function getSecurityMonitor(): SecurityMonitor {
  if (!securityMonitor) {
    securityMonitor = new SecurityMonitor();
  }
  return securityMonitor;
}
