// Clean shim implementation
import { registerHandler, listRegisteredMethods } from '../server/registry';
import { getToolRegistry, REGISTRY_VERSION, STABLE as REGISTRY_STABLE } from './toolRegistry';
import { computeGovernanceHash, projectGovernance, getIndexState } from './indexContext';
import { getRuntimeConfig } from '../config/runtimeConfig';

// Side-effect registrations from modular handlers
// IMPORTANT: Keep in sync with src/server/index-server.ts imports
import './handlers.instructions';
import './handlers.search';
import './instructions.dispatcher'; // ensure dispatcher registered regardless of server entrypoint
import './handlers.integrity';
import './handlers.usage';
import './handlers.prompt';
import './handlers.metrics';
import './handlers.gates';
import './handlers.testPrimitive'; // test helper primitive handler registration
import './handlers.diagnostics';
import './handlers.feedback';
import './handlers.help';
import './handlers.instructionSchema';
import './handlers.bootstrap';
import './handlers.manifest';
import './handlers.instructionsDiagnostics';
import './handlers.graph';
import './handlers.activation'; // VSCode activation guide for tool enablement
import './handlers.promote'; // promote_from_repo: scan repo & upsert into index
import './handlers.messaging'; // inter-agent messaging (not stored in instruction index)
import './handlers.trace'; // trace_dump: write in-memory trace ring buffer to file

// Rich meta_tools implementation (stable vs dynamic)
function mutationEnabled(){ return getRuntimeConfig().mutation.enabled; }
registerHandler('meta_tools', () => {
  const MUTATION_ENABLED = mutationEnabled();
  const methods = listRegisteredMethods();
  const registry = getToolRegistry({ tier: 'admin' });
  const stableTools = new Set<string>(Array.from(REGISTRY_STABLE));
  const mutationSet = new Set(registry.filter(r => r.mutation).map(r => r.name));
  const all = methods.map(m => ({ method: m, stable: stableTools.has(m), mutation: mutationSet.has(m), disabled: mutationSet.has(m) && !MUTATION_ENABLED }));
  return {
    tools: all.map(t => ({ method: t.method, stable: t.stable, mutation: t.mutation, disabled: t.disabled })),
    stable: { tools: all.map(t => ({ method: t.method, stable: t.stable, mutation: t.mutation })) },
    dynamic: { generatedAt: new Date().toISOString(), mutationEnabled: MUTATION_ENABLED, disabled: all.filter(t => t.disabled).map(t => ({ method: t.method })) },
    mcp: { registryVersion: REGISTRY_VERSION, tools: registry.map(r => ({ name: r.name, description: r.description, stable: r.stable, mutation: r.mutation, inputSchema: r.inputSchema, outputSchema: r.outputSchema })) }
  };
});

// Back-compat alias map removed in 1.0.0 (BREAKING CHANGE): callers must use canonical tool names.

// Export governance helpers & index accessor (back-compat for tests)
export { computeGovernanceHash, projectGovernance, getIndexState };
