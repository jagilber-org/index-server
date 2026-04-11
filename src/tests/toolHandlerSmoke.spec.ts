/**
 * Tool Handler Smoke Tests
 * Invokes every STABLE tool with minimal params to verify handlers
 * are registered and return without throwing.
 * This is the canary test: if a handler import is missing, it fails here.
 */
import { describe, it, expect } from 'vitest';
import { getHandler } from '../server/registry';
import { STABLE } from '../services/toolRegistry';

// Import ALL handler modules
import '../services/handlers.instructions';
import '../services/handlers.search';
import '../services/instructions.dispatcher';
import '../services/handlers.integrity';
import '../services/handlers.usage';
import '../services/handlers.prompt';
import '../services/handlers.metrics';
import '../services/handlers.gates';
import '../services/handlers.diagnostics';
import '../services/handlers.feedback';
import '../services/handlers.help';
import '../services/handlers.instructionSchema';
import '../services/handlers.bootstrap';
import '../services/handlers.manifest';
import '../services/handlers.instructionsDiagnostics';
import '../services/handlers.graph';
import '../services/handlers.activation';
import '../services/handlers.promote';
import '../services/toolHandlers';

// Minimal valid params for each stable tool that requires them
const MINIMAL_PARAMS: Record<string, unknown> = {
  index_dispatch: { action: 'capabilities' },
  index_search: { keywords: ['test'] },
  usage_track: { id: '__smoke_test__' },
  prompt_review: { prompt: 'hello world' },
  meta_check_activation: { toolName: 'health_check' },
  feedback_dispatch: { action: 'health' },
  bootstrap: { action: 'status' },
  feedback_get: { id: '__nonexistent__' },
  index_inspect: { id: '__nonexistent__' },
  diagnostics_block: { ms: 0 },
  diagnostics_microtaskFlood: { count: 1 },
  diagnostics_memoryPressure: { mb: 1 },
  messaging_get: { messageId: '__nonexistent__' },
  messaging_thread: { parentId: '__nonexistent__' },
};

// Tools that throw for bad IDs (expected behavior, not a bug)
const EXPECT_ERROR = new Set<string>();

describe('Tool Handler Smoke (all STABLE tools)', () => {
  const stableToolNames = Array.from(STABLE);

  it('all STABLE tools have registered handlers', () => {
    const missing = stableToolNames.filter(name => !getHandler(name));
    expect(missing, `STABLE tools without handlers: ${missing.join(', ')}`).toHaveLength(0);
  });

  // Generate a smoke test per stable tool
  for (const toolName of stableToolNames) {
    it(`${toolName} — handler responds without throwing`, async () => {
      const handler = getHandler(toolName);
      expect(handler, `${toolName} handler not found`).toBeDefined();
      const params = MINIMAL_PARAMS[toolName] ?? {};
      if (EXPECT_ERROR.has(toolName)) {
        // These tools throw for invalid IDs — verify they have a handler but allow error
        await expect(handler!(params)).rejects.toThrow();
      } else {
        const result = await handler!(params);
        expect(result).toBeDefined();
      }
    });
  }
});
