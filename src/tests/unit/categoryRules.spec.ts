/**
 * TDD: Category Rules — unit tests for shared deriveCategory function.
 * Tests enriched CATEGORY_RULES covering production index patterns.
 */
import { describe, it, expect } from 'vitest';
import { deriveCategory, CATEGORY_RULES } from '../../services/categoryRules.js';

describe('categoryRules — deriveCategory', () => {

  // ── Original 13 rules ─────────────────────────────────────────────────────

  it('Azure: matches azure, arm-template, apim, batch', () => {
    expect(deriveCategory('azure-batch-pool-resize')).toBe('Azure');
    expect(deriveCategory('arm-template-role-assignment')).toBe('Azure');
    expect(deriveCategory('apim-architecture-docs')).toBe('Azure');
    expect(deriveCategory('batch-seed')).toBe('Azure');
  });

  it('Azure: matches vmss (enriched)', () => {
    expect(deriveCategory('vmss-maintenance-control')).toBe('Azure');
  });

  it('Service Fabric: matches sf-, service-fabric', () => {
    expect(deriveCategory('sf-deploy-troubleshooting')).toBe('Service Fabric');
    expect(deriveCategory('service-fabric-diagnostic-methodology')).toBe('Service Fabric');
  });

  it('Service Fabric: matches servicefabric_ and collectsf (enriched)', () => {
    expect(deriveCategory('servicefabric_cli_repo')).toBe('Service Fabric');
    expect(deriveCategory('servicefabric_repos_2025')).toBe('Service Fabric');
    expect(deriveCategory('collectsfdata-api-structure')).toBe('Service Fabric');
    expect(deriveCategory('collectsfdata-phase2-achievement')).toBe('Service Fabric');
    expect(deriveCategory('collectservicefabricdata-phase3-results')).toBe('Service Fabric');
  });

  it('Service Fabric: matches sfrp (enriched)', () => {
    expect(deriveCategory('sfrplog-kusto-database')).toBe('Service Fabric');
  });

  it('Agent: matches agent boundary', () => {
    expect(deriveCategory('agent-build-validate')).toBe('Agent');
    expect(deriveCategory('multi-agent-coordination-patterns')).toBe('Agent');
  });

  it('MCP: matches mcp boundary', () => {
    expect(deriveCategory('mcp-index-search-guide')).toBe('MCP');
    expect(deriveCategory('mcp_auth_basics')).toBe('MCP');
    expect(deriveCategory('chrome-mcp-server-complete-reference')).toBe('MCP');
  });

  it('PowerShell: matches powershell, pwsh', () => {
    expect(deriveCategory('powershell-remoting-setup')).toBe('PowerShell');
    expect(deriveCategory('powershell_script_security_levels')).toBe('PowerShell');
  });

  it('VS Code: matches vscode, vs-code', () => {
    expect(deriveCategory('vscode-debug')).toBe('VS Code');
    expect(deriveCategory('vs-code-toolsets-configuration')).toBe('VS Code');
  });

  it('VS Code: matches copilot (enriched)', () => {
    expect(deriveCategory('copilot_gpt5_primary_source_priority_2025')).toBe('VS Code');
    expect(deriveCategory('copilot-cli-3-layer-memory-system')).toBe('VS Code');
  });

  it('AI/ML: matches ai-, ml-, llm', () => {
    expect(deriveCategory('ai-model-evaluation')).toBe('AI/ML');
    expect(deriveCategory('ai_code_nav_baseline')).toBe('AI/ML');
  });

  it('AI/ML: matches openai, gpt+digit (enriched)', () => {
    expect(deriveCategory('openai-unified-call-architecture-gpt5')).toBe('AI/ML');
    expect(deriveCategory('gpt5-handling')).toBe('AI/ML');
  });

  it('Git/Repo: matches git-, repo-, github', () => {
    expect(deriveCategory('git-branch-strategy')).toBe('Git/Repo');
    expect(deriveCategory('repo-overview')).toBe('Git/Repo');
    expect(deriveCategory('github-org-governance')).toBe('Git/Repo');
  });

  it('Git/Repo: matches repo_ (enriched pattern)', () => {
    expect(deriveCategory('repo_confirmation_gate_2025')).toBe('Git/Repo');
  });

  it('Testing: matches test, spec-, vitest, playwright', () => {
    expect(deriveCategory('test-coverage-baseline')).toBe('Testing');
    expect(deriveCategory('spec-driven-new-project-setup-guide')).toBe('Testing');
    expect(deriveCategory('playwright-e2e-kusto-integration')).toBe('Testing');
  });

  it('Debugging: matches debug, troubleshoot', () => {
    expect(deriveCategory('debug-log-viewer')).toBe('Debugging');
    expect(deriveCategory('troubleshooting-workflow-template')).toBe('Debugging');
  });

  it('Containers: matches docker, container', () => {
    expect(deriveCategory('docker-compose-setup')).toBe('Containers');
    expect(deriveCategory('container-registry-auth')).toBe('Containers');
  });

  it('Security: matches security, auth-', () => {
    expect(deriveCategory('security-hardening-guide')).toBe('Security');
    expect(deriveCategory('auth-modes')).toBe('Security');
  });

  it('Security: matches authentication (enriched)', () => {
    expect(deriveCategory('microsoft-emu-authentication')).toBe('Security');
  });

  it('Runbooks/Guides: matches runbook, guide boundary', () => {
    expect(deriveCategory('onenote-markdown-formatting-cleanup-runbook')).toBe('Runbooks/Guides');
    expect(deriveCategory('operational-deploy-guide')).toBe('Runbooks/Guides');
  });

  // ── New enriched rules ────────────────────────────────────────────────────

  it('Kusto: matches kusto, kql (new rule)', () => {
    expect(deriveCategory('kusto-analysis-patterns')).toBe('Kusto');
    expect(deriveCategory('kusto-query-tool-selection-mandatory-rules')).toBe('Kusto');
    expect(deriveCategory('kusto-web-explorer-url-builder')).toBe('Kusto');
    expect(deriveCategory('session-kusto-dashboard-validation-mastery-2025-08-15')).toBe('Kusto');
  });

  it('.NET: matches dotnet, csharp (new rule)', () => {
    expect(deriveCategory('dotnet_repos')).toBe('.NET');
    expect(deriveCategory('dotnet_repositories_2025')).toBe('.NET');
    expect(deriveCategory('dotnet-waWorkerHost-dump-analysis-pattern')).toBe('.NET');
  });

  it('Mermaid: matches mermaid (new rule)', () => {
    expect(deriveCategory('mermaid-transparent-background-fix')).toBe('Mermaid');
    expect(deriveCategory('mermaid-advanced-styling-comprehensive-guide')).toBe('Mermaid');
  });

  it('Governance: matches gov-, governance (new rule)', () => {
    expect(deriveCategory('gov_hash_auto_invalidation')).toBe('Governance');
    expect(deriveCategory('gov_hash_sample')).toBe('Governance');
    expect(deriveCategory('gov_update_sample')).toBe('Governance');
  });

  it('Operations: matches icm-, incident (new rule)', () => {
    expect(deriveCategory('icm-teams-cses-allocation')).toBe('Operations');
  });

  it('Documentation: matches onenote, markdown (new rule)', () => {
    expect(deriveCategory('onenote-to-markdown-conversion-ecosystem')).toBe('Documentation');
  });

  // ── Fallback ──────────────────────────────────────────────────────────────

  it('Other: returns Other for unmatched IDs', () => {
    expect(deriveCategory('generic-other-entry')).toBe('Other');
    expect(deriveCategory('alpha')).toBe('Other');
    expect(deriveCategory('beta')).toBe('Other');
    expect(deriveCategory('performance')).toBe('Other');
  });

  // ── Rule priority (first match wins) ──────────────────────────────────────

  it('Azure takes priority over Kusto for azure-kusto-*', () => {
    expect(deriveCategory('azure-kusto-cluster-queries')).toBe('Azure');
  });

  it('Service Fabric takes priority for sf-* even if also troubleshoot', () => {
    expect(deriveCategory('sf-deploy-troubleshooting-decision-tree')).toBe('Service Fabric');
  });

  it('MCP takes priority for mcp-* even if also guide', () => {
    expect(deriveCategory('mcp-index-search-guide')).toBe('MCP');
  });

  // ── CATEGORY_RULES export ─────────────────────────────────────────────────

  it('CATEGORY_RULES is a non-empty array of [RegExp, string] tuples', () => {
    expect(Array.isArray(CATEGORY_RULES)).toBe(true);
    expect(CATEGORY_RULES.length).toBeGreaterThanOrEqual(19);
    for (const [pattern, category] of CATEGORY_RULES) {
      expect(pattern).toBeInstanceOf(RegExp);
      expect(typeof category).toBe('string');
    }
  });
});

