#!/usr/bin/env node
/**
 * Baseline Guard
 * Fails if repository deviates from authoritative baseline control file expectations:
 *  - INTERNAL-BASELINE.md must exist
 *  - Execution Log section present
 *  - Minimal invariant suite scripts/tests present
 *  - No unexpected test proliferation when BASELINE_ENFORCE=1
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { exit } from 'process';

const errors = [];
const baselineFile = 'INTERNAL-BASELINE.md';
if (!existsSync(baselineFile)) {
  errors.push('Missing INTERNAL-BASELINE.md');
} else {
  const content = readFileSync(baselineFile, 'utf8');
  if (!/## 15\. Execution Log/.test(content)) {
    errors.push('Baseline file missing Execution Log section');
  }
  if (!/## 3\. Success Criteria/.test(content)) {
    errors.push('Baseline file missing Success Criteria section');
  }
}

// Minimal suite expectations
const minimalTests = [
  'createReadSmoke.spec.ts',
  'instructionsAddPersistence.spec.ts',
  // Imperative directive safeguard: ensures debug/diag env flags remain disabled unless formally approved
  'mcpConfigImperativeDirective.spec.ts'
];

let testDirFiles = [];
try { testDirFiles = readdirSync('src/tests'); } catch { /* directory may not exist in some phases */ }

for (const mt of minimalTests) {
  if (!testDirFiles.includes(mt)) {
    errors.push(`Missing minimal test: ${mt}`);
  }
}

// Additional tests that are allowed beyond the minimal baseline.
// NOTE: This list has been expanded (2025-09-03) to reflect the presently
// curated, stable broader suite. This is a noise‑suppression update only and
// does NOT constitute a baseline policy expansion; minimal invariant set
// remains authoritative (§6 INTERNAL-BASELINE.md). Future additions MUST be
// consciously appended here (or governed by a forthcoming pattern-based
// matcher) to avoid accidental guard churn.
const allowedAdditional = [
  'contractSchemas.spec.ts',
  'governanceHashIntegrity.spec.ts',
  // Newly allow-listed (2025-09-05) for noise suppression only (NOT minimal invariant expansion):
  // - httpMetrics.spec.ts (dashboard HTTP instrumentation)
  // - instructionsPersistenceDivergence.spec.ts (adaptive GREEN overwrite vs create logic)
  // - dashboardPhase1.spec.ts (infrastructure wiring)
  // - dashboardRpmStability.spec.ts (RPM stability metrics)
  'httpMetrics.spec.ts',
  'instructionsPersistenceDivergence.spec.ts',
  'dashboardPhase1.spec.ts',
  'dashboardRpmStability.spec.ts',
  // Expanded stable suite (noise suppression)
  'addContract.meta.spec.ts',
  'addOverwriteMissingGetRepro.spec.ts',
  'atomicWriteRetries.spec.ts',
  'IndexVersionMarker.spec.ts',
  'createReadBug.spec.ts',
  'crudGovernanceCompliance.spec.ts',
  'crudMatrix.spec.ts',
  'crudPerformance.spec.ts',
  'crudPersistenceMatrix.spec.ts',
  'crudTransactionLog.spec.ts',
  'devVsProdComparison.spec.ts',
  'diffExportPerformance.spec.ts',
  'feedbackProductionIntegration.spec.ts',
  'feedbackReproduction.crudConsistency.spec.ts',
  'feedbackReproduction.multiClient.spec.ts',
  'feedbackReproduction.spec.ts',
  'governanceHash.spec.ts',
  'governanceHashAutoInvalidation.spec.ts',
  'governanceHashDrift.spec.ts',
  'governanceHashStability.spec.ts',
  'governancePersistence.spec.ts',
  'handshakeDirect.spec.ts',
  'handshakePwshIsolation.spec.ts',
  'handshakeTimingRegression.spec.ts',
  'healthHangExploration.spec.ts',
  'importDuplicateAddVisibility.red.spec.ts',
  'instructionsAddCreatedFlag.spec.ts',
  'instructionsAddOverwriteVersion.spec.ts',
  'instructionsAddSkipVisibility.spec.ts',
  'instructionsAttribution.spec.ts',
  'instructionsConcurrentAdd.spec.ts',
  'instructionsCreateAtomicVisibility.spec.ts',
  'instructionsCrossProcessVisibility.spec.ts',
  'instructionsDefaultsFill.spec.ts',
  'instructionsDisappearingRegression.spec.ts',
  'instructionsEnvOverride.spec.ts',
  'instructionsExternalReload.spec.ts',
  'instructionsMarkdownRich.spec.ts',
  'instructionsNoEnrichmentOverride.spec.ts',
  'instructionsPathMismatch.spec.ts',
  'instructionsPersistenceDivergence.red.spec.ts',
  'instructionsPersistenceIsolated.red.spec.ts',
  'instructionsRemoveAtomicVisibility.spec.ts',
  'instructionsRestartPersistence.spec.ts',
  'instructionsSearchRelevance.spec.ts',
  'productionBugFixed.spec.ts',
  'productionBugRepro.spec.ts',
  'productionIndexDebug.spec.ts',
  'productionHealth.spec.ts',
  'productionIndexReset.spec.ts',
  'productionToolsDebug.spec.ts',
  'stableToolsCoverage.spec.ts',
  'tracingBasics.spec.ts',
  'tracingRotation.spec.ts',
  'usageFirstSeen.spec.ts',
  'usageGating.spec.ts',
  'usageRateLimit.spec.ts',
  'usageTracking.spec.ts'
];

