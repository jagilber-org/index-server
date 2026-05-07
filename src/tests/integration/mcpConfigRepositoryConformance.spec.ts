import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const MCP_CONFIG_DIR = path.join(ROOT, 'src', 'services', 'mcpConfig');

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

describe('mcpConfig repository conformance controls', () => {
  it('enforces no regex/string editing in the shared mcpConfig backend', () => {
    const offenders = listFiles(MCP_CONFIG_DIR)
      .filter(file => /\.(ts|js)$/.test(file))
      .filter(file => {
        const source = fs.readFileSync(file, 'utf8');
        return source.includes('.replace(/') ||
          source.includes('.match(/') ||
          source.includes('RegExp(') ||
          source.includes('split(\'\\n\')') ||
          source.includes('split("\\n")');
      });
    expect(offenders).toEqual([]);
  });

  it('enforces no direct MCP config writes outside src/services/mcpConfig', () => {
    const searchRoots = [
      path.join('scripts', 'build'),
      path.join('scripts', 'dist'),
      path.join('src', 'server'),
      path.join('src', 'services'),
    ];
    const offenders = searchRoots.flatMap(root => listFiles(path.join(ROOT, root)))
      .filter(file => !file.startsWith(MCP_CONFIG_DIR))
      .filter(file => /\.(ts|js|mjs)$/.test(file))
      .filter(file => {
        const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
        return lines.some(line =>
          /writeFileSync|writeFile|renameSync|copyFileSync/.test(line) &&
          /mcp\.json|mcp-config\.json|claude_desktop_config\.json|targetInfo\.path|ct\.path/.test(line),
        );
      });
    expect(offenders).toEqual([]);
  });

  it('deletes ad-hoc setup wizard CI scripts and uses Vitest mcpConfig coverage in workflow', () => {
    expect(fs.existsSync(path.join(ROOT, 'scripts', 'ci', 'setup-wizard-config-validate.mjs'))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, 'scripts', 'ci', 'setup-wizard-crud-test.mjs'))).toBe(false);
    const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'setup-wizard-e2e.yml'), 'utf8');
    expect(workflow).toContain('npm test -- mcpConfig');
    expect(workflow).not.toContain('grep -q');
    expect(workflow).not.toContain('setup-wizard-config-validate.mjs');
    expect(workflow).not.toContain('setup-wizard-crud-test.mjs');
  });

  it('setup wizard delegates all MCP config writes to shared mcpConfig backend', () => {
    const source = fs.readFileSync(path.join(ROOT, 'scripts', 'build', 'setup-wizard.mjs'), 'utf8');
    expect(source).toContain('mcpConfig');
    expect(source).not.toContain('function writeConfigFile');
    expect(source).not.toContain('function generateMcpJson');
    expect(source).not.toContain('function generateCopilotCliJson');
    expect(source).not.toContain('function generateClaudeDesktopJson');
    expect(source).not.toContain('function parseJsonc');
  });
});
