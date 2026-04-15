/**
 * BusinessIntelligence - Phase 3 Advanced BI Components
 *
 * Comprehensive business intelligence dashboard components providing:
 * - Executive dashboards with KPI visualizations
 * - Advanced charting and data visualization
 * - Interactive reporting and drill-down capabilities
 * - Real-time business metrics monitoring
 */

import { getAnalyticsEngine } from './AnalyticsEngine.js';

export interface KPIWidget {
  id: string;
  title: string;
  value: number | string;
  previousValue?: number | string;
  trend: 'up' | 'down' | 'stable';
  trendPercentage: number;
  format: 'number' | 'percentage' | 'currency' | 'duration' | 'bytes';
  color: 'success' | 'warning' | 'danger' | 'info' | 'primary';
  icon: string;
  description?: string;
}

export interface ChartConfiguration {
  id: string;
  type: 'line' | 'bar' | 'doughnut' | 'radar' | 'scatter' | 'area' | 'heatmap';
  title: string;
  data: ChartDataset[];
  options: ChartOptions;
  responsive: boolean;
  realTime: boolean;
}

export interface ChartDataset {
  label: string;
  data: Array<{x: number | string; y: number}>;
  backgroundColor?: string | string[];
  borderColor?: string;
  borderWidth?: number;
  fill?: boolean;
  tension?: number;
}

export interface ChartOptions {
  responsive: boolean;
  maintainAspectRatio: boolean;
  plugins: {
    legend: {
      display: boolean;
      position: 'top' | 'bottom' | 'left' | 'right';
    };
    title: {
      display: boolean;
      text: string;
    };
    tooltip: {
      enabled: boolean;
      mode: 'index' | 'point' | 'dataset';
    };
  };
  scales?: {
    x: {
      type: 'linear' | 'time' | 'category';
      display: boolean;
      title: {
        display: boolean;
        text: string;
      };
    };
    y: {
      type: 'linear' | 'logarithmic';
      display: boolean;
      beginAtZero: boolean;
      title: {
        display: boolean;
        text: string;
      };
    };
  };
  animation?: {
    duration: number;
    easing: 'linear' | 'easeInQuad' | 'easeOutQuad';
  };
}

export interface DashboardLayout {
  sections: DashboardSection[];
  theme: 'light' | 'dark' | 'auto';
  layout: 'grid' | 'masonry' | 'flex';
  columns: number;
  refreshInterval: number; // milliseconds
}

export interface DashboardSection {
  id: string;
  title: string;
  type: 'kpi' | 'chart' | 'table' | 'alert' | 'text' | 'custom';
  position: { row: number; col: number; width: number; height: number };
  config: KPIWidget | ChartConfiguration | TableConfiguration | AlertConfiguration;
  visible: boolean;
  minimized: boolean;
}

export interface TableConfiguration {
  id: string;
  title: string;
  columns: Array<{
    key: string;
    label: string;
    type: 'text' | 'number' | 'date' | 'badge' | 'progress';
    sortable: boolean;
    filterable: boolean;
  }>;
  data: Record<string, unknown>[];
  pagination: {
    enabled: boolean;
    pageSize: number;
    currentPage: number;
  };
  search: {
    enabled: boolean;
    placeholder: string;
  };
}

export interface AlertConfiguration {
  id: string;
  title: string;
  alerts: Array<{
    id: string;
    message: string;
    severity: 'info' | 'warning' | 'error' | 'critical';
    timestamp: number;
    acknowledged: boolean;
    actionUrl?: string;
  }>;
  maxVisible: number;
  autoRefresh: boolean;
}

