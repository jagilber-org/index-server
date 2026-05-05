// Central authoritative list of slow / pre-push test files (relative to repo root)
// Keep this list small and high-signal. Used by test-slow and test-fast scripts.
export function normalizeSpecPath(filePath) {
  return filePath.replace(/\\/g, '/').toLowerCase();
}

export const slowTests = [
  'src/tests/feedbackReproduction.multiClient.spec.ts',
  'src/tests/feedbackReproduction.crudConsistency.spec.ts',
  'src/tests/instructionsPersistenceDivergence.red.spec.ts',
  'src/tests/instructionsPersistenceIsolated.red.spec.ts',
  'src/tests/importDuplicateAddVisibility.red.spec.ts',
  'src/tests/nmapSecurity.spec.ts', // external nmap integration; long-running and environment-sensitive
  'src/tests/performanceBenchmark.spec.ts', // performance/integration suite with repeated live HTTP timings
  'src/tests/clientScriptsE2e.spec.ts', // live dashboard + pwsh/bash/nmap/https end-to-end coverage
  // Newly classified (runtime consistently > ~30s end-to-end)
  'src/tests/governanceHashIntegrity.spec.ts',
  // Borderline (~9s) multi-operation visibility scenario; move out of fast loop
  'src/tests/instructionsAddSkipVisibility.spec.ts',
  // Added per optimization pass (top offenders in fast suite >5s each)
  'src/tests/unit/indexContext.usage.unit.spec.ts', // ~12s (2 heavy rotation tests)
  'src/tests/createReadSmoke.spec.ts', // ~5-6s full CRUD smoke
  'src/tests/feedbackReproduction.spec.ts', // ~5-6s persistence & green path validations
  // Dashboard/live-server integration coverage — stable in isolation but high-cost/flaky in the fast aggregate run
  'src/tests/dashboardBackupFileImport.spec.ts',
  'src/tests/dashboardIntegration.spec.ts',
  'src/tests/graphFilteringStyles.spec.ts',
  'src/tests/graphThemeVariables.spec.ts',
  'src/tests/unit/multiInstanceFailover.spec.ts',
  // Server-spawn / TLS integration tests — flaky in fast suite (port/env-sensitive)
  'src/tests/dashboardTls.spec.ts',
  // Concurrent HTTP tests — rate-limit 429 failures in aggregate runs
  'src/tests/concurrent/concurrentHttpRpc.spec.ts',
  'src/tests/concurrent/followerUsageFeedback.spec.ts',
  // Oversized-body negative test — pre-existing behavior gap (server accepts oversized body)
  'src/tests/instructionsAddNegative.spec.ts'
].map(normalizeSpecPath);

export function isSlowTest(filePath) {
  return slowTests.includes(normalizeSpecPath(filePath));
}
