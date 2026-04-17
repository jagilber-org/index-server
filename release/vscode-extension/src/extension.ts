import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
    outputChannel = vscode.window.createOutputChannel('Index Server');
    outputChannel.appendLine('Index Server extension activating...');

    // Register commands first so they're available even if MCP API fails
    context.subscriptions.push(
        vscode.commands.registerCommand('index.configure', () => configureMcpClient(context)),
        vscode.commands.registerCommand('index.showStatus', () => showStatus(context)),
        vscode.commands.registerCommand('index.openDashboard', () => openDashboard()),
        vscode.commands.registerCommand('index.openWalkthrough', () => {
            void vscode.commands.executeCommand(
                'workbench.action.openWalkthrough',
                'jagilber-org.index-server#index.gettingStarted',
                false
            );
        }),
        outputChannel
    );

    // Register MCP server definition providers (may not be available on all VS Code versions)
    try {
        registerMcpProviders(context);
    } catch (err) {
        outputChannel.appendLine(`[warn] MCP provider registration failed (API may not be available): ${err}`);
    }

    // Show activation info on first install
    const hasShownWelcome = context.globalState.get<boolean>('hasShownWelcome');
    if (!hasShownWelcome) {
        void context.globalState.update('hasShownWelcome', true);
        void vscode.window.showInformationMessage(
            'Index Server installed. Get started with the setup walkthrough?',
            'Open Walkthrough', 'Configure', 'Later'
        ).then(choice => {
            if (choice === 'Open Walkthrough') {
                void vscode.commands.executeCommand(
                    'workbench.action.openWalkthrough',
                    'jagilber-org.index-server#index.gettingStarted',
                    false
                );
            } else if (choice === 'Configure') {
                void vscode.commands.executeCommand('index.configure');
            }
        });
    }

    outputChannel.appendLine('Index Server extension activated');
}

function registerMcpProviders(context: vscode.ExtensionContext): void {
    // Register MCP server definition provider
    const didChangeEmitter = new vscode.EventEmitter<void>();
    context.subscriptions.push(
        vscode.lm.registerMcpServerDefinitionProvider('indexProvider', {
            onDidChangeMcpServerDefinitions: didChangeEmitter.event,
            provideMcpServerDefinitions: async () => {
                const config = vscode.workspace.getConfiguration('index');
                const profile = config.get<string>('profile', 'default');
                const dashboardEnabled = config.get<boolean>('dashboard.enabled', false);
                const dashboardPort = config.get<number>('dashboard.port', 8787);
                const logLevel = config.get<string>('logLevel', 'info');
                const mutationEnabled = config.get<boolean>('mutation.enabled', false);
                const instructionsDir = resolveInstructionsDir(context);

                const env: Record<string, string> = {
                    INDEX_SERVER_PROFILE: profile ?? 'default',
                    INDEX_SERVER_LOG_LEVEL: logLevel ?? 'info',
                };
                if (mutationEnabled) { env.INDEX_SERVER_MUTATION = '1'; }
                if (dashboardEnabled) {
                    env.INDEX_SERVER_DASHBOARD = '1';
                    env.INDEX_SERVER_DASHBOARD_PORT = String(dashboardPort);
                }
                if (instructionsDir) { env.INDEX_SERVER_DIR = instructionsDir; }

                // Priority: user setting > workspace checkout > npx (zero-config)
                const serverPath = resolveServerPath(context);
                if (serverPath) {
                    return [
                        new vscode.McpStdioServerDefinition(
                            'Index',
                            'node',
                            [serverPath],
                            env
                        )
                    ];
                }

                // Default: use npx to run the published npm package
                return [
                    new vscode.McpStdioServerDefinition(
                        'Index',
                        'npx',
                        ['@jagilber-org/index-server'],
                        env
                    )
                ];
            },
            resolveMcpServerDefinition: async (definition) => {
                return definition;
            }
        }),
        didChangeEmitter
    );

    // Watch for config changes to refresh the MCP server definition
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('index')) {
                didChangeEmitter.fire();
            }
        })
    );

}

export function deactivate(): void {
    outputChannel?.appendLine('Index Server extension deactivated');
}

/**
 * Resolves the server entry point path.
 * Priority: user setting > repo workspace checkout.
 * Returns undefined to fall back to npx.
 */
