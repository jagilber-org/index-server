import fs from 'fs';
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
        // VS Code stable and VS Code Insiders maintain separate user data
        // directories. Emit an entry for each installed flavor so the wizard
        // updates every MCP-capable VS Code on the machine. If neither dir
        // exists (e.g. CI / fresh VM), fall back to stable so the user still
        // gets a config they can copy.
        const flavors: Array<{ name: string }> = [{ name: 'Code' }, { name: 'Code - Insiders' }];
        const flavorDir = (name: string) => isWin
          ? pathApi.join(appData, name, 'User')
          : isMac
            ? pathApi.join(home, 'Library', 'Application Support', name, 'User')
            : pathApi.join(home, '.config', name, 'User');
        const installed = flavors.filter(f => fs.existsSync(pathApi.dirname(flavorDir(f.name))));
        const toEmit = installed.length > 0 ? installed : [flavors[0]];
        for (const f of toEmit) {
          results.push({ target, format: 'vscode-global', path: pathApi.join(flavorDir(f.name), 'mcp.json') });
        }
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
