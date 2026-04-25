type PromptArgument = {
  name: string;
  description?: string;
  required?: boolean;
};

type PromptDescriptor = {
  name: string;
  title?: string;
  description: string;
  arguments?: PromptArgument[];
  render: (args?: Record<string, string>) => {
    description?: string;
    messages: Array<{
      role: 'user' | 'assistant';
      content: { type: 'text'; text: string };
    }>;
  };
};

type StaticResource = {
  uri: string;
  name: string;
  title?: string;
  description: string;
  mimeType: 'text/markdown';
  text: string;
};

function normalizeClientTarget(value?: string): 'vscode' | 'copilot-cli' | 'claude' | 'generic' {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return 'generic';
  if (normalized.includes('code') || normalized.includes('vscode') || normalized.includes('vs code')) return 'vscode';
  if (normalized.includes('copilot')) return 'copilot-cli';
  if (normalized.includes('claude')) return 'claude';
  return 'generic';
}

function clientLabel(target?: string): string {
  switch (normalizeClientTarget(target)) {
    case 'vscode':
      return 'VS Code';
    case 'copilot-cli':
      return 'Copilot CLI';
    case 'claude':
      return 'Claude Desktop';
    default:
      return 'your MCP client';
  }
}

function clientConfigPath(target?: string): string {
  switch (normalizeClientTarget(target)) {
    case 'vscode':
      return '.vscode/mcp.json (workspace) or User/mcp.json (global)';
    case 'copilot-cli':
      return '~/.copilot/mcp-config.json';
    case 'claude':
      return 'claude_desktop_config.json';
    default:
      return 'the MCP client config file for your environment';
  }
}

function clientConfigRoot(target?: string): string {
  switch (normalizeClientTarget(target)) {
    case 'vscode':
      return '`servers`';
    case 'copilot-cli':
    case 'claude':
      return '`mcpServers`';
    default:
      return '`servers` or `mcpServers` depending on the client';
  }
}

const STATIC_RESOURCES: StaticResource[] = [
  {
    uri: 'index://guides/quickstart',
    name: 'quickstart',
    title: 'Quick Start',
    description: 'Install, configure, and verify Index Server with the MCP-native flow.',
    mimeType: 'text/markdown',
    text: [
      '# Index Server Quick Start',
      '',
      '## Recommended install',
      '',
      '```bash',
      'npx -y @jagilber-org/index-server@latest --setup',
      '```',
      '',
      'Use the setup wizard to generate MCP client config for VS Code, Copilot CLI, or Claude Desktop.',
      '',
      '## Manual configuration',
      '',
      '- Use `npx` with `@jagilber-org/index-server@latest` as the command target.',
      '- Keep `INDEX_SERVER_DIR` in a stable data folder outside client install/config directories.',
      '- Add `--dashboard` or `--dashboard-port=8787` if you want the admin UI enabled.',
      '',
      '## Verification',
      '',
      '1. Restart the MCP client.',
      '2. Confirm the server appears in the MCP server list.',
      '3. Ask the client to run `health_check`.',
      '4. Ask the client to run `bootstrap` / `index-server-bootstrap status` to confirm initialization state.',
    ].join('\n'),
  },
  {
    uri: 'index://guides/client-config',
    name: 'client-config',
    title: 'Client Configuration',
    description: 'Config file formats and best practices for VS Code, Copilot CLI, and Claude Desktop.',
    mimeType: 'text/markdown',
    text: [
      '# MCP Client Configuration',
      '',
      '## File formats',
      '',
      '- **VS Code** uses `.vscode/mcp.json` (workspace) or User `mcp.json` with a `servers` root key.',
      '- **Copilot CLI** uses `~/.copilot/mcp-config.json` with an `mcpServers` root key.',
      '- **Claude Desktop** uses `claude_desktop_config.json` with an `mcpServers` root key.',
      '',
      '## Best practices',
      '',
      '- Prefer `npx -y @jagilber-org/index-server@latest` for published installs.',
      '- Set `INDEX_SERVER_DIR` to a persistent data directory such as `C:/mcp/index-data/instructions`.',
      '- For Copilot CLI and Claude Desktop, include `cwd` when you are running a local checkout instead of the published package.',
      '- For Copilot CLI, `tools: ["*"]` keeps all tools available.',
      '',
      '## Setup wizard targets',
      '',
      '- `--target vscode`',
      '- `--target copilot-cli`',
      '- `--target claude`',
      '- multiple targets are supported with comma-separated values',
    ].join('\n'),
  },
  {
    uri: 'index://guides/verification',
    name: 'verification',
    title: 'Verification and Troubleshooting',
    description: 'Checklist for verifying the MCP connection and diagnosing common setup issues.',
    mimeType: 'text/markdown',
    text: [
      '# Verification and Troubleshooting',
      '',
      '## Basic checks',
      '',
      '1. Restart the MCP client after config changes.',
      '2. Confirm the server is listed in the client UI.',
      '3. Run `tools/list` to confirm tool discovery.',
      '4. Run `health_check` to confirm the server is reachable.',
      '5. Run bootstrap status if initialization looks gated on a fresh install.',
      '',
      '## Common causes',
      '',
      '- The config file uses the wrong root key (`servers` vs `mcpServers`).',
      '- `cwd` is missing for a local checkout configuration.',
      '- `INDEX_SERVER_DIR` points at a transient or client-owned directory.',
      '- The client was not restarted after editing the config.',
      '- The command path references a local build that has not been built yet.',
    ].join('\n'),
  },
];

