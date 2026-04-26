/**
 * API Feedback Routes — Webhook and external connector management.
 *
 * Manages outbound webhooks and external service connectors that provide
 * feedback / integration channels for the APIIntegration coordinator.
 * Depends on UsageManager for request execution.
 */

import type { UsageManager, APIResponse } from './api.usage.routes.js';
import type { APIAuthentication, RetryConfig } from './api.instructions.routes.js';
import { logError } from '../../../services/logger.js';

// ── Type exports ─────────────────────────────────────────────────────────────────────

export interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  events: string[];
  authentication: APIAuthentication;
  headers: Record<string, string>;
  retryConfig: RetryConfig;
  verification: {
    enabled: boolean;
    secret?: string;
    algorithm: 'sha256' | 'sha512';
    headerName: string;
  };
  filters: Array<{
    field: string;
    operator: string;
    value: unknown;
  }>;
}

export interface ExternalConnector {
  id: string;
  name: string;
  type: 'database' | 'queue' | 'storage' | 'monitoring' | 'notification' | 'analytics';
  config: Record<string, unknown>;
  healthCheck: {
    enabled: boolean;
    interval: number;
    timeout: number;
    endpoint?: string;
  };
  status: 'connected' | 'disconnected' | 'error' | 'connecting';
  lastCheck?: number;
  metrics: {
    requestCount: number;
    errorCount: number;
    avgResponseTime: number;
    lastError?: string;
  };
}

// ── FeedbackManager ──────────────────────────────────────────────────────────────────

export class FeedbackManager {
  readonly webhooks: Map<string, WebhookConfig> = new Map();
  readonly connectors: Map<string, ExternalConnector> = new Map();

  constructor(private readonly usageMgr: UsageManager) {
    this.initializeDefaultConnectors();
  }

  private initializeDefaultConnectors(): void {
    const defaultConnectors: ExternalConnector[] = [
      {
        id: 'prometheus_metrics',
        name: 'Prometheus Metrics Collector',
        type: 'monitoring',
        config: {
          url: 'http://localhost:9090',
          scrapeInterval: 15000,
          metrics: ['cpu_usage', 'memory_usage', 'request_rate', 'error_rate']
        },
        healthCheck: { enabled: true, interval: 30000, timeout: 5000, endpoint: '/api/v1/status/buildinfo' },
        status: 'disconnected',
        metrics: { requestCount: 0, errorCount: 0, avgResponseTime: 0 }
      },
      {
        id: 'slack_notifications',
        name: 'Slack Notification Connector',
        type: 'notification',
        config: { webhookUrl: '${SLACK_WEBHOOK_URL}', channel: '#alerts', username: 'Index-Server', iconEmoji: ':robot_face:' },
        healthCheck: { enabled: true, interval: 300000, timeout: 10000 },
        status: 'disconnected',
        metrics: { requestCount: 0, errorCount: 0, avgResponseTime: 0 }
      },
      {
        id: 'elasticsearch_logs',
        name: 'Elasticsearch Log Connector',
        type: 'analytics',
        config: { host: 'localhost', port: 9200, index: 'index-logs', batchSize: 100, flushInterval: 5000 },
        healthCheck: { enabled: true, interval: 60000, timeout: 5000, endpoint: '/_cluster/health' },
        status: 'disconnected',
        metrics: { requestCount: 0, errorCount: 0, avgResponseTime: 0 }
      }
    ];

    defaultConnectors.forEach(connector => {
      this.connectors.set(connector.id, connector);
    });
  }

  async performHealthChecks(): Promise<void> {
    const promises = Array.from(this.connectors.entries()).map(async ([_id, connector]) => {
      if (!connector.healthCheck.enabled) return;
      const now = Date.now();
      if (connector.lastCheck && now - connector.lastCheck < connector.healthCheck.interval) return;
      try {
        connector.status = 'connecting';
        await this.performConnectorHealthCheck(connector);
        connector.status = 'connected';
        connector.lastCheck = now;
      } catch (error) {
        connector.status = 'error';
        connector.metrics.lastError = error instanceof Error ? error.message : 'Unknown error';
        connector.lastCheck = now;
      }
    });
    await Promise.allSettled(promises);
  }