export class BusinessIntelligence {
  private analyticsEngine = getAnalyticsEngine();
  private dashboardLayouts: Map<string, DashboardLayout> = new Map();
  private realtimeSubscriptions: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    this.initializeDefaultDashboards();
  }

  /**
   * Generate KPI widgets based on current business metrics
   */
  generateKPIWidgets(): KPIWidget[] {
    const metrics = this.analyticsEngine.getBusinessMetrics();
    const widgets: KPIWidget[] = [];

    // Total Requests KPI
    widgets.push({
      id: 'total-requests',
      title: 'Total Requests',
      value: this.formatNumber(metrics.totalRequests),
      trend: this.calculateTrend('total_requests'),
      trendPercentage: this.calculateTrendPercentage('total_requests'),
      format: 'number',
      color: 'primary',
      icon: 'activity',
      description: 'Total number of requests processed'
    });

    // Success Rate KPI
    widgets.push({
      id: 'success-rate',
      title: 'Success Rate',
      value: `${(metrics.successRate * 100).toFixed(1)}%`,
      trend: this.calculateTrend('success_rate'),
      trendPercentage: this.calculateTrendPercentage('success_rate'),
      format: 'percentage',
      color: metrics.successRate > 0.95 ? 'success' : metrics.successRate > 0.9 ? 'warning' : 'danger',
      icon: 'check-circle',
      description: 'Percentage of successful requests'
    });

    // Average Response Time KPI
    widgets.push({
      id: 'avg-response-time',
      title: 'Avg Response Time',
      value: `${metrics.averageResponseTime.toFixed(0)}ms`,
      trend: this.calculateTrend('response_time'),
      trendPercentage: this.calculateTrendPercentage('response_time'),
      format: 'duration',
      color: metrics.averageResponseTime < 500 ? 'success' : metrics.averageResponseTime < 1000 ? 'warning' : 'danger',
      icon: 'clock',
      description: 'Average response time for requests'
    });

    // Throughput KPI
    widgets.push({
      id: 'throughput',
      title: 'Throughput',
      value: `${metrics.throughput.toFixed(1)} req/s`,
      trend: this.calculateTrend('throughput'),
      trendPercentage: this.calculateTrendPercentage('throughput'),
      format: 'number',
      color: 'info',
      icon: 'trending-up',
      description: 'Requests processed per second'
    });

    // Error Rate KPI
    widgets.push({
      id: 'error-rate',
      title: 'Error Rate',
      value: `${(metrics.errorRate * 100).toFixed(2)}%`,
      trend: this.calculateTrend('error_rate'),
      trendPercentage: this.calculateTrendPercentage('error_rate'),
      format: 'percentage',
      color: metrics.errorRate < 0.01 ? 'success' : metrics.errorRate < 0.05 ? 'warning' : 'danger',
      icon: 'alert-triangle',
      description: 'Percentage of failed requests'
    });

    return widgets;
  }

  /**
   * Generate advanced chart configurations
   */
  generateChartConfigurations(): ChartConfiguration[] {
    const charts: ChartConfiguration[] = [];

    // Real-time Requests Chart
    charts.push({
      id: 'realtime-requests',
      type: 'line',
      title: 'Real-time Request Volume',
      data: [{
        label: 'Requests per Minute',
        data: this.getTimeSeriesChartData('requests_per_minute', 60),
        borderColor: '#3B82F6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4
      }],
      options: this.createTimeSeriesChartOptions('Requests per Minute', 'Time', 'Requests'),
      responsive: true,
      realTime: true
    });

    // Response Time Distribution
    charts.push({
      id: 'response-time-distribution',
      type: 'bar',
      title: 'Response Time Distribution',
      data: [{
        label: 'Response Times',
        data: this.getResponseTimeDistributionData(),
        backgroundColor: [
          '#10B981', // < 100ms
          '#F59E0B', // 100-500ms
          '#EF4444', // 500-1000ms
          '#8B5CF6'  // > 1000ms
        ],
        borderWidth: 1
      }],
      options: this.createBarChartOptions('Response Time Distribution', 'Response Time Range', 'Count'),
      responsive: true,
      realTime: false
    });

    // Top Tools Usage
    charts.push({
      id: 'top-tools-usage',
      type: 'doughnut',
      title: 'Top Tools Usage',
      data: [{
        label: 'Tool Usage',
        data: this.getTopToolsData(),
        backgroundColor: [
          '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
          '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1'
        ],
        borderWidth: 2
      }],
      options: this.createDoughnutChartOptions('Top Tools Usage'),
      responsive: true,
      realTime: true
    });

    // Performance Trend Analysis
    charts.push({
      id: 'performance-trends',
      type: 'area',
      title: 'Performance Trends (24h)',
      data: [
        {
          label: 'Response Time (ms)',
          data: this.getTimeSeriesChartData('response_time', 24 * 60),
          borderColor: '#EF4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          borderWidth: 2,
          fill: true
        },
        {
          label: 'Success Rate (%)',
          data: this.getTimeSeriesChartData('success_rate', 24 * 60),
          borderColor: '#10B981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          borderWidth: 2,
          fill: true
        }
      ],
      options: this.createMultiAxisChartOptions('Performance Trends', 'Time', 'Value'),
      responsive: true,
      realTime: true
    });

    return charts;
  }

  /**
   * Create executive dashboard layout
   */
  createExecutiveDashboard(): DashboardLayout {
    return {
      sections: [
        // KPI Row
        {
          id: 'kpi-total-requests',
          title: 'Total Requests',
          type: 'kpi',
          position: { row: 0, col: 0, width: 2, height: 1 },
          config: this.generateKPIWidgets()[0],
          visible: true,
          minimized: false
        },
        {
          id: 'kpi-success-rate',
          title: 'Success Rate',
          type: 'kpi',
          position: { row: 0, col: 2, width: 2, height: 1 },
          config: this.generateKPIWidgets()[1],
          visible: true,
          minimized: false
        },
        {
          id: 'kpi-response-time',
          title: 'Response Time',
          type: 'kpi',
          position: { row: 0, col: 4, width: 2, height: 1 },
          config: this.generateKPIWidgets()[2],
          visible: true,
          minimized: false
        },

        // Main Charts Row
        {
          id: 'chart-realtime-requests',
          title: 'Real-time Requests',
          type: 'chart',
          position: { row: 1, col: 0, width: 4, height: 2 },
          config: this.generateChartConfigurations()[0],
          visible: true,
          minimized: false
        },
        {
          id: 'chart-top-tools',
          title: 'Top Tools',
          type: 'chart',
          position: { row: 1, col: 4, width: 2, height: 2 },
          config: this.generateChartConfigurations()[2],
          visible: true,
          minimized: false
        },

        // Performance Analysis Row
        {
          id: 'chart-performance-trends',
          title: 'Performance Trends',
          type: 'chart',
          position: { row: 3, col: 0, width: 6, height: 2 },
          config: this.generateChartConfigurations()[3],
          visible: true,
          minimized: false
        }
      ],
      theme: 'auto',
      layout: 'grid',
      columns: 6,
      refreshInterval: 30000 // 30 seconds
    };
  }

  /**
   * Create operational dashboard layout
   */
  createOperationalDashboard(): DashboardLayout {
    return {
      sections: [
        // Alerts Section
        {
          id: 'alerts-section',
          title: 'System Alerts',
          type: 'alert',
          position: { row: 0, col: 0, width: 3, height: 2 },
          config: this.generateAlertConfiguration(),
          visible: true,
          minimized: false
        },

        // Response Time Analysis
        {
          id: 'response-time-analysis',
          title: 'Response Time Analysis',
          type: 'chart',
          position: { row: 0, col: 3, width: 3, height: 2 },
          config: this.generateChartConfigurations()[1],
          visible: true,
          minimized: false
        },

        // Detailed Metrics Table
        {
          id: 'metrics-table',
          title: 'Detailed Metrics',
          type: 'table',
          position: { row: 2, col: 0, width: 6, height: 3 },
          config: this.generateMetricsTable(),
          visible: true,
          minimized: false
        }
      ],
      theme: 'auto',
      layout: 'grid',
      columns: 6,
      refreshInterval: 15000 // 15 seconds
    };
  }

  /**
   * Get dashboard layout by name
   */
  getDashboardLayout(name: string): DashboardLayout | null {
    return this.dashboardLayouts.get(name) || null;
  }

  /**
   * Subscribe to real-time updates for a dashboard
   */
  subscribeToRealTimeUpdates(dashboardId: string, callback: (data: unknown) => void): string {
    const subscriptionId = `${dashboardId}-${Date.now()}`;

    const interval = setInterval(() => {
      const updateData = {
        kpis: this.generateKPIWidgets(),
        charts: this.generateChartConfigurations(),
        timestamp: Date.now()
      };
      callback(updateData);
    }, 5000); // Update every 5 seconds

    this.realtimeSubscriptions.set(subscriptionId, interval);
    return subscriptionId;
  }

  /**
   * Unsubscribe from real-time updates
   */
  unsubscribeFromRealTimeUpdates(subscriptionId: string): void {
    const interval = this.realtimeSubscriptions.get(subscriptionId);
    if (interval) {
      clearInterval(interval);
      this.realtimeSubscriptions.delete(subscriptionId);
    }
  }

  // Private helper methods

  private initializeDefaultDashboards(): void {
    this.dashboardLayouts.set('executive', this.createExecutiveDashboard());
    this.dashboardLayouts.set('operational', this.createOperationalDashboard());
  }

  private formatNumber(value: number): string {
    if (value >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      return `${(value / 1000).toFixed(1)}K`;
    }
    return value.toString();
  }

  private calculateTrend(metric: string): 'up' | 'down' | 'stable' {
    const trend = this.analyticsEngine.analyzeTrend(metric, 1);
    if (!trend) return 'stable';

    switch (trend.trend) {
      case 'increasing': return 'up';
      case 'decreasing': return 'down';
      default: return 'stable';
    }
  }

  private calculateTrendPercentage(metric: string): number {
    const trend = this.analyticsEngine.analyzeTrend(metric, 1);
    if (!trend) return 0;

    // Convert slope to percentage change
    return Math.abs(trend.slope * 100);
  }

  private getTimeSeriesChartData(metric: string, minutes: number): Array<{x: number; y: number}> {
    const data = this.analyticsEngine.getTimeSeriesData(metric, minutes / 60);
    return data.map(point => ({
      x: point.timestamp,
      y: point.value
    }));
  }

  private getResponseTimeDistributionData(): Array<{x: string; y: number}> {
    // Simulated response time distribution data
    return [
      { x: '< 100ms', y: 150 },
      { x: '100-500ms', y: 300 },
      { x: '500-1000ms', y: 75 },
      { x: '> 1000ms', y: 25 }
    ];
  }

  private getTopToolsData(): Array<{x: string; y: number}> {
    const metrics = this.analyticsEngine.getBusinessMetrics();
    return metrics.topTools.map(tool => ({
      x: tool.name,
      y: tool.usage
    }));
  }

  private createTimeSeriesChartOptions(title: string, xLabel: string, yLabel: string): ChartOptions {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top'
        },
        title: {
          display: true,
          text: title
        },
        tooltip: {
          enabled: true,
          mode: 'index'
        }
      },
      scales: {
        x: {
          type: 'time',
          display: true,
          title: {
            display: true,
            text: xLabel
          }
        },
        y: {
          type: 'linear',
          display: true,
          beginAtZero: true,
          title: {
            display: true,
            text: yLabel
          }
        }
      },
      animation: {
        duration: 300,
        easing: 'easeOutQuad'
      }
    };
  }

  private createBarChartOptions(title: string, xLabel: string, yLabel: string): ChartOptions {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
          position: 'top'
        },
        title: {
          display: true,
          text: title
        },
        tooltip: {
          enabled: true,
          mode: 'point'
        }
      },
      scales: {
        x: {
          type: 'category',
          display: true,
          title: {
            display: true,
            text: xLabel
          }
        },
        y: {
          type: 'linear',
          display: true,
          beginAtZero: true,
          title: {
            display: true,
            text: yLabel
          }
        }
      }
    };
  }

  private createDoughnutChartOptions(title: string): ChartOptions {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'right'
        },
        title: {
          display: true,
          text: title
        },
        tooltip: {
          enabled: true,
          mode: 'point'
        }
      }
    };
  }

  private createMultiAxisChartOptions(title: string, xLabel: string, yLabel: string): ChartOptions {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top'
        },
        title: {
          display: true,
          text: title
        },
        tooltip: {
          enabled: true,
          mode: 'index'
        }
      },
      scales: {
        x: {
          type: 'time',
          display: true,
          title: {
            display: true,
            text: xLabel
          }
        },
        y: {
          type: 'linear',
          display: true,
          beginAtZero: true,
          title: {
            display: true,
            text: yLabel
          }
        }
      }
    };
  }

  private generateAlertConfiguration(): AlertConfiguration {
    const insights = this.analyticsEngine.generateInsights();

    return {
      id: 'system-alerts',
      title: 'System Alerts',
      alerts: insights.alerts.map(alert => ({
        id: alert.id,
        message: alert.message,
        severity: alert.severity,
        timestamp: alert.timestamp,
        acknowledged: false,
        actionUrl: alert.actionRequired ? '/dashboard/actions' : undefined
      })),
      maxVisible: 10,
      autoRefresh: true
    };
  }

  private generateMetricsTable(): TableConfiguration {
    const metrics = this.analyticsEngine.getBusinessMetrics();

    return {
      id: 'metrics-table',
      title: 'System Metrics Overview',
      columns: [
        { key: 'metric', label: 'Metric', type: 'text', sortable: true, filterable: true },
        { key: 'current', label: 'Current Value', type: 'text', sortable: true, filterable: false },
        { key: 'trend', label: 'Trend', type: 'badge', sortable: true, filterable: true },
        { key: 'status', label: 'Status', type: 'badge', sortable: true, filterable: true }
      ],
      data: [
        {
          metric: 'Total Requests',
          current: this.formatNumber(metrics.totalRequests),
          trend: this.calculateTrend('total_requests'),
          status: 'healthy'
        },
        {
          metric: 'Success Rate',
          current: `${(metrics.successRate * 100).toFixed(1)}%`,
          trend: this.calculateTrend('success_rate'),
          status: metrics.successRate > 0.95 ? 'healthy' : 'warning'
        },
        {
          metric: 'Average Response Time',
          current: `${metrics.averageResponseTime.toFixed(0)}ms`,
          trend: this.calculateTrend('response_time'),
          status: metrics.averageResponseTime < 500 ? 'healthy' : 'warning'
        },
        {
          metric: 'Error Rate',
          current: `${(metrics.errorRate * 100).toFixed(2)}%`,
          trend: this.calculateTrend('error_rate'),
          status: metrics.errorRate < 0.01 ? 'healthy' : 'critical'
        }
      ],
      pagination: {
        enabled: false,
        pageSize: 10,
        currentPage: 1
      },
      search: {
        enabled: true,
        placeholder: 'Search metrics...'
      }
    };
  }
}

// Singleton instance
let businessIntelligence: BusinessIntelligence | null = null;

export function getBusinessIntelligence(): BusinessIntelligence {
  if (!businessIntelligence) {
    businessIntelligence = new BusinessIntelligence();
  }
  return businessIntelligence;
}
