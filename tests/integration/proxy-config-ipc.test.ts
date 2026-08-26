import { describe, expect, it, vi } from 'vitest';

import type { ModelProxyConfig } from '../../src/domain/proxy';
import { registerProxyConfigHandlers } from '../../src/main/ipc/proxy-config-handlers';
import { IPC_CHANNELS, type IpcRegistrar, type IpcResult } from '../../src/shared/ipc-contract';

function harness(current: ModelProxyConfig = { enabled: false, protocol: 'http', host: '', port: null }) {
  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<IpcResult<unknown>>>();
  const save = vi.fn(async (value: ModelProxyConfig) => value);
  registerProxyConfigHandlers(
    { handle: (channel, listener) => void handlers.set(channel, listener) } satisfies IpcRegistrar,
    { get: () => current, save },
  );
  return { handlers, save };
}

describe('proxy configuration IPC', () => {
  it('rejects an unsafe enabled proxy before calling the service', async () => {
    const { handlers, save } = harness();
    const result = await handlers.get(IPC_CHANNELS.proxySave)?.({}, {
      enabled: true,
      protocol: 'http',
      host: 'http://127.0.0.1',
      port: 7890,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(save).not.toHaveBeenCalled();
  });

  it('returns only normalized proxy fields', async () => {
    const { handlers } = harness();
    const result = await handlers.get(IPC_CHANNELS.proxyGet)?.({}, undefined);
    expect(result).toEqual({
      ok: true,
      data: { enabled: false, protocol: 'http', host: '', port: null },
    });
  });
});
