"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
let outputChannel;
function activate(context) {
    outputChannel = vscode.window.createOutputChannel('Index Server');
    outputChannel.appendLine('Index Server extension activated');
    outputChannel.appendLine(`Extension path: ${context.extensionPath}`);
    // Check Node.js availability and version
    checkNodeVersion();
    // Register MCP server definition provider
    const didChangeEmitter = new vscode.EventEmitter();
    context.subscriptions.push(vscode.lm.registerMcpServerDefinitionProvider('indexProvider', {
        onDidChangeMcpServerDefinitions: didChangeEmitter.event,
        provideMcpServerDefinitions: async () => {
            const config = vscode.workspace.getConfiguration('index');
            // When managed=false, the user controls mcp.json themselves
            if (!config.get('managed', true)) {
                return [];
            }
            const dashboardEnabled = config.get('dashboard.enabled', false);
            const dashboardPort = config.get('dashboard.port', 8787);
            const logLevel = config.get('logLevel', 'info');
            const mutationEnabled = config.get('mutation.enabled', false);
            const instructionsDir = resolveInstructionsDir(context);
            const env = {
                INDEX_SERVER_LOG_LEVEL: logLevel ?? 'info',
            };
            if (mutationEnabled) {
                env.INDEX_SERVER_MUTATION = '1';
            }
            if (dashboardEnabled) {
                env.INDEX_SERVER_DASHBOARD = '1';
                env.INDEX_SERVER_DASHBOARD_PORT = String(dashboardPort);
            }
            if (instructionsDir) {
                env.INDEX_SERVER_DIR = instructionsDir;
            }
            // Merge user-supplied env vars (overrides built-in defaults)
            const customEnv = config.get('env', {});
            for (const [key, value] of Object.entries(customEnv)) {
                if (typeof value === 'string') {
                    env[key] = value;
                }
            }
            // Priority: user setting > workspace checkout > npx (zero-config)
            const serverPath = resolveServerPath(context);
            if (serverPath) {
                return [
                    new vscode.McpStdioServerDefinition('index-server', 'node', [serverPath], env)
                ];
            }
            // Last resort: npx (requires package published to npm)
            outputChannel.appendLine('WARNING: No bundled or local server found — falling back to npx @jagilber-org/index-server. This requires the package to be published to npm.');
            return [
                new vscode.McpStdioServerDefinition('index-server', 'npx', ['@jagilber-org/index-server'], env)
            ];
        },
        resolveMcpServerDefinition: async (definition) => {
            return definition;
        }
    }), didChangeEmitter);
    // Watch for config changes to refresh the MCP server definition
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('index')) {
            didChangeEmitter.fire();
        }
    }));
    // Register commands
    context.subscriptions.push(vscode.commands.registerCommand('index.configure', () => configureMcpClient(context)), vscode.commands.registerCommand('index.showStatus', () => showStatus(context)), vscode.commands.registerCommand('index.openDashboard', () => openDashboard()), outputChannel);
    // Show activation info on first install
    const hasShownWelcome = context.globalState.get('hasShownWelcome');
    if (!hasShownWelcome) {
        void context.globalState.update('hasShownWelcome', true);
        outputChannel.appendLine(`Extension installed at: ${context.extensionPath}`);
        outputChannel.show();
        void vscode.window.showInformationMessage(`Index Server installed at: ${context.extensionPath}`, 'Configure', 'Later').then(choice => {
            if (choice === 'Configure') {
                void vscode.commands.executeCommand('index.configure');
            }
        });
    }
}
function deactivate() {
    outputChannel?.appendLine('Index Server extension deactivated');
}
const MIN_NODE_MAJOR = 22;
/** Try to locate the node binary. Returns the version string or undefined. */
function probeNode() {
    // 1. Direct command (works when node is on system PATH)
    const directCmds = ['node --version'];
    // 2. Common Windows installation paths
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const localAppData = process.env.LOCALAPPDATA || '';
    const appData = process.env.APPDATA || '';
    const candidates = [
        path.join(programFiles, 'nodejs', 'node.exe'),
        ...(localAppData ? [
            path.join(localAppData, 'fnm_multishells'), // fnm
            path.join(localAppData, 'Programs', 'node', 'node.exe'),
        ] : []),
        ...(appData ? [
            path.join(appData, 'nvm', 'current', 'node.exe'), // nvm-windows
        ] : []),
    ];
    // Try direct command first
    for (const cmd of directCmds) {
        try {
            return (0, child_process_1.execSync)(cmd, { encoding: 'utf-8', timeout: 5000, windowsHide: true }).trim();
        }
        catch { /* continue */ }
    }
    // Try where.exe to find node on extended PATH
    try {
        const wherePath = (0, child_process_1.execSync)('where.exe node', { encoding: 'utf-8', timeout: 5000, windowsHide: true }).trim().split(/\r?\n/)[0];
        if (wherePath && fs.existsSync(wherePath)) {
            return (0, child_process_1.execSync)(`"${wherePath}" --version`, { encoding: 'utf-8', timeout: 5000, windowsHide: true }).trim();
        }
    }
    catch { /* continue */ }
    // Try well-known paths
    for (const candidate of candidates) {
        try {
            if (fs.existsSync(candidate)) {
                return (0, child_process_1.execSync)(`"${candidate}" --version`, { encoding: 'utf-8', timeout: 5000, windowsHide: true }).trim();
            }
        }
        catch { /* continue */ }
    }
    return undefined;
}
function checkNodeVersion() {
    const rawVersion = probeNode();
    if (rawVersion) {
        const match = rawVersion.match(/^v?(\d+)/);
        const major = match ? parseInt(match[1], 10) : 0;
        outputChannel.appendLine(`Node.js: ${rawVersion}`);
        if (major < MIN_NODE_MAJOR) {
            const msg = `Index Server requires Node.js ≥${MIN_NODE_MAJOR} but found ${rawVersion}. The MCP server may not start.`;
            outputChannel.appendLine(`WARNING: ${msg}`);
            void vscode.window.showWarningMessage(msg, 'Download Node.js').then(action => {
                if (action === 'Download Node.js') {
                    void vscode.env.openExternal(vscode.Uri.parse('https://nodejs.org/'));
                }
            });
        }
        else {
            checkNpx();
        }
    }
    else {
        // Node may still be available to VS Code's MCP runtime — warn, don't error
        const msg = 'Could not verify Node.js installation. Index Server requires Node.js ≥' + MIN_NODE_MAJOR + '. If Node.js is installed via a version manager (nvm, fnm), restart VS Code to pick up PATH changes.';
        outputChannel.appendLine(`WARNING: ${msg}`);
        void vscode.window.showWarningMessage(msg, 'Download Node.js', 'Ignore').then(action => {
            if (action === 'Download Node.js') {
                void vscode.env.openExternal(vscode.Uri.parse('https://nodejs.org/'));
            }
        });
    }
}
function checkNpx() {
    try {
        const npxVersion = (0, child_process_1.execSync)('npx --version', { encoding: 'utf-8', timeout: 5000, windowsHide: true }).trim();
        outputChannel.appendLine(`npx: ${npxVersion}`);
    }
    catch {
        const msg = 'Could not verify npx installation. Index Server uses npx by default. If using a version manager, restart VS Code.';
        outputChannel.appendLine(`WARNING: ${msg}`);
        void vscode.window.showWarningMessage(msg, 'Download Node.js', 'Ignore').then(action => {
            if (action === 'Download Node.js') {
                void vscode.env.openExternal(vscode.Uri.parse('https://nodejs.org/'));
            }
        });
    }
}
/**
 * Resolves the server entry point path.
 * Priority: user setting > repo workspace checkout > bundled in extension.
 * Returns undefined to fall back to npx (last resort).
 */
