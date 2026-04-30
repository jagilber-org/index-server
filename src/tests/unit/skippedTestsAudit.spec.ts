/**
 * Skipped Tests Audit — Issue #129
 *
 * This file documents all conditionally-skipped tests in src/tests/unit/
 * and verifies the skip conditions are valid. All skips are environment-dependent
 * (conditional on optional tools/libraries being present), NOT permanent blockers.
 *
 * Categories of skips:
 *
 *  1. SQLite/sqlite-vec not installed:
 *     - storage/embeddingIntegration.spec.ts — skipIf(!hasSqliteVec)
 *     - storage/embeddingMigration.spec.ts — skipIf(!hasSqliteVec)
 *     - storage/embeddingScenarios.spec.ts — skipIf(!hasSqliteVec)
 *     - storage/embeddingStore.contract.spec.ts — skipIf(!hasSqliteVec)
 *     - storage/sqliteEmbeddingConcurrency.spec.ts — skipIf(!hasSqliteVec) [4 describes]
 *     - storage/sqliteEmbeddingStore.spec.ts — skipIf(!hasSqliteVec)
 *     - storage/backendIsolation.spec.ts — skipIf(!hasSqlite)
 *     - storageInterfaceCompliance.spec.ts — skipIf(!hasSqlite)
 *     WHY: sqlite-vec is an optional native addon. CI runners and most dev
 *     machines lack it. The skip is appropriate — fix: install better-sqlite3
 *     + sqlite-vec to run these.
 *
 *  2. Publish/build scripts missing:
 *     - publishDryRun.spec.ts — skipIf(!HAS_PUBLISH_EXCLUDE) [3 describes]
 *     - publishPipeline.spec.ts — skipIf(!HAS_PUBLISH_EXCLUDE) [3 describes]
 *     - publishScripts.spec.ts — skipIf(!HAS_PS1_SCRIPT || !HAS_PUBLISH_EXCLUDE) [3 describes]
 *     WHY: These test publish artifact filtering. The .publish-exclude file
 *     or PowerShell publish script may not exist in all checkout states.
 *     Skip is appropriate — fix: ensure scripts/ are checked out.
 *
 *  3. Copilot instructions file missing:
 *     - renameValidation.spec.ts — skipIf(!hasCopilotInstructions)
 *     WHY: Tests that the .github/copilot-instructions.md file says "Index Server"
 *     not "Catalog Server". Skip is appropriate when file doesn't exist.
 *
 * Integration tests (src/tests/*.spec.ts) have additional skips for:
 *  - PowerShell/Bash availability (clientScriptsE2e)
 *  - OpenSSL availability (dashboardTls)
 *  - Docker availability (dockerSecurity)
 *  - nmap availability (nmapSecurity)
 *  - Semantic search enabled (concurrentSemanticCrud)
 *  - Fast coverage mode / dist build (createReadSmoke, manifestEdgeCases, syntheticActivityLogging)
 *  - Governance hardening feature flag (governanceHashHardening)
 *
 * VERDICT: All skips are valid environment guards. No tests are skipped due
 * to known bugs or broken functionality. No action needed beyond this audit.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Skipped tests audit (Issue #129)', () => {

  it('all unit test skips are environment-conditional, not permanent', () => {
    // Scan unit test files for skip patterns and verify none are unconditional
    const unitDir = path.join(process.cwd(), 'src', 'tests', 'unit');
    const files = collectSpecFiles(unitDir);

    const unconditionalSkips: { file: string; line: number; text: string }[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Detect unconditional skips (not .skipIf which is conditional)
        if (/\b(it|test|describe)\.skip\s*\(/.test(line) && !line.includes('SKIP_OK') && !line.trimStart().startsWith('//')) {
          unconditionalSkips.push({ file: path.relative(unitDir, file), line: i + 1, text: line.trim() });
        }
      }
    }

    // There should be zero unconditional skips in unit tests
    expect(unconditionalSkips, 'Found unconditional skips in unit tests: ' +
      JSON.stringify(unconditionalSkips, null, 2)).toHaveLength(0);
  });

  it('all unit test skipIf conditions reference environment checks', () => {
    const unitDir = path.join(process.cwd(), 'src', 'tests', 'unit');
    const files = collectSpecFiles(unitDir);

    const skipIfConditions: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const matches = content.match(/skipIf\(([^)]+)\)/g) || [];
      skipIfConditions.push(...matches);
    }

    // All skipIf conditions should reference environment/tool checks
    // (has*, !has*, HAS_*, !HAS_*, FAST_*, enabled, platform checks, etc.)
    for (const cond of skipIfConditions) {
      const inner = cond.replace('skipIf(', '').replace(')', '');
      const isEnvCheck =
        /has|HAS_|FAST_|enabled|backend|DEPLOY|hasCopilot|isWindows|isLinux|isMac|isDarwin|process\.platform/i.test(
          inner,
        );
      expect(isEnvCheck, `skipIf condition should be an environment check: ${cond}`).toBe(true);
    }
  });
});

function collectSpecFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectSpecFiles(full));
    } else if (entry.name.endsWith('.spec.ts') && entry.name !== 'skippedTestsAudit.spec.ts') {
      results.push(full);
    }
  }
  return results;
}