  private async performConnectorHealthCheck(_connector: ExternalConnector): Promise<void> {
    await this.usageMgr.sleep(Math.random() * 1000 + 100);
    if (Math.random() < 0.1) throw new Error('Health check failed');
  }

  createWebhook(webhook: Omit<WebhookConfig, 'id'>): string {
    const id = `webhook_${Date.now()}`;
    const fullWebhook: WebhookConfig = { id, ...webhook };
    this.webhooks.set(id, fullWebhook);
    return id;
  }

  async triggerWebhook(id: string, event: string, data: unknown): Promise<boolean> {
    const webhook = this.webhooks.get(id);
    if (!webhook || !webhook.events.includes(event)) return false;

    if (webhook.filters.length > 0) {
      const passesFilters = webhook.filters.every(filter => this.evaluateWebhookFilter(data, filter));
      if (!passesFilters) return false;
    }

    try {
      const payload = { event, timestamp: Date.now(), data };
      const response = await this.executeWebhookRequest(webhook, payload);
      return response.status >= 200 && response.status < 300;
    } catch (error) {
      logError('Webhook execution error:', error);
      return false;
    }
  }

  async executeWebhookRequest(webhook: WebhookConfig, payload: unknown): Promise<APIResponse> {
    const request = {
      id: `webhook_${Date.now()}`,
      endpointId: webhook.id,
      method: 'POST',
      url: webhook.url,
      headers: { ...webhook.headers, 'Content-Type': 'application/json' } as Record<string, string>,
      body: payload,
      timestamp: Date.now(),
      timeout: 10000
    };

    this.usageMgr.applyAuthentication(request, webhook.authentication);

    if (webhook.verification.enabled && webhook.verification.secret) {
      const signature = this.generateWebhookSignature(payload, webhook.verification);
      request.headers[webhook.verification.headerName] = signature;
    }

    return this.usageMgr.executeWithRetry(request, webhook.retryConfig);
  }

  private generateWebhookSignature(payload: unknown, verification: WebhookConfig['verification']): string {
    const payloadString = JSON.stringify(payload);
    return `${verification.algorithm}=${Buffer.from(payloadString + verification.secret).toString('base64')}`;
  }

  private evaluateWebhookFilter(data: unknown, filter: { field: string; operator: string; value: unknown }): boolean {
    if (!data || typeof data !== 'object') return false;

    const getNestedValue = (obj: Record<string, unknown>, path: string): unknown =>
      path.split('.').reduce((current: unknown, key: string) =>
        current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined,
        obj as unknown);

    const fieldValue = getNestedValue(data as Record<string, unknown>, filter.field);
    switch (filter.operator) {
      case 'equals': return fieldValue === filter.value;
      case 'not_equals': return fieldValue !== filter.value;
      case 'contains': return String(fieldValue).includes(String(filter.value));
      default: return true;
    }
  }

  createConnector(connector: Omit<ExternalConnector, 'id' | 'status' | 'metrics'>): string {
    const id = `connector_${Date.now()}`;
    const fullConnector: ExternalConnector = {
      id,
      ...connector,
      status: 'disconnected',
      metrics: { requestCount: 0, errorCount: 0, avgResponseTime: 0 }
    };
    this.connectors.set(id, fullConnector);
    return id;
  }

  getConnectorStatus(id: string): ExternalConnector | undefined {
    return this.connectors.get(id);
  }

  listConnectors(): ExternalConnector[] {
    return Array.from(this.connectors.values());
  }

  getStats(): { webhookCount: number; connectorCount: number; activeConnections: number; totalRequests: number; totalErrors: number } {
    const connectors = Array.from(this.connectors.values());
    return {
      webhookCount: this.webhooks.size,
      connectorCount: this.connectors.size,
      activeConnections: connectors.filter(c => c.status === 'connected').length,
      totalRequests: connectors.reduce((sum, c) => sum + c.metrics.requestCount, 0),
      totalErrors: connectors.reduce((sum, c) => sum + c.metrics.errorCount, 0)
    };
  }
}
