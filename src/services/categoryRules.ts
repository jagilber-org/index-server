/**
 * Shared category derivation rules for instruction classification.
 * Used by the embeddings dashboard and the groom remapCategories mode.
 * Order matters — first match wins.
 */

export const CATEGORY_RULES: [RegExp, string][] = [
  [/azure|arm-template|apim|batch|vmss/, 'Azure'],
  [/\bsf[-_]|service-fabric|servicefabric|collectsf|sfrp/, 'Service Fabric'],
  [/\bagent\b|agent[-_]/, 'Agent'],
  [/\bmcp\b|mcp[-_]/, 'MCP'],
  [/powershell|pwsh/, 'PowerShell'],
  [/vscode|vs-code|copilot/, 'VS Code'],
  [/\bai[-_]|\bml[-_]|\bllm\b|openai|gpt\d/, 'AI/ML'],
  [/\bgit[-_]|\brepo[-_]|github/, 'Git/Repo'],
  [/\btest|\bspec[-_]|vitest|playwright/, 'Testing'],
  [/kusto|\bkql\b/, 'Kusto'],
  [/dotnet|csharp/, '.NET'],
  [/mermaid/, 'Mermaid'],
  [/debug|troubleshoot/, 'Debugging'],
  [/docker|container/, 'Containers'],
  [/security|\bauth[-_]|authentication|secret-protection/, 'Security'],
  [/runbook|\bguide\b/, 'Runbooks/Guides'],
  [/\bgov[-_]|governance/, 'Governance'],
  [/\bicm[-_]|incident/, 'Operations'],
  [/onenote|markdown/, 'Documentation'],
];

export function deriveCategory(id: string): string {
  for (const [pattern, category] of CATEGORY_RULES) {
    if (pattern.test(id)) return category;
  }
  return 'Other';
}
