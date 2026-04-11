#!/usr/bin/env node
/**
 * Validates that no test artifact files exist in the instructions/ directory.
 *
 * PURPOSE:
 * Test suites that write to instructions/ for integration testing MUST clean up
 * their artifacts in afterAll hooks. This script enforces that requirement by
 * failing CI builds if any test artifacts are detected.
 *
 * PATTERNS CHECKED:
 * - smoke-*.json: createReadSmoke.spec.ts
 * - mw-disabled-*.json: manifestEdgeCases.spec.ts (write disabled test)
 * - mw-repair-*.json: manifestEdgeCases.spec.ts (repair test)
 * - vis-*.json: addVisibilityInvariant.spec.ts
 * - synthetic-*.json: Dashboard synthetic load tests
 * - unit_p0_materialize_*.json: IndexContext.usage.unit.spec.ts
 * - unit_usageMonotonic_*.json: IndexContext.usage.unit.spec.ts
 *
 * EXIT CODES:
 * 0 - No test artifacts found (success)
 * 1 - Test artifacts found (failure)
 * 2 - Fatal error (directory missing, etc.)
 */

import fs from 'fs';
import path from 'path';

const TEST_ARTIFACT_PATTERNS = [
  /^smoke-\d+\.json$/,
  /^mw-disabled-\d+\.json$/,
  /^mw-repair-\d+\.json$/,
  /^vis-\d+\.json$/,
  /^synthetic-.+\.json$/,
  /^unit_p0_materialize_\d+\.json$/,
  /^unit_usageMonotonic_\d+\.json$/
];

function main() {
  const instructionsDir = path.join(process.cwd(), 'instructions');

  // Verify instructions directory exists
  if (!fs.existsSync(instructionsDir)) {
    console.log('⏭️  instructions/ directory not found — skipping artifact check (CI without local instructions)');
    process.exit(0);
  }

  // Read all files
  const files = fs.readdirSync(instructionsDir).filter(f => f.endsWith('.json'));

  // Find test artifacts
  const artifacts = files.filter(file =>
    TEST_ARTIFACT_PATTERNS.some(pattern => pattern.test(file))
  );

  if (artifacts.length === 0) {
    console.log('✅ No test artifacts found in instructions/ directory');
    process.exit(0);
  }

  // Report failures
  console.error('❌ ERROR: Test artifacts detected in instructions/ directory');
  console.error('');
  console.error('Found', artifacts.length, 'test artifact files:');

  // Group by pattern for better reporting
  const byPattern = new Map();
  for (const artifact of artifacts) {
    const pattern = TEST_ARTIFACT_PATTERNS.find(p => p.test(artifact));
    if (pattern) {
      const key = pattern.source;
      if (!byPattern.has(key)) {
        byPattern.set(key, []);
      }
      byPattern.get(key).push(artifact);
    }
  }

  byPattern.forEach((files, pattern) => {
    console.error(`\n  Pattern: ${pattern}`);
    console.error(`  Count: ${files.length}`);
    if (files.length <= 10) {
      files.forEach(f => console.error(`    - ${f}`));
    } else {
      files.slice(0, 5).forEach(f => console.error(`    - ${f}`));
      console.error(`    ... and ${files.length - 5} more`);
    }
  });

  console.error('');
  console.error('REQUIRED ACTION:');
  console.error('1. Tests MUST clean up their artifacts in afterAll() hooks');
  console.error('2. Run cleanup manually: Remove-Item instructions/smoke-*.json, instructions/mw-*.json, instructions/vis-*.json, instructions/synthetic-*.json, instructions/unit_*.json');
  console.error('3. Verify test cleanup hooks are working correctly');
  console.error('');
  console.error('See docs/TESTING.md for more information.');

  process.exit(1);
}

main();
