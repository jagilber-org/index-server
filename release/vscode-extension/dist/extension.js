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
let outputChannel;
function activate(context) {
    outputChannel = vscode.window.createOutputChannel('Index Server');
    outputChannel.appendLine('Index Server extension activating...');
    // Register commands first so they're available even if MCP API fails
    context.subscriptions.push(vscode.commands.registerCommand('index.configure', () => configureMcpClient(context)), vscode.commands.registerCommand('index.showStatus', () => showStatus(context)), vscode.commands.registerCommand('index.openDashboard', () => openDashboard()), outputChannel);
    // Register MCP server definition providers (may not be available on all VS Code versions)
    try {
        registerMcpProviders(context);
    }
    catch (err) {
        outputChannel.appendLine(`[warn] MCP provider registration failed (API may not be available): ${err}`);
    }
    // Show activation info on first install
    const hasShownWelcome = context.globalState.get('hasShownWelcome');
    if (!hasShownWelcome) {
        void context.globalState.update('hasShownWelcome', true);
        void vscode.window.showInformationMessage('Index Server installed. Configure it now?', 'Configure', 'Later').then(choice => {
            if (choice === 'Configure') {
                void vscode.commands.executeCommand('index.configure');
            }
        });
    }
    outputChannel.appendLine('Index Server extension activated');
}
function registerMcpProviders(context) {
    // Register MCP server definition provider
    const didChangeEmitter = new vscode.EventEmitter();
    context.subscriptions.push(vscode.lm.registerMcpServerDefinitionProvider('indexProvider', {
        onDidChangeMcpServerDefinitions: didChangeEmitter.event,
        provideMcpServerDefinitions: async () => {
            const config = vscode.workspace.getConfiguration('index');
            const profile = config.get('profile', 'default');
            const dashboardEnabled = config.get('dashboard.enabled', false);
            const dashboardPort = config.get('dashboard.port', 8787);
            const logLevel = config.get('logLevel', 'info');
            const mutationEnabled = config.get('mutation.enabled', false);
            const instructionsDir = resolveInstructionsDir(context);
            const env = {
                INDEX_SERVER_PROFILE: profile ?? 'default',
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
            // Priority: user setting > workspace checkout > npx (zero-config)
            const serverPath = resolveServerPath(context);
            if (serverPath) {
                return [
                    new vscode.McpStdioServerDefinition('Index', 'node', [serverPath], env)
                ];
            }
            // Default: use npx to run the published npm package
            return [
                new vscode.McpStdioServerDefinition('Index', 'npx', ['@jagilber-org/index-server'], env)
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
    // Register MCP server definition provider
    const legacyDidChangeEmitter = new vscode.EventEmitter();
    context.subscriptions.push(vscode.lm.registerMcpServerDefinitionProvider('mcpIndexServerProvider', {
        onDidChangeMcpServerDefinitions: legacyDidChangeEmitter.event,
        provideMcpServerDefinitions: async () => {
            const serverPath = resolveServerPath(context);
            if (!serverPath) {
                return [];
            }
            const config = vscode.workspace.getConfiguration('mcpIndexServer');
            const dashboardEnabled = config.get('dashboard.enabled', false);
            const dashboardPort = config.get('dashboard.port', 3210);
            const logLevel = config.get('logLevel', 'info');
            const mutationEnabled = config.get('mutation.enabled', false);
            const instructionsDir = resolveInstructionsDir(context);
            const env = {
                MCP_LOG_LEVEL: logLevel ?? 'info',
            };
            if (mutationEnabled) {
                env.MCP_MUTATION = '1';
            }
            if (dashboardEnabled) {
                env.MCP_DASHBOARD = '1';
                env.MCP_DASHBOARD_PORT = String(dashboardPort);
            }
            if (instructionsDir) {
                env.MCP_INSTRUCTIONS_DIR = instructionsDir;
            }
            return [
                new vscode.McpStdioServerDefinition('MCP Index Server', 'node', [serverPath], env)
            ];
        },
        resolveMcpServerDefinition: async (definition) => {
            return definition;
        }
    }), legacyDidChangeEmitter);
    // Watch for config changes to refresh the MCP server definition
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('mcpIndexServer')) {
            legacyDidChangeEmitter.fire();
        }
    }));
}
function deactivate() {
    outputChannel?.appendLine('Index Server extension deactivated');
}
/**
 * Resolves the server entry point path.
 * Priority: user setting > repo workspace checkout.
 * Returns undefined to fall back to npx.
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
    // Profile picker
    const profileItems = [
        { label: 'Default', description: 'HTTP standalone — local JSON storage, minimal config', detail: 'INDEX_SERVER_PROFILE=default' },
        { label: 'Enhanced', description: 'Semantic search + HTTPS — TLS, embeddings, file logging, mutation', detail: 'INDEX_SERVER_PROFILE=enhanced' },
        { label: 'Experimental', description: 'SQLite + debug — all enhanced features plus SQLite backend', detail: 'INDEX_SERVER_PROFILE=experimental' }
    ];
    const config = vscode.workspace.getConfiguration('index');
    const picked = await vscode.window.showQuickPick(profileItems, {
        title: 'Index Server Profile',
        placeHolder: 'Choose a server profile (controls default features and storage)',
    });
    if (!picked) {
        return;
    } // cancelled
    const profile = picked.label.toLowerCase();
    await config.update('profile', profile, vscode.ConfigurationTarget.Global);
    const serverPath = resolveServerPath(context);
    const dashboardEnabled = config.get('dashboard.enabled', false);
    const dashboardPort = config.get('dashboard.port', 8787);
    const logLevel = config.get('logLevel', 'info');
    const mutationEnabled = config.get('mutation.enabled', false);
    const instructionsDir = resolveInstructionsDir(context);
    const envBlock = {
        INDEX_SERVER_PROFILE: profile,
        INDEX_SERVER_LOG_LEVEL: logLevel ?? 'info',
        ...(mutationEnabled ? { INDEX_SERVER_MUTATION: '1' } : {}),
        ...(dashboardEnabled ? { INDEX_SERVER_DASHBOARD: '1', INDEX_SERVER_DASHBOARD_PORT: String(dashboardPort) } : {}),
        ...(instructionsDir ? { INDEX_SERVER_DIR: instructionsDir } : {})
    };
    // Use local node path if available, otherwise npx (zero-config)
    const serverEntry = serverPath
        ? { type: 'stdio', command: 'node', args: [serverPath], cwd: path.dirname(path.dirname(path.dirname(serverPath))), env: envBlock }
        : { type: 'stdio', command: 'npx', args: ['@jagilber-org/index-server'], env: envBlock };
    const mcpConfig = { servers: { 'index': serverEntry } };
    const snippet = JSON.stringify(mcpConfig, null, 2);
    // Show the configuration to the user
    const doc = await vscode.workspace.openTextDocument({ content: snippet, language: 'jsonc' });
    await vscode.window.showTextDocument(doc, { preview: true });
    const writeAction = await vscode.window.showInformationMessage('MCP configuration generated. Copy this to your VS Code mcp.json or Claude Desktop config.', 'Copy to Clipboard', 'Open mcp.json');
    if (writeAction === 'Copy to Clipboard') {
        await vscode.env.clipboard.writeText(snippet);
        void vscode.window.showInformationMessage('MCP configuration copied to clipboard.');
    }
    else if (writeAction === 'Open mcp.json') {
        void vscode.commands.executeCommand('workbench.action.openSettingsJson', { revealSetting: { key: 'mcp' } });
    }
    outputChannel.appendLine(`Server path: ${serverPath}`);
    outputChannel.appendLine(`Configuration generated`);
}
async function showStatus(context) {
    const serverPath = resolveServerPath(context);
    const instructionsDir = resolveInstructionsDir(context);
    const config = vscode.workspace.getConfiguration('index');
    const lines = [
        `Index Server Status`,
        `──────────────`,
        `Profile: ${config.get('profile', 'default')}`,
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