// Noise suppression allow-list (2025-09-06 BASELINE-CR 14.3): BufferRing + governance hash hardening
allowedAdditional.push(
  'bufferRing.spec.ts', // legacy placeholder
  'bufferRingSimple.spec.ts',
  'bufferRingMetricsIntegration.spec.ts',
  'governanceHashHardening.spec.ts'
);

// Noise suppression allow-list (2025-09-11 BASELINE-CR 14.4): graph export deterministic suite
// Rationale: The graph export test validates deterministic graph construction, schema version
// placement under meta, category capping, mutation-driven cache invalidation, and performance
// characteristics critical for upcoming instruction relationship visualization work. It is NOT
// part of the minimal invariant suite; failures are early warning only. See INTERNAL-BASELINE.md §14.4.
allowedAdditional.push('graphExport.spec.ts');

// Noise suppression allow-list (2025-09-14 BASELINE-CR 14.5): bootstrap gating, manifest, search, governance recursion, visibility invariant, versioning, onboarding, graph export variants
allowedAdditional.push(
  'bootstrapGating.spec.ts',
  'addVisibilityInvariant.spec.ts',
  'manifestEdgeCases.spec.ts',
  'manifestFastload.spec.ts',
  'manifestLifecycle.spec.ts',
  'manifestSchemaValidation.spec.ts',
  'manifestSkip.spec.ts',
  'instructionsSearch.spec.ts',
  'instructionsGovernanceVersion.spec.ts',
  'instructionsVersionChangeLog.spec.ts',
  'governanceRecursionGuard.spec.ts',
  'graphExport.enriched.spec.ts',
  'graphExport.mermaid.spec.ts',
  'onboardingHelp.spec.ts'
);

// Enforce no unexpected test expansion when BASELINE_ENFORCE=1
if (process.env.BASELINE_ENFORCE === '1') {
  const allowed = new Set([...minimalTests, ...allowedAdditional]);
  const phase = process.env.BASELINE_PHASE || '';
  const extra = testDirFiles.filter(f => /\.spec\.ts$/.test(f) && !allowed.has(f));
  if (extra.length && phase !== 'pre-isolation') {
    errors.push('Unexpected test files present under BASELINE_ENFORCE=1: ' + extra.join(', '));
  }
  // Sentinel verification
  try {
    if (existsSync('.baseline.sentinel') && existsSync(baselineFile)) {
      const sentinel = readFileSync('.baseline.sentinel', 'utf8').trim();
      const current = createHash('sha256').update(readFileSync(baselineFile,'utf8'),'utf8').digest('hex');
      if (sentinel !== current) {
        errors.push('Baseline sentinel mismatch. Expected ' + sentinel + ' current ' + current);
      }
    } else {
      errors.push('Missing sentinel file .baseline.sentinel under enforcement');
    }
  } catch (e) {
    errors.push('Sentinel verification error: ' + (e && e.message || e));
  }
}

if (errors.length) {
  console.error('\nBaseline guard violations:');
  for (const e of errors) console.error(' - ' + e);
  console.error('\nResolve deviations or update INTERNAL-BASELINE.md via formal CHANGE REQUEST.');
  exit(1);
}
console.log('Baseline guard: OK');