const RESOURCE_BY_URI = new Map(STATIC_RESOURCES.map((resource) => [resource.uri, resource] as const));

function renderSetupPrompt(args?: Record<string, string>) {
  const client = clientLabel(args?.client);
  const configPath = clientConfigPath(args?.client);
  const configRoot = clientConfigRoot(args?.client);

  return {
    description: `Guide ${client} setup with the MCP-native install flow.`,
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Help me install and configure Index Server for ${client}. Prefer the published MCP-native flow.`,
        },
      },
      {
        role: 'assistant' as const,
        content: {
          type: 'text' as const,
          text: [
            `Use \`npx -y @jagilber-org/index-server@latest --setup\` first so ${client} configuration is generated automatically when possible.`,
            `If the user needs manual setup, edit ${configPath} and use the ${configRoot} root key.`,
            'Keep `INDEX_SERVER_DIR` in a stable data folder outside the MCP client install/config path.',
            'After configuration, restart the client and verify with `health_check` and bootstrap status.',
            'Reference resources: `index://guides/quickstart`, `index://guides/client-config`, `index://guides/verification`.',
          ].join('\n'),
        },
      },
    ],
  };
}

function renderConfigPrompt(args?: Record<string, string>) {
  const client = clientLabel(args?.client);
  const configPath = clientConfigPath(args?.client);
  const configRoot = clientConfigRoot(args?.client);

  return {
    description: `Explain the right MCP config shape for ${client}.`,
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Review or generate the MCP configuration for ${client}.`,
        },
      },
      {
        role: 'assistant' as const,
        content: {
          type: 'text' as const,
          text: [
            `Target config file: ${configPath}.`,
            `Use ${configRoot} as the root key for this client.`,
            'Prefer `npx -y @jagilber-org/index-server@latest` for published installs.',
            'Use `cwd` only for local checkout configurations that run `dist/server/index-server.js`.',
            'Set `INDEX_SERVER_DIR` to a persistent directory and keep env values as strings.',
            'Reference resource: `index://guides/client-config`.',
          ].join('\n'),
        },
      },
    ],
  };
}

function renderVerificationPrompt(args?: Record<string, string>) {
  const symptom = String(args?.symptom ?? 'the MCP client is not behaving as expected')
    .trim()
    .slice(0, 500);

  return {
    description: 'Walk through a quick verification and troubleshooting checklist.',
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Help me troubleshoot Index Server because ${symptom}.`,
        },
      },
      {
        role: 'assistant' as const,
        content: {
          type: 'text' as const,
          text: [
            'Start with protocol-level checks: confirm the server appears in the MCP client and that `tools/list` succeeds.',
            'Then run `health_check` and bootstrap status to separate connectivity problems from initialization state.',
            'Verify the config file uses the correct root key and includes `cwd` for local checkout setups.',
            'If configuration changed recently, restart the MCP client before concluding the server is broken.',
            'Reference resource: `index://guides/verification`.',
          ].join('\n'),
        },
      },
    ],
  };
}

const PROMPTS: PromptDescriptor[] = [
  {
    name: 'setup_index_server',
    title: 'Setup Index Server',
    description: 'Guide an MCP-native Index Server install and initial configuration.',
    arguments: [
      { name: 'client', description: 'Optional target client such as vscode, copilot-cli, or claude.' },
    ],
    render: renderSetupPrompt,
  },
  {
    name: 'configure_index_server',
    title: 'Configure Index Server',
    description: 'Explain the right config file shape and key settings for a target client.',
    arguments: [
      { name: 'client', description: 'Optional target client such as vscode, copilot-cli, or claude.' },
    ],
    render: renderConfigPrompt,
  },
  {
    name: 'verify_index_server',
    title: 'Verify Index Server',
    description: 'Walk through verification and troubleshooting for setup or connection issues.',
    arguments: [
      { name: 'symptom', description: 'Optional short problem statement to tailor the checklist.' },
    ],
    render: renderVerificationPrompt,
  },
];

const PROMPT_BY_NAME = new Map(PROMPTS.map((prompt) => [prompt.name, prompt] as const));

export function getReadOnlySurfaceCapabilities() {
  return {
    prompts: { listChanged: false },
    resources: { listChanged: false },
  };
}

export function listReadOnlyResources() {
  return STATIC_RESOURCES.map(({ text: _text, ...resource }) => resource);
}

export function readReadOnlyResource(uri: string) {
  const resource = RESOURCE_BY_URI.get(uri);
  if (!resource) return null;
  return {
    contents: [
      {
        uri: resource.uri,
        mimeType: resource.mimeType,
        text: resource.text,
      },
    ],
  };
}

export function listReadOnlyPrompts() {
  return PROMPTS.map(({ render: _render, ...prompt }) => prompt);
}

export function getReadOnlyPrompt(name: string, args?: Record<string, string>) {
  const prompt = PROMPT_BY_NAME.get(name);
  if (!prompt) return null;
  return prompt.render(args);
}
