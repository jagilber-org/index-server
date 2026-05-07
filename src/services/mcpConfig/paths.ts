import os from 'os';
import path from 'path';

export type McpClientTarget = 'vscode' | 'copilot-cli' | 'claude';
export type McpConfigFormat = 'vscode' | 'vscode-global' | 'copilot-cli' | 'claude';
export type McpScope = 'repo' | 'global';

export interface ResolveTargetOptions {
  targets?: McpClientTarget[];
  target?: McpClientTarget;
  scope?: McpScope;
  root?: string;
  home?: string;
  appData?: string;
}

export interface McpTargetInfo {
  target: McpClientTarget;
  format: McpConfigFormat;
  path: string;
}

function envValue(key: string): string | undefined {
  const value = process.env[key];
  return value && value.length > 0 ? value : undefined;
}

export function defaultConfigRoot(): string {
  return path.resolve(envValue('INDEX_SERVER_MCP_CONFIG_ROOT') ?? process.cwd());
}

export function resolveConfigTargets(options: ResolveTargetOptions = {}): McpTargetInfo[] {
  const pathApi = process.platform === 'win32' ? path.win32 : path.posix;
  const root = pathApi.resolve(options.root ?? defaultConfigRoot());
  const scope = options.scope ?? 'repo';
  const home = options.home ?? os.homedir();
  const appData = options.appData ?? envValue('APPDATA') ?? pathApi.join(home, 'AppData', 'Roaming');
  const targets = options.targets ?? (options.target ? [options.target] : ['vscode']);
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const results: McpTargetInfo[] = [];

  for (const target of targets) {
    if (target === 'vscode') {
      if (scope === 'global') {
        const dir = isWin ? pathApi.join(appData, 'Code', 'User') : pathApi.join(home, '.config', 'Code', 'User');
        results.push({ target, format: 'vscode-global', path: pathApi.join(dir, 'mcp.json') });
      } else {
        results.push({ target, format: 'vscode', path: pathApi.join(root, '.vscode', 'mcp.json') });
      }
    } else if (target === 'copilot-cli') {
      results.push({ target, format: 'copilot-cli', path: pathApi.join(home, '.copilot', 'mcp-config.json') });
    } else if (target === 'claude') {
      const dir = isWin
        ? pathApi.join(appData, 'Claude')
        : isMac
          ? pathApi.join(home, 'Library', 'Application Support', 'Claude')
          : pathApi.join(home, '.config', 'Claude');
      results.push({ target, format: 'claude', path: pathApi.join(dir, 'claude_desktop_config.json') });
    }
  }

  return results;
}
