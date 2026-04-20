import { registerHandler } from '../server/registry';
import { getIndexDiagnostics } from './indexContext';

// Read-only diagnostics tool exposing loader acceptance vs rejection reasoning.
// Stable, side-effect free. Optional includeTrace param surfaces a capped trace sample.
registerHandler('index_diagnostics', (p: { includeTrace?: boolean } = {}) => {
  try {
    return getIndexDiagnostics({ includeTrace: !!p.includeTrace });
  } catch (e) {
    return { error: (e as Error)?.message || 'diagnostics-failed' };
  }
});

export {}; // module scope