function resolveServerPath(context) {
    const config = vscode.workspace.getConfiguration('index');
    const userPath = config.get('serverPath');
    if (userPath && fs.existsSync(userPath)) {
        return userPath;
    }
    // Check if we're in the repo root (developer workflow)
    const workspaceServer = findWorkspaceServer();
    if (workspaceServer) {
        return workspaceServer;
    }
    // Check for server bundled inside the extension
    const bundledServer = path.join(context.extensionPath, 'server', 'dist', 'server', 'index-server.js');
    if (fs.existsSync(bundledServer)) {
        outputChannel.appendLine(`Using bundled server: ${bundledServer}`);
        return bundledServer;
    }
    return undefined;
}
function findWorkspaceServer() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders)
        return undefined;
    for (const folder of folders) {
        const candidate = path.join(folder.uri.fsPath, 'dist', 'server', 'index-server.js');
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return undefined;
}
function resolveInstructionsDir(context) {
    const config = vscode.workspace.getConfiguration('index');
    const userDir = config.get('instructionsDir');
    if (userDir && fs.existsSync(userDir)) {
        return userDir;
    }
    // Check bundled instructions
    const bundledDir = path.join(context.extensionPath, 'server', 'instructions');
    if (fs.existsSync(bundledDir)) {
        return bundledDir;
    }
    return undefined;
}
async function configureMcpClient(context) {
    const serverPath = resolveServerPath(context);
    const config = vscode.workspace.getConfiguration('index');
    const dashboardEnabled = config.get('dashboard.enabled', false);
    const dashboardPort = config.get('dashboard.port', 8787);
    const logLevel = config.get('logLevel', 'info');
    const mutationEnabled = config.get('mutation.enabled', false);
    const instructionsDir = resolveInstructionsDir(context);
    const envBlock = {
        INDEX_SERVER_LOG_LEVEL: logLevel ?? 'info',
        ...(mutationEnabled ? { INDEX_SERVER_MUTATION: '1' } : {}),
        ...(dashboardEnabled ? { INDEX_SERVER_DASHBOARD: '1', INDEX_SERVER_DASHBOARD_PORT: String(dashboardPort) } : {}),
        ...(instructionsDir ? { INDEX_SERVER_DIR: instructionsDir } : {})
    };
    // Merge user-supplied env vars (overrides built-in defaults)
    const customEnv = config.get('env', {});
    for (const [key, value] of Object.entries(customEnv)) {
        if (typeof value === 'string') {
            envBlock[key] = value;
        }
    }
    // Use local node path if available, otherwise npx (zero-config)
    const serverEntry = serverPath
        ? { type: 'stdio', command: 'node', args: [serverPath], cwd: path.dirname(path.dirname(path.dirname(serverPath))), env: envBlock }
        : { type: 'stdio', command: 'npx', args: ['@jagilber-org/index-server'], env: envBlock };
    const mcpConfig = { servers: { 'index-server': serverEntry } };
    const snippet = JSON.stringify(mcpConfig, null, 2);
    // Try to write mcp.json directly
    const mcpJsonPath = getMcpJsonPath();
    if (mcpJsonPath) {
        try {
            let existing = {};
            if (fs.existsSync(mcpJsonPath)) {
                const raw = fs.readFileSync(mcpJsonPath, 'utf-8');
                // Strip comments for parsing (simple // and /* */ removal)
                const stripped = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
                try {
                    existing = JSON.parse(stripped);
                }
                catch {
                    existing = {};
                }
            }
            else {
                // Ensure parent directory exists
                const dir = path.dirname(mcpJsonPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
            }
            // Merge: preserve existing servers, add/update 'index-server'
            const servers = existing.servers ?? {};
            servers['index-server'] = serverEntry;
            existing.servers = servers;
            fs.writeFileSync(mcpJsonPath, JSON.stringify(existing, null, 2), 'utf-8');
            outputChannel.appendLine(`MCP config written to: ${mcpJsonPath}`);
            const action = await vscode.window.showInformationMessage(`MCP client configured at ${mcpJsonPath}`, 'Open mcp.json', 'OK');
            if (action === 'Open mcp.json') {
                const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(mcpJsonPath));
                await vscode.window.showTextDocument(doc);
            }
        }
        catch (err) {
            outputChannel.appendLine(`Failed to write mcp.json: ${err}`);
            // Fall back to showing the config for manual copy
            await showConfigForManualCopy(snippet);
        }
    }
    else {
        await showConfigForManualCopy(snippet);
    }
    outputChannel.appendLine(`Server path: ${serverPath ?? 'npx @jagilber-org/index-server'}`);
    outputChannel.appendLine(`Configuration generated`);
}
function getMcpJsonPath() {
    // VS Code user-level mcp.json location
    const homeDir = process.env.USERPROFILE || process.env.HOME || '';
    if (!homeDir)
        return undefined;
    // Check workspace .vscode/mcp.json first
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
        const workspaceMcp = path.join(folders[0].uri.fsPath, '.vscode', 'mcp.json');
        if (fs.existsSync(workspaceMcp))
            return workspaceMcp;
    }
    // User-level: %APPDATA%/Code/User/mcp.json (Windows) or ~/.config/Code/User/mcp.json
    const appData = process.env.APPDATA;
    if (appData) {
        return path.join(appData, 'Code', 'User', 'mcp.json');
    }
    return path.join(homeDir, '.config', 'Code', 'User', 'mcp.json');
}
async function showConfigForManualCopy(snippet) {
    const doc = await vscode.workspace.openTextDocument({ content: snippet, language: 'jsonc' });
    await vscode.window.showTextDocument(doc, { preview: true });
    const writeAction = await vscode.window.showInformationMessage('Could not auto-write mcp.json. Copy this config manually.', 'Copy to Clipboard');
    if (writeAction === 'Copy to Clipboard') {
        await vscode.env.clipboard.writeText(snippet);
        void vscode.window.showInformationMessage('MCP configuration copied to clipboard.');
    }
}
async function showStatus(context) {
    const serverPath = resolveServerPath(context);
    const instructionsDir = resolveInstructionsDir(context);
    const config = vscode.workspace.getConfiguration('index');
    const lines = [
        `Index Server Status`,
        `──────────────`,
        `Server Path: ${serverPath ?? 'npx @jagilber-org/index-server (default)'}`,
        `Instructions Dir: ${instructionsDir ?? '(built-in)'}`,
        `Dashboard: ${config.get('dashboard.enabled') ? `enabled (port ${config.get('dashboard.port')})` : 'disabled'}`,
        `Mutation: ${config.get('mutation.enabled') ? 'enabled' : 'disabled'}`,
        `Log Level: ${config.get('logLevel', 'info')}`,
        `Extension Path: ${context.extensionPath}`
    ];
    outputChannel.show();
    for (const line of lines) {
        outputChannel.appendLine(line);
    }
    void vscode.window.showInformationMessage(`Index Server: ${serverPath ? 'Local server' : 'Using npx (zero-config)'}`);
}
async function openDashboard() {
    const config = vscode.workspace.getConfiguration('index');
    const dashboardEnabled = config.get('dashboard.enabled', false);
    const port = config.get('dashboard.port', 3210);
    if (!dashboardEnabled) {
        const action = await vscode.window.showWarningMessage('Dashboard is not enabled. Enable it in settings?', 'Enable', 'Cancel');
        if (action === 'Enable') {
            await config.update('dashboard.enabled', true, vscode.ConfigurationTarget.Global);
            void vscode.window.showInformationMessage('Dashboard enabled. Restart the MCP server for changes to take effect.');
        }
        return;
    }
    const url = `http://localhost:${port}`;
    void vscode.env.openExternal(vscode.Uri.parse(url));
}
