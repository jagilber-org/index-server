import { afterEach, describe, expect, it } from 'vitest';
import path from 'path';
import { resolveConfigTargets } from '../../../services/mcpConfig/paths';

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform });
}

describe('mcpConfig OS-aware path resolution', () => {
  afterEach(() => {
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
  });

  it('resolves Windows repo/global/client paths from root, home, and APPDATA', () => {
    setPlatform('win32');
    const root = 'C:\\repo\\index-server';
    const home = 'C:\\Users\\agent';
    const appData = 'C:\\Users\\agent\\AppData\\Roaming';
    const j = path.win32.join;
    expect(resolveConfigTargets({ target: 'vscode', scope: 'repo', root, home, appData })[0].path).toBe(j(root, '.vscode', 'mcp.json'));
    expect(resolveConfigTargets({ target: 'vscode', scope: 'global', root, home, appData })[0].path).toBe(j(appData, 'Code', 'User', 'mcp.json'));
    expect(resolveConfigTargets({ target: 'copilot-cli', root, home, appData })[0].path).toBe(j(home, '.copilot', 'mcp-config.json'));
    expect(resolveConfigTargets({ target: 'claude', root, home, appData })[0].path).toBe(j(appData, 'Claude', 'claude_desktop_config.json'));
  });

  it('resolves Linux VS Code global and Claude config paths distinctly from macOS', () => {
    setPlatform('linux');
    const root = '/repo/index-server';
    const home = '/home/agent';
    expect(resolveConfigTargets({ target: 'vscode', scope: 'global', root, home })[0].path).toBe('/home/agent/.config/Code/User/mcp.json');
    expect(resolveConfigTargets({ target: 'claude', root, home })[0].path).toBe('/home/agent/.config/Claude/claude_desktop_config.json');
  });

  it('resolves macOS Claude config under Library/Application Support', () => {
    setPlatform('darwin');
    const root = '/repo/index-server';
    const home = '/Users/agent';
    expect(resolveConfigTargets({ target: 'claude', root, home })[0].path).toBe('/Users/agent/Library/Application Support/Claude/claude_desktop_config.json');
  });
});