function resolveServerPath(context: vscode.ExtensionContext): string | undefined {
    const config = vscode.workspace.getConfiguration('index');
    const userPath = config.get<string>('serverPath');
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

function findWorkspaceServer(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return undefined;
    for (const folder of folders) {
        const candidate = path.join(folder.uri.fsPath, 'dist', 'server', 'index-server.js');
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return undefined;
}

function resolveInstructionsDir(context: vscode.ExtensionContext): string | undefined {
    const config = vscode.workspace.getConfiguration('index');
    const userDir = config.get<string>('instructionsDir');
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

async function configureMcpClient(context: vscode.ExtensionContext): Promise<void> {
    // Profile picker
    const profileItems: vscode.QuickPickItem[] = [
        { label: 'Default', description: 'HTTP standalone — local JSON storage, minimal config', detail: 'INDEX_SERVER_PROFILE=default' },
        { label: 'Enhanced', description: 'Semantic search + HTTPS — TLS, embeddings, file logging, mutation', detail: 'INDEX_SERVER_PROFILE=enhanced' },
        { label: 'Experimental', description: 'SQLite + debug — all enhanced features plus SQLite backend', detail: 'INDEX_SERVER_PROFILE=experimental' }
    ];

    const config = vscode.workspace.getConfiguration('index');

    const picked = await vscode.window.showQuickPick(profileItems, {
        title: 'Index Server Profile',
        placeHolder: 'Choose a server profile (controls default features and storage)',
    });
    if (!picked) { return; } // cancelled

    const profile = picked.label.toLowerCase();
    await config.update('profile', profile, vscode.ConfigurationTarget.Global);

    // Format picker — VS Code mcp.json vs Copilot CLI mcp-config.json vs Both
    const formatItems: vscode.QuickPickItem[] = [
        { label: 'VS Code (mcp.json)', description: 'Uses "servers" key — for .vscode/mcp.json or global VS Code config', detail: 'Recommended for VS Code Copilot Chat' },
        { label: 'Copilot CLI (mcp-config.json)', description: 'Uses "mcpServers" key — for ~/.copilot/mcp-config.json', detail: 'For GitHub Copilot CLI and compatible clients' },
        { label: 'Both', description: 'Generate both formats side by side', detail: 'Compare and choose the right one for your setup' },
    ];

    const formatPicked = await vscode.window.showQuickPick(formatItems, {
        title: 'Configuration Format',
        placeHolder: 'Which MCP client are you configuring?',
    });
    if (!formatPicked) { return; } // cancelled

    const format = formatPicked.label.startsWith('VS Code') ? 'vscode'
        : formatPicked.label.startsWith('Copilot') ? 'copilot-cli'
        : 'both';

    const serverPath = resolveServerPath(context);

    const dashboardPort = config.get<number>('dashboard.port', 8787);
    const logLevel = config.get<string>('logLevel', 'info');
    const instructionsDir = resolveInstructionsDir(context);

    const envBlock = buildProfileEnvBlock(profile, {
        logLevel: logLevel ?? 'info',
        dashboardPort,
        instructionsDir,
    });

    // Build server entry base
    const serverCwd = serverPath ? path.dirname(path.dirname(path.dirname(serverPath))) : undefined;

    let snippet: string;
    if (format === 'vscode' || format === 'both') {
        const vscodeEntry: Record<string, unknown> = serverPath
            ? { type: 'stdio', command: 'node', args: [serverPath], cwd: serverCwd, env: envBlock }
            : { type: 'stdio', command: 'npx', args: ['@jagilber-org/index-server'], env: envBlock };
        const vscodeConfig = { servers: { 'index-server': vscodeEntry } };
        snippet = generateJsoncConfig(vscodeConfig, profile, 'vscode');
    }

    if (format === 'copilot-cli' || format === 'both') {
        const cliEntry: Record<string, unknown> = serverPath
            ? { type: 'stdio', command: 'node', args: [path.relative(serverCwd!, serverPath).replace(/\\/g, '/')], cwd: serverCwd!.replace(/\\/g, '/'), env: envBlock, tools: ['*'] }
            : { type: 'stdio', command: 'npx', args: ['@jagilber-org/index-server'], env: envBlock, tools: ['*'] };
        const cliConfig = { mcpServers: { 'index-server': cliEntry } };
        const cliSnippet = generateJsoncConfig(cliConfig, profile, 'copilot-cli');
        snippet = format === 'both'
            ? snippet! + '\n\n' + '// ' + '─'.repeat(70) + '\n\n' + cliSnippet
            : cliSnippet;
    }

    // Show the configuration to the user
    const doc = await vscode.workspace.openTextDocument({ content: snippet!, language: 'jsonc' });
    await vscode.window.showTextDocument(doc, { preview: true });

    // Build contextual action buttons
    const actions = ['Copy to Clipboard'];
    if (format === 'vscode' || format === 'both') { actions.push('Open mcp.json'); }
    if (format === 'copilot-cli' || format === 'both') { actions.push('Open mcp-config.json'); }

    const writeAction = await vscode.window.showInformationMessage(
        `MCP configuration generated (${formatPicked.label}). Save it to the appropriate config file.`,
        ...actions
    );

    if (writeAction === 'Copy to Clipboard') {
        await vscode.env.clipboard.writeText(snippet!);
        void vscode.window.showInformationMessage('MCP configuration copied to clipboard.');
    } else if (writeAction === 'Open mcp.json') {
        void vscode.commands.executeCommand('workbench.action.openSettingsJson', { revealSetting: { key: 'mcp' } });
    } else if (writeAction === 'Open mcp-config.json') {
        const copilotConfigPath = path.join(process.env.USERPROFILE ?? process.env.HOME ?? '~', '.copilot', 'mcp-config.json');
        try {
            if (!fs.existsSync(path.dirname(copilotConfigPath))) {
                fs.mkdirSync(path.dirname(copilotConfigPath), { recursive: true });
            }
            if (!fs.existsSync(copilotConfigPath)) {
                fs.writeFileSync(copilotConfigPath, '{\n  "mcpServers": {}\n}\n', 'utf8');
            }
            const uri = vscode.Uri.file(copilotConfigPath);
            const configDoc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(configDoc);
        } catch (err) {
            void vscode.window.showErrorMessage(`Could not open ${copilotConfigPath}: ${err}`);
        }
    }

    outputChannel.appendLine(`Server path: ${serverPath}`);
    outputChannel.appendLine(`Configuration generated`);
}

async function showStatus(context: vscode.ExtensionContext): Promise<void> {
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

async function openDashboard(): Promise<void> {
    const config = vscode.workspace.getConfiguration('index');
    const dashboardEnabled = config.get<boolean>('dashboard.enabled', false);
    const port = config.get<number>('dashboard.port', 8787);

    if (!dashboardEnabled) {
        const action = await vscode.window.showWarningMessage(
            'Dashboard is not enabled. Enable it in settings?',
            'Enable', 'Cancel'
        );
        if (action === 'Enable') {
            await config.update('dashboard.enabled', true, vscode.ConfigurationTarget.Global);
            void vscode.window.showInformationMessage('Dashboard enabled. Restart the MCP server for changes to take effect.');
        }
        return;
    }

    const url = `http://localhost:${port}`;
    void vscode.env.openExternal(vscode.Uri.parse(url));
}

/**
 * Build a profile-aware env block for the MCP server config.
 * Enhanced/experimental profiles include semantic, TLS, features, and storage vars.
 * All vars are included with descriptions as JSONC comments when rendered.
 */
function buildProfileEnvBlock(
    profile: string,
    opts: { logLevel: string; dashboardPort: number; instructionsDir?: string }
): Record<string, string> {
    const isEnhanced = profile === 'enhanced' || profile === 'experimental';
    const isSqlite = profile === 'experimental';

    const env: Record<string, string> = {
        // Core
        INDEX_SERVER_PROFILE: profile,
        INDEX_SERVER_LOG_LEVEL: opts.logLevel,
        INDEX_SERVER_DASHBOARD: '1',
        INDEX_SERVER_DASHBOARD_PORT: String(opts.dashboardPort),
    };

    if (opts.instructionsDir) {
        env.INDEX_SERVER_DIR = opts.instructionsDir;
    }

    // Enhanced + Experimental: mutation, features, semantic, TLS, logging
    if (isEnhanced) {
        env.INDEX_SERVER_MUTATION = '1';
        env.INDEX_SERVER_FEATURES = 'usage';
        env.INDEX_SERVER_METRICS_FILE_STORAGE = '1';
        env.INDEX_SERVER_LOG_FILE = '1';
        // Semantic search
        env.INDEX_SERVER_SEMANTIC_ENABLED = '1';
        env.INDEX_SERVER_SEMANTIC_LOCAL_ONLY = '0';
        env.INDEX_SERVER_SEMANTIC_MODEL = 'Xenova/all-MiniLM-L6-v2';
        env.INDEX_SERVER_SEMANTIC_DEVICE = 'cpu';
        // TLS
        env.INDEX_SERVER_DASHBOARD_TLS = '1';
        env.INDEX_SERVER_DASHBOARD_TLS_CERT = '';
        env.INDEX_SERVER_DASHBOARD_TLS_KEY = '';
    }

    // Experimental: SQLite + debug
    if (isSqlite) {
        env.INDEX_SERVER_STORAGE_BACKEND = 'sqlite';
        env.INDEX_SERVER_LOG_LEVEL = 'debug';
    }

    return env;
}

/** Env var descriptions for JSONC output */
const ENV_DESCRIPTIONS: Record<string, string> = {
    INDEX_SERVER_PROFILE: 'Configuration profile: default | enhanced | experimental',
    INDEX_SERVER_LOG_LEVEL: 'Log level: error | warn | info | debug | trace',
    INDEX_SERVER_DASHBOARD: 'Enable the web dashboard (0=off, 1=on)',
    INDEX_SERVER_DASHBOARD_PORT: 'Dashboard listen port',
    INDEX_SERVER_DIR: 'Instruction catalog directory (your knowledge base)',
    INDEX_SERVER_MUTATION: 'Enable write operations: add, update, delete (0=off, 1=on)',
    INDEX_SERVER_FEATURES: 'Feature flags: usage,window,hotness,drift,risk',
    INDEX_SERVER_METRICS_FILE_STORAGE: 'Persist metrics to disk (0=off, 1=on)',
    INDEX_SERVER_LOG_FILE: 'File logging (0=off, 1=default path, or absolute path)',
    INDEX_SERVER_SEMANTIC_ENABLED: 'Enable semantic (vector) search (0=off, 1=on)',
    INDEX_SERVER_SEMANTIC_LOCAL_ONLY: 'Block remote model downloads (0=allow, 1=local only)',
    INDEX_SERVER_SEMANTIC_MODEL: 'HuggingFace model name for embeddings',
    INDEX_SERVER_SEMANTIC_DEVICE: 'Compute device: cpu | cuda | dml (Windows ML)',
    INDEX_SERVER_SEMANTIC_CACHE_DIR: 'Directory for downloaded model files (~90MB)',
    INDEX_SERVER_EMBEDDING_PATH: 'Cached embeddings file path',
    INDEX_SERVER_DASHBOARD_TLS: 'Enable HTTPS for dashboard (0=off, 1=on)',
    INDEX_SERVER_DASHBOARD_TLS_CERT: 'Path to TLS certificate file (.crt/.pem)',
    INDEX_SERVER_DASHBOARD_TLS_KEY: 'Path to TLS private key file (.key/.pem)',
    INDEX_SERVER_STORAGE_BACKEND: 'Storage engine: json | sqlite',
    INDEX_SERVER_FEEDBACK_DIR: 'Feedback entries storage directory',
    INDEX_SERVER_BACKUPS_DIR: 'Backup snapshots directory',
    INDEX_SERVER_STATE_DIR: 'Runtime state files directory',
    INDEX_SERVER_MODE: 'Instance mode: standalone | leader | follower | auto',
    INDEX_SERVER_AUTO_BACKUP: 'Automatic backups (0=off, 1=on; on by default when mutation enabled)',
};

/**
 * Generate JSONC string with inline comments describing each env var.
 * @param format - 'vscode' for servers key, 'copilot-cli' for mcpServers key
 */
function generateJsoncConfig(mcpConfig: Record<string, unknown>, profile: string, format: 'vscode' | 'copilot-cli'): string {
    // Serialize to JSON first, then add comments to env var lines
    const json = JSON.stringify(mcpConfig, null, 2);
    const lines = json.split('\n');
    const result: string[] = [];

    const isInsiders = vscode.env.appName.includes('Insiders');
    const appFolder = isInsiders ? 'Code - Insiders' : 'Code';

    if (format === 'vscode') {
        result.push(`// Index Server MCP configuration — profile: ${profile}`);
        result.push(`// Format: VS Code mcp.json (uses "servers" key)`);
        result.push('// Copy to .vscode/mcp.json (workspace) or global config:');
        result.push(`//   Windows: %USERPROFILE%\\AppData\\Roaming\\${appFolder}\\User\\mcp.json`);
        result.push(`//   macOS:   ~/Library/Application Support/${appFolder}/User/mcp.json`);
        result.push(`//   Linux:   ~/.config/${appFolder}/User/mcp.json`);
    } else {
        result.push(`// Index Server MCP configuration — profile: ${profile}`);
        result.push(`// Format: Copilot CLI mcp-config.json (uses "mcpServers" key)`);
        result.push('// Copy to ~/.copilot/mcp-config.json (global):');
        result.push(`//   Windows: %USERPROFILE%\\.copilot\\mcp-config.json`);
        result.push(`//   macOS:   ~/.copilot/mcp-config.json`);
        result.push(`//   Linux:   ~/.copilot/mcp-config.json`);
        result.push('// Note: All values must be strings. VS Code can also discover this config');
        result.push('// via chat.mcp.discovery.enabled setting.');
    }

    for (const line of lines) {
        const match = line.match(/^(\s*)"(INDEX_SERVER_\w+)":\s*"(.*)"/);
        if (match) {
            const desc = ENV_DESCRIPTIONS[match[2]];
            if (desc) {
                result.push(`${match[1]}// ${desc}`);
            }
        }
        result.push(line);
    }
    return result.join('\n');
}
