/**
 * setup-wizard-paths.mjs — Platform-standard per-user data directory resolver.
 *
 * Exported so the setup wizard and tests share a single source of truth.
 *
 * Convention (env-paths style; matches VS Code, npm, gh CLI):
 *   Windows: %LOCALAPPDATA%\index-server      (default ~\AppData\Local\index-server)
 *   macOS:   ~/Library/Application Support/index-server
 *   Linux:   ${XDG_DATA_HOME:-~/.local/share}/index-server
 */
import path from 'path';

const APP_NAME = 'index-server';

/** @param {NodeJS.Platform} [platform] @param {NodeJS.ProcessEnv} [env] */
export function defaultUserRoot(platform = process.platform, env = process.env) {
  const home = env.HOME || env.USERPROFILE || '';
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA || (home ? path.join(home, 'AppData', 'Local') : '');
    return path.join(base, APP_NAME);
  }
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', APP_NAME);
  }
  const base = env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  return path.join(base, APP_NAME);
}
