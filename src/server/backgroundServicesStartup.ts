import type { RuntimeConfig } from '../config/runtimeConfig';
import { getBooleanEnv } from '../utils/envUtils';
import { startIndexVersionPoller } from '../services/indexContext';
import { startAutoBackup } from '../services/autoBackup';
import { getMemoryMonitor } from '../utils/memoryMonitor';

export function startOptionalMemoryMonitoring(_runtime: RuntimeConfig): void {
  if (getBooleanEnv('INDEX_SERVER_DEBUG') || getBooleanEnv('INDEX_SERVER_MEMORY_MONITOR')) {
    try {
      const memMonitor = getMemoryMonitor();
      memMonitor.startMonitoring(10000);
      process.stderr.write('[startup] Memory monitoring enabled (interval: 10s)\n');
      process.stderr.write('[startup] Memory monitor commands: memStatus(), startMemWatch(), stopMemWatch(), memReport(), forceGC(), checkListeners()\n');
    } catch (error) {
      process.stderr.write(`[startup] Memory monitoring failed: ${error}\n`);
    }
  }
}

export function startDeferredBackgroundServices(runtime: RuntimeConfig): void {
  try {
    if (runtime.server.indexPolling.enabled) {
      startIndexVersionPoller({
        proactive: runtime.server.indexPolling.proactive,
        intervalMs: runtime.server.indexPolling.intervalMs,
      });
      if (runtime.logging.diagnostics) {
        try { process.stderr.write(`[startup] index version poller started proactive=${runtime.server.indexPolling.proactive}\n`); } catch { /* ignore */ }
      }
    } else if (runtime.logging.diagnostics) {
      try { process.stderr.write('[startup] index version poller not enabled (set INDEX_SERVER_ENABLE_INDEX_SERVER_POLLER=1)\n'); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

  try { setImmediate(() => { try { startAutoBackup(); } catch { /* ignore */ } }); } catch { /* ignore */ }
}
