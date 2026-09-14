import { registerHandler, getMetricsRaw } from '../server/registry';
import { getIndexStateAsync } from '../services/indexContext';
import { featureStatus } from '../services/features';
import { getActiveInstances } from '../dashboard/server/InstanceManager';

import { getValidationMetrics } from './validationService';
import { getAuditLogHealth } from './auditLog';
import { getCounters, getFeatureFlagMap } from './features';
import { findPackageVersion } from '../utils/version';
registerHandler('metrics_snapshot', () => {
  const raw = getMetricsRaw();
  const methods = Object.entries(raw)
    .map(([method, rec]) => ({
      method,
      count: rec.count,
      avgMs: rec.count ? +(rec.totalMs / rec.count).toFixed(2) : 0,
      maxMs: +rec.maxMs.toFixed(2),
    }))
    .sort((a, b) => a.method.localeCompare(b.method));
  const features = featureStatus();
  const validation = getValidationMetrics();
  return { generatedAt: new Date().toISOString(), methods, features, validation };
});
// health_check retained here (meta_tools provided by shim for rich output)
// Version resolution goes through the shared candidate-list helper (#524, #506):
// under MCP stdio launch process.cwd() is the *client's* directory, so a
// cwd-only lookup silently reports 0.0.0. findPackageVersion() falls back to a
// __dirname-relative path and WARNs when no candidate resolves (OB-5).
const VERSION = findPackageVersion(__dirname);

interface HealthIndexSummary {
  scanned: number;
  accepted: number;
  skipped: number;
  reasons: Record<string, number>;
  salvage?: Record<string, number>;
  softWarnings?: Record<string, number>;
}

registerHandler('health_check', async () => {
  let summary: HealthIndexSummary | undefined;
  try {
    const st = await getIndexStateAsync() as unknown as { loadSummary?: HealthIndexSummary };
    if (st.loadSummary) {
      const s = st.loadSummary;
      summary = {
        scanned: s.scanned,
        accepted: s.accepted,
        skipped: s.skipped,
        reasons: s.reasons,
        salvage: s.salvage,
        softWarnings: s.softWarnings,
      };
    }
  } catch { /* swallow to keep health resilient */ }

  // Instance discovery — resilient: never fail health due to port-file read errors
  let instances: Array<{ pid: number; port: number; host: string; startedAt: string; current: boolean }> = [];
  try {
    instances = getActiveInstances().map(i => ({
      pid: i.pid,
      port: i.port,
      host: i.host,
      startedAt: i.startedAt,
      current: i.current,
    }));
  } catch { /* swallow */ }

  // Expose usage invariant repair counters so operators can see silent data reconstruction
  const allCounters = getCounters();
  const repairCounters: Record<string, number> = {};
  for (const [key, val] of Object.entries(allCounters)) {
    if (key.startsWith('usage:') && val > 0) repairCounters[key] = val;
  }

  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: VERSION,
    pid: process.pid,
    uptime: Math.round(process.uptime()),
    index: summary,
    instances,
    audit: getAuditLogHealth(),
    features: getFeatureFlagMap(),
    ...(Object.keys(repairCounters).length ? { usageRepairs: repairCounters } : {}),
  };
});

export {};
