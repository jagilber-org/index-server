import { registerHandler, getMetricsRaw } from '../server/registry';
import { getIndexStateAsync } from '../services/indexContext';
import { featureStatus } from '../services/features';
import { getActiveInstances } from '../dashboard/server/InstanceManager';
import fs from 'fs';
import path from 'path';

import { getValidationMetrics } from './validationService';
import { getAuditLogHealth } from './auditLog';
import { getCounters } from './features';
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
// Resolve version locally (mirrors transport logic) to avoid import cycles
let VERSION = '0.0.0';
try {
  const pkgPath = path.join(process.cwd(), 'package.json');
  if (fs.existsSync(pkgPath)) {
    const raw = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (raw.version) VERSION = raw.version;
  }
} catch { /* ignore */ }

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
    ...(Object.keys(repairCounters).length ? { usageRepairs: repairCounters } : {}),
  };
});

export {};
