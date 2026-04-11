/**
 * APIIntegration - Phase 4 API Integration & External Connectors
 *
 * Thin coordinator that composes three domain modules:
 * - EndpointManager  (api.instructions.routes) — endpoint configuration & rate-limiting
 * - UsageManager     (api.usage.routes)        — request execution & monitoring
 * - FeedbackManager  (api.feedback.routes)     — webhooks & external connectors
 */

import { EndpointManager } from '../server/routes/api.instructions.routes.js';
import type { APIEndpoint } from '../server/routes/api.instructions.routes.js';
import { UsageManager } from '../server/routes/api.usage.routes.js';
import type { APIRequest, APIResponse, APIMonitoringEvent } from '../server/routes/api.usage.routes.js';
import { FeedbackManager } from '../server/routes/api.feedback.routes.js';
import type { WebhookConfig, ExternalConnector } from '../server/routes/api.feedback.routes.js';

// Re-export types that external consumers may depend on
export type { APIEndpoint, APIRequest, APIResponse, APIMonitoringEvent, WebhookConfig, ExternalConnector };

export class APIIntegration {
  private readonly endpointMgr: EndpointManager;
  private readonly usageMgr: UsageManager;
  private readonly feedbackMgr: FeedbackManager;

  constructor() {
    this.endpointMgr = new EndpointManager();
    this.usageMgr = new UsageManager(this.endpointMgr);
    this.feedbackMgr = new FeedbackManager(this.usageMgr);
    this.startBackgroundTasks();
  }

  private startBackgroundTasks(): void {
    setInterval(() => { this.usageMgr.processRequestQueues(); }, 100);
    setInterval(() => { this.endpointMgr.cleanupCache(); }, 60000);
    setInterval(() => { this.endpointMgr.resetRateLimiters(); }, 60000);
    setInterval(() => { this.feedbackMgr.performHealthChecks(); }, 30000);
  }

  // ── Endpoint management ──────────────────────────────────────────────────────────

  async executeRequest(endpointId: string, data?: unknown, overrides?: Partial<APIRequest>): Promise<APIResponse> {
    return this.usageMgr.executeRequest(endpointId, data, overrides);
  }

  createEndpoint(endpoint: Omit<APIEndpoint, 'id'>): string {
    return this.endpointMgr.createEndpoint(endpoint);
  }

  getEndpoint(id: string): APIEndpoint | undefined {
    return this.endpointMgr.getEndpoint(id);
  }

  listEndpoints(): APIEndpoint[] {
    return this.endpointMgr.listEndpoints();
  }

  updateEndpoint(id: string, updates: Partial<APIEndpoint>): boolean {
    return this.endpointMgr.updateEndpoint(id, updates);
  }

  deleteEndpoint(id: string): boolean {
    return this.endpointMgr.deleteEndpoint(id);
  }

  getConfiguredEndpoints(): APIEndpoint[] {
    return this.endpointMgr.getConfiguredEndpoints();
  }

  // ── Webhook management ───────────────────────────────────────────────────────────

  createWebhook(webhook: Omit<WebhookConfig, 'id'>): string {
    return this.feedbackMgr.createWebhook(webhook);
  }

  async triggerWebhook(id: string, event: string, data: unknown): Promise<boolean> {
    return this.feedbackMgr.triggerWebhook(id, event, data);
  }

  // ── Connector management ─────────────────────────────────────────────────────────

  createConnector(connector: Omit<ExternalConnector, 'id' | 'status' | 'metrics'>): string {
    return this.feedbackMgr.createConnector(connector);
  }

  getConnectorStatus(id: string): ExternalConnector | undefined {
    return this.feedbackMgr.getConnectorStatus(id);
  }

  listConnectors(): ExternalConnector[] {
    return this.feedbackMgr.listConnectors();
  }

  // ── Monitoring ───────────────────────────────────────────────────────────────────

  onAPIEvent(callback: (event: APIMonitoringEvent) => void): void {
    this.usageMgr.onAPIEvent(callback);
  }

  getAPIStatistics(): {
    endpoints: number;
    webhooks: number;
    connectors: number;
    activeConnections: number;
    totalRequests: number;
    errorRate: number;
  } {
    const stats = this.feedbackMgr.getStats();
    return {
      endpoints: this.endpointMgr.endpoints.size,
      webhooks: stats.webhookCount,
      connectors: stats.connectorCount,
      activeConnections: stats.activeConnections,
      totalRequests: stats.totalRequests,
      errorRate: stats.totalRequests > 0 ? stats.totalErrors / stats.totalRequests : 0
    };
  }
}

// Singleton instance
let apiIntegration: APIIntegration | null = null;

export function getAPIIntegration(): APIIntegration {
  if (!apiIntegration) {
    apiIntegration = new APIIntegration();
  }
  return apiIntegration;
}
