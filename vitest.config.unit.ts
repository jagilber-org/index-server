import { defineConfig } from 'vitest/config';

/**
 * Unit-test-only config for fast developer feedback.
 *
 * Runs only pure unit tests (src/tests/unit/) in parallel with multiple workers.
 * Tests that spawn child processes are excluded — they belong in the integration suite.
 *
 * Usage:  npm run test:unit          (typically <30s)
 *         npm run test:unit:watch    (re-runs on save)
 */
export default defineConfig({
  test: {
    include: ['src/tests/unit/**/*.spec.ts'],
    exclude: [
      // Unit tests that spawn server/child processes — run these in integration suite
      'src/tests/unit/bootstrapFlow.spec.ts',
      'src/tests/unit/mcpConfigIntegration.spec.ts',
      'src/tests/unit/multiInstanceFailover.spec.ts',
      'src/tests/unit/multiInstanceIntegration.spec.ts',
      // Groom tests rely on shared module state (import real indexContext + handlers) — flaky in threads pool
      'src/tests/unit/groomJunkCategories.spec.ts',
      'src/tests/unit/groomSignalFeedback.spec.ts',
      // Tests that spawn server via createTestClient — integration tests, not unit tests
      'src/tests/unit/defaultsFill.spec.ts',
      'src/tests/unit/governanceHashNegative.spec.ts',
      'src/tests/unit/handlerNegative.spec.ts',
      'src/tests/unit/importNegative.spec.ts',
      'src/tests/unit/npmPackReadiness.spec.ts',
      'src/tests/unit/publishDryRun.spec.ts',
      'src/tests/unit/publishPipeline.spec.ts',
      'src/tests/unit/publishScripts.spec.ts',
      'src/tests/unit/sdkServerHandshake.p1.spec.ts',
      'src/tests/unit/serverIndex.p1.spec.ts',
      'src/tests/unit/persistenceBetweenInstances.spec.ts',
      'src/tests/unit/thinClient.spec.ts',
      'dist/**',
      'node_modules/**',
    ],
    pool: 'threads',
    testTimeout: 10000,
    hookTimeout: 15000,
    reporters: ['default', 'junit'],
    outputFile: { junit: 'test-results/junit.xml' },
  },
});
