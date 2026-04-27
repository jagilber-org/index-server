import { beforeEach, describe, expect, it, vi } from 'vitest';

const getRuntimeConfig = vi.fn();

vi.mock('../../config/runtimeConfig', () => ({
  getRuntimeConfig,
}));

describe('transportFactory safety', () => {
  beforeEach(() => {
    getRuntimeConfig.mockReturnValue({
      trace: new Set(['healthMixed']),
      logging: { diagnostics: false },
    });
  });

  it('setupStdoutDiagnostics leaves process.stdout.write unchanged', async () => {
    const { setupStdoutDiagnostics } = await import('../../server/transportFactory.js');
    const originalWrite = process.stdout.write;

    await setupStdoutDiagnostics();

    expect(process.stdout.write).toBe(originalWrite);
  });

  it('setupDispatcherOverride does not patch private SDK request handlers', async () => {
    const { setupDispatcherOverride } = await import('../../server/transportFactory.js');
    const onRequest = vi.fn();
    const onrequest = vi.fn();
    const server = { _onRequest: onRequest, _onrequest: onrequest };

    setupDispatcherOverride(server);

    expect(server._onRequest).toBe(onRequest);
    expect(server._onrequest).toBe(onrequest);
    expect((server as { __dispatcherOverrideActive?: boolean }).__dispatcherOverrideActive).not.toBe(true);
  });
});
