import { describe, expect, it } from 'vitest';
import {
  getReadOnlyPrompt,
  getReadOnlySurfaceCapabilities,
  listReadOnlyPrompts,
  listReadOnlyResources,
  readReadOnlyResource,
} from '../../server/mcpReadOnlySurfaces';

describe('mcpReadOnlySurfaces', () => {
  it('advertises static prompt/resource capabilities', () => {
    expect(getReadOnlySurfaceCapabilities()).toEqual({
      prompts: { listChanged: false },
      resources: { listChanged: false },
    });
  });

  it('lists prompt descriptors without exposing renderer functions', () => {
    const prompts = listReadOnlyPrompts();
    expect(prompts.map((prompt) => prompt.name)).toEqual([
      'setup_index_server',
      'configure_index_server',
      'verify_index_server',
    ]);
    expect(prompts.every((prompt) => !('render' in prompt))).toBe(true);
  });

  it('lists resource descriptors without exposing inline markdown content', () => {
    const resources = listReadOnlyResources();
    expect(resources.map((resource) => resource.uri)).toEqual([
      'index://guides/quickstart',
      'index://guides/client-config',
      'index://guides/verification',
    ]);
    expect(resources.every((resource) => !('text' in resource))).toBe(true);
  });

  it('returns null for unknown prompts and resources', () => {
    expect(getReadOnlyPrompt('missing_prompt')).toBeNull();
    expect(readReadOnlyResource('index://guides/missing')).toBeNull();
  });

  it('renders setup guidance for multiple client aliases', () => {
    const vscodePrompt = getReadOnlyPrompt('setup_index_server', { client: 'VS Code' });
    const copilotPrompt = getReadOnlyPrompt('setup_index_server', { client: 'copilot-cli' });
    const claudePrompt = getReadOnlyPrompt('setup_index_server', { client: 'my-claude-app' });
    const genericPrompt = getReadOnlyPrompt('setup_index_server', { client: '' });

    expect(vscodePrompt?.description).toContain('VS Code');
    expect(vscodePrompt?.messages[1]?.content.text).toContain('.vscode/mcp.json');

    expect(copilotPrompt?.description).toContain('Copilot CLI');
    expect(copilotPrompt?.messages[1]?.content.text).toContain('~/.copilot/mcp-config.json');
    expect(copilotPrompt?.messages[1]?.content.text).toContain('`mcpServers`');

    expect(claudePrompt?.description).toContain('Claude Desktop');
    expect(claudePrompt?.messages[1]?.content.text).toContain('claude_desktop_config.json');

    expect(genericPrompt?.description).toContain('your MCP client');
    expect(genericPrompt?.messages[1]?.content.text).toContain('`servers` or `mcpServers`');
  });

  it('renders configuration guidance for published and local-checkout flows', () => {
    const prompt = getReadOnlyPrompt('configure_index_server', { client: 'my-vscode-ext' });
    const text = prompt?.messages[1]?.content.text ?? '';

    expect(prompt?.description).toContain('VS Code');
    expect(text).toContain('.vscode/mcp.json');
    expect(text).toContain('npx -y @jagilber-org/index-server@latest');
    expect(text).toContain('dist/server/index-server.js');
  });

  it('renders verification guidance with default and custom symptoms', () => {
    const defaultPrompt = getReadOnlyPrompt('verify_index_server');
    const customPrompt = getReadOnlyPrompt('verify_index_server', { symptom: 'tools/list fails after config changes' });

    expect(defaultPrompt?.messages[0]?.content.text).toContain('the MCP client is not behaving as expected');
    expect(customPrompt?.messages[0]?.content.text).toContain('tools/list fails after config changes');
    expect(customPrompt?.messages[1]?.content.text).toContain('health_check');
    expect(customPrompt?.messages[1]?.content.text).toContain('index://guides/verification');
  });

  it('caps oversized verification symptoms to keep prompt output bounded', () => {
    const longSymptom = 'x'.repeat(700);
    const prompt = getReadOnlyPrompt('verify_index_server', { symptom: longSymptom });
    const text = prompt?.messages[0]?.content.text ?? '';

    expect(text.length).toBeLessThan(longSymptom.length);
    expect(text).toContain('Help me troubleshoot Index Server because');
  });

  it('reads all static resources with markdown payloads', () => {
    const quickstart = readReadOnlyResource('index://guides/quickstart');
    const clientConfig = readReadOnlyResource('index://guides/client-config');
    const verification = readReadOnlyResource('index://guides/verification');

    expect(quickstart?.contents[0]).toMatchObject({
      uri: 'index://guides/quickstart',
      mimeType: 'text/markdown',
    });
    expect(quickstart?.contents[0]?.text).toContain('--setup');

    expect(clientConfig?.contents[0]?.text).toContain('~/.copilot/mcp-config.json');
    expect(clientConfig?.contents[0]?.text).toContain('`mcpServers`');

    expect(verification?.contents[0]?.text).toContain('tools/list');
    expect(verification?.contents[0]?.text).toContain('health_check');
  });
});
