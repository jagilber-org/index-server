/**
 * Integration tests verifying that precommit.yml covers all removed security workflows.
 * PR #330 removed standalone security workflows (codeql, ggshield, gitleaks, semgrep)
 * asserting they are redundant to precommit.yml. These tests validate that claim.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const WORKFLOW_DIR = path.join(__dirname, '../../.github/workflows');
const PRECOMMIT_WORKFLOW = path.join(WORKFLOW_DIR, 'precommit.yml');
const SECURITY_TIER1_WORKFLOW = path.join(WORKFLOW_DIR, 'security-tier1.yml');

let precommitContent: string;
let securityTier1Content: string;

beforeAll(() => {
  // Load workflow YAMLs as text
  precommitContent = fs.readFileSync(PRECOMMIT_WORKFLOW, 'utf-8');
  securityTier1Content = fs.readFileSync(SECURITY_TIER1_WORKFLOW, 'utf-8');
});

describe('PR #330 CI Deduplication Coverage', () => {
  describe('precommit.yml covers removed scanning tools', () => {
    it('precommit.yml installs ggshield (removed from standalone workflows)', () => {
      expect(precommitContent).toMatch(/pip install.*ggshield/);
    });

    it('precommit.yml installs detect-secrets (gitleaks equivalent)', () => {
      expect(precommitContent).toMatch(/pip install.*detect-secrets/);
    });

    it('precommit.yml runs pre-commit hooks (which include gitleaks, ggshield, semgrep, codeql)', () => {
      // Verify the main pre-commit hook execution
      expect(precommitContent).toMatch(/pre-commit run/);
    });

    it('precommit.yml runs both commit-stage and pre-push hooks', () => {
      // Commit-stage hooks (gitleaks, ggshield, semgrep)
      expect(precommitContent).toMatch(/pre-commit run --from-ref|--all-files/);
      // Pre-push hooks (codeql, etc.)
      expect(precommitContent).toMatch(/--hook-stage pre-push/);
    });

    it('precommit.yml sets GITGUARDIAN_API_KEY env for ggshield', () => {
      expect(precommitContent).toMatch(/GITGUARDIAN_API_KEY:\s*\$\{\{\s*secrets\.GITGUARDIAN_API_KEY/);
    });
  });

  describe('security-tier1.yml retains unique checks', () => {
    it('security-tier1.yml still runs npm audit (no local equivalent)', () => {
      expect(securityTier1Content).toMatch(/npm audit/);
    });

    it('security-tier1.yml still runs security header regression tests (live server validation)', () => {
      expect(securityTier1Content).toMatch(/securityHeaders\.spec\.ts/);
    });

    it('security-tier1.yml documents why PII/secret scan was removed', () => {
      expect(securityTier1Content).toMatch(/DEDUPLICATION NOTE/);
      expect(securityTier1Content).toMatch(/scan:security.*identical to precommit\.yml/);
    });
  });

  describe('precommit.yml fail-closed behavior', () => {
    it('precommit.yml does NOT have fail-open continue-on-error for missing API key', () => {
      // Should NOT contain continue-on-error that conditionally disables on missing key
      expect(precommitContent).not.toMatch(/continue-on-error:\s*\$\{\{\s*secrets\.GITGUARDIAN_API_KEY/);
    });

    it('precommit.yml conditionally skips ggshield report step if key is missing (not the main policy)', () => {
      // The report generation step (lines 74-81) can skip, but not the main policy
      expect(precommitContent).toMatch(/Generate ggshield JSON report.*\n\s*if:.*GITGUARDIAN_API_KEY/);
    });
  });

  describe('precommit.yml covers removed npm scripts', () => {
    it('precommit.yml has npm ci installed (for eslint pre-push hook)', () => {
      expect(precommitContent).toMatch(/npm ci/);
    });

    it('precommit.yml validates constitution sync (typecheck equivalent)', () => {
      expect(precommitContent).toMatch(/sync-constitution\.ps1\s*-Check/);
    });
  });

  describe('removed workflows are actually not present', () => {
    it('codeql.yml workflow should not exist (moved to precommit.yml via hook)', () => {
      const codeqlPath = path.join(WORKFLOW_DIR, 'codeql.yml');
      expect(fs.existsSync(codeqlPath)).toBe(false);
    });

    it('ggshield-secret-scans.yml workflow should not exist (moved to precommit.yml via hook)', () => {
      const ggshieldPath = path.join(WORKFLOW_DIR, 'ggshield-secret-scans.yml');
      expect(fs.existsSync(ggshieldPath)).toBe(false);
    });

    it('gitleaks-secret-scans.yml workflow should not exist (moved to precommit.yml via hook)', () => {
      const gitleaksPath = path.join(WORKFLOW_DIR, 'gitleaks-secret-scans.yml');
      expect(fs.existsSync(gitleaksPath)).toBe(false);
    });

    it('semgrep.yml workflow should not exist (moved to precommit.yml via hook)', () => {
      const semgrepPath = path.join(WORKFLOW_DIR, 'semgrep.yml');
      expect(fs.existsSync(semgrepPath)).toBe(false);
    });
  });
});
