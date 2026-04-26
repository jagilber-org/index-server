import { afterEach, describe, expect, it } from 'vitest';
import { spawnServer, type ServerConnection } from '../helpers/mcpTestClient.js';

describe('sdkServer prompt/resource surface', () => {
  let conn: ServerConnection | null = null;

  afterEach(async () => {
    if (conn) {
      await conn.close();
      conn = null;
    }
  });

  it('advertises prompts and resources capabilities during initialize', async () => {
    conn = await spawnServer();

    const capabilities = conn.client.getServerCapabilities();
    expect(capabilities?.tools).toBeDefined();
    expect(capabilities?.prompts).toBeDefined();
    expect(capabilities?.resources).toBeDefined();
    expect(capabilities?.prompts?.listChanged).toBe(false);
    expect(capabilities?.resources?.listChanged).toBe(false);
  }, 30_000);

  it('lists the static Stage 2 prompts and resources', async () => {
    conn = await spawnServer();

    const prompts = await conn.client.listPrompts();
    const resources = await conn.client.listResources();

    expect(prompts.prompts.map((prompt: { name: string }) => prompt.name)).toEqual(
      expect.arrayContaining(['setup_index_server', 'configure_index_server', 'verify_index_server']),
    );
    expect(resources.resources.map((resource: { uri: string }) => resource.uri)).toEqual(
      expect.arrayContaining([
        'index://guides/quickstart',
        'index://guides/client-config',
        'index://guides/verification',
      ]),
    );
  }, 30_000);

  it('renders a targeted setup prompt for Copilot CLI', async () => {
    conn = await spawnServer();

    const prompt = await conn.client.getPrompt({
      name: 'setup_index_server',
      arguments: { client: 'copilot-cli' },
    });

    expect(prompt.description).toContain('Copilot CLI');
    const messageText = prompt.messages.map((message: { content?: { text?: string } }) => message.content?.text ?? '').join('\n');
    expect(messageText).toContain('~/.copilot/mcp-config.json');
    expect(messageText).toContain('npx -y @jagilber-org/index-server@latest --setup');
  }, 30_000);

  it('reads the quickstart resource', async () => {
    conn = await spawnServer();

    const resource = await conn.client.readResource({ uri: 'index://guides/quickstart' });
    expect(resource.contents).toHaveLength(1);
    expect(resource.contents[0].uri).toBe('index://guides/quickstart');
    expect(resource.contents[0].mimeType).toBe('text/markdown');
    expect(resource.contents[0].text).toContain('npx -y @jagilber-org/index-server@latest --setup');
    expect(resource.contents[0].text).toContain('health_check');
  }, 30_000);

  it('returns protocol errors for unknown prompts and resources', async () => {
    conn = await spawnServer();

    await expect(
      conn.client.getPrompt({ name: 'missing_prompt' }),
    ).rejects.toMatchObject({
      code: -32602,
      message: expect.stringContaining('Unknown prompt'),
    });

    await expect(
      conn.client.readResource({ uri: 'index://guides/missing' }),
    ).rejects.toMatchObject({
      code: -32602,
      message: expect.stringContaining('Unknown resource'),
    });
  }, 30_000);
});