/**
 * Issue #534 defect 1 — metadata-blind classification.
 *
 * `deriveCategory` was ID-only, so every entry whose ID happened not to match a
 * rule landed in the 'Other' bucket even when its title / primaryCategory /
 * categories[] said exactly what it was (382/1277 = 29.9% of the production
 * index). These tests pin the metadata-aware fallback and — critically — the
 * PRECEDENCE between the four sources, which must be deterministic.
 *
 * Constitution refs: TS-8 (red first), TS-9 (regression test first), TS-12 (>=5 cases).
 */
describe('#534 categoryRules — deriveCategory with metadata fallback', () => {

  // ── Precedence rung 1: ID wins (backwards compatibility) ──────────────────

  it('ID rules win over every metadata field when the ID matches', () => {
    // 'azure-*' is rung 1; the metadata all point elsewhere and must be ignored.
    expect(deriveCategory('azure-batch-pool-resize', {
      title: 'Kusto query guide',
      primaryCategory: 'testing',
      categories: ['mermaid', 'docker'],
    })).toBe('Azure');
  });

  it('omitting metadata is identical to the legacy ID-only call', () => {
    const ids = [
      'azure-batch-pool-resize', 'sf-deploy-troubleshooting', 'mcp-index-search-guide',
      'generic-other-entry', 'alpha',
    ];
    for (const id of ids) {
      expect(deriveCategory(id, undefined)).toBe(deriveCategory(id));
      expect(deriveCategory(id, {})).toBe(deriveCategory(id));
    }
  });

  // ── Precedence rung 2: primaryCategory ────────────────────────────────────

  it('falls back to primaryCategory when the ID derives Other', () => {
    expect(deriveCategory('alpha', { primaryCategory: 'kusto' })).toBe('Kusto');
    expect(deriveCategory('beta', { primaryCategory: 'service-fabric' })).toBe('Service Fabric');
    expect(deriveCategory('gamma', { primaryCategory: 'dotnet' })).toBe('.NET');
  });

  // ── Precedence rung 3: categories[] ───────────────────────────────────────

  it('falls back to categories[] when ID and primaryCategory derive Other', () => {
    expect(deriveCategory('alpha', { categories: ['misc', 'mermaid'] })).toBe('Mermaid');
    expect(deriveCategory('beta', { primaryCategory: 'misc', categories: ['governance'] })).toBe('Governance');
  });

  it('scans categories[] in array order — first matching element wins', () => {
    expect(deriveCategory('alpha', { categories: ['mermaid', 'kusto'] })).toBe('Mermaid');
    expect(deriveCategory('alpha', { categories: ['kusto', 'mermaid'] })).toBe('Kusto');
  });

  // ── Precedence rung 4: title ──────────────────────────────────────────────

  it('falls back to title last, when no ID/primaryCategory/categories match', () => {
    expect(deriveCategory('alpha', { title: 'Troubleshooting the deployment' })).toBe('Debugging');
    expect(deriveCategory('beta', { title: 'Incident response rotation' })).toBe('Operations');
  });

  it('matches metadata case-insensitively (titles are prose, IDs are slugs)', () => {
    expect(deriveCategory('alpha', { title: 'Kusto Query Guide' })).toBe('Kusto');
    expect(deriveCategory('alpha', { primaryCategory: 'Governance' })).toBe('Governance');
    expect(deriveCategory('alpha', { categories: ['Mermaid'] })).toBe('Mermaid');
  });

  // ── Full precedence ladder, all four sources in conflict ──────────────────

  it('resolves conflicts as ID > primaryCategory > categories[] > title', () => {
    const meta = {
      title: 'Docker container notes',   // Containers
      primaryCategory: 'kusto',          // Kusto
      categories: ['mermaid'],           // Mermaid
    };
    // rung 2 wins while primaryCategory matches
    expect(deriveCategory('alpha', meta)).toBe('Kusto');
    // drop rung 2 -> rung 3
    expect(deriveCategory('alpha', { ...meta, primaryCategory: 'misc' })).toBe('Mermaid');
    // drop rung 3 -> rung 4
    expect(deriveCategory('alpha', { ...meta, primaryCategory: 'misc', categories: ['misc'] })).toBe('Containers');
    // drop rung 4 -> Other
    expect(deriveCategory('alpha', { title: 'misc', primaryCategory: 'misc', categories: ['misc'] })).toBe('Other');
  });

  // ── Closed label set — metadata must not invent new categories ────────────

  it('never returns a label outside CATEGORY_RULES plus Other', () => {
    // primaryCategory is a free-form slug on disk. It is matched THROUGH the
    // rules, never surfaced verbatim — otherwise the legend and colour map
    // would face an unbounded label set (see #534 defect 2).
    const allowed = new Set([...CATEGORY_RULES.map(([, label]) => label), 'Other']);
    const probes = [
      { primaryCategory: 'performance' },
      { primaryCategory: 'zzz-unknown-taxonomy' },
      { categories: ['some-new-thing'] },
      { title: 'A perfectly ordinary sentence' },
      { primaryCategory: 'Kusto', categories: ['Mermaid'], title: 'Docker' },
    ];
    for (const meta of probes) {
      expect(allowed.has(deriveCategory('alpha', meta))).toBe(true);
    }
    expect(deriveCategory('alpha', { primaryCategory: 'performance' })).toBe('Other');
  });

  // ── Edge / boundary / malformed input ─────────────────────────────────────

  it('tolerates empty, blank, and malformed metadata without throwing', () => {
    expect(deriveCategory('alpha', { categories: [] })).toBe('Other');
    expect(deriveCategory('alpha', { title: '', primaryCategory: '', categories: [''] })).toBe('Other');
    expect(deriveCategory('alpha', { categories: [undefined as unknown as string, 'kusto'] })).toBe('Kusto');
    expect(deriveCategory('alpha', { title: undefined, primaryCategory: undefined })).toBe('Other');
    expect(deriveCategory('alpha', { categories: undefined })).toBe('Other');
  });

  it('reclassifies the real-world Other-bucket shapes from #534', () => {
    // Representative of the 297 entries the issue says become classifiable.
    expect(deriveCategory('alpha', { title: 'Azure Batch pool resize' })).toBe('Azure');
    expect(deriveCategory('performance', { primaryCategory: 'testing' })).toBe('Testing');
    expect(deriveCategory('session-2025-08-15', { categories: ['kusto', 'dashboard'] })).toBe('Kusto');
    expect(deriveCategory('notes', { title: 'OneNote to Markdown conversion' })).toBe('Documentation');
    expect(deriveCategory('hardening', { primaryCategory: 'security' })).toBe('Security');
  });
});
