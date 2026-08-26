import { describe, expect, it, vi } from 'vitest';

import { registerDiagnosticHandlers } from '../../src/main/ipc/diagnostic-handlers';
import {
  IPC_CHANNELS,
  type DiagnosticSnapshot,
  type IpcRegistrar,
  type IpcResult,
} from '../../src/shared/ipc-contract';

describe('diagnostic IPC', () => {
  it('returns diagnostics without credential or provider secrets', async () => {
    const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<IpcResult<unknown>>>();
    const registrar: IpcRegistrar = {
      handle: (channel, listener) => void handlers.set(channel, listener),
    };
    const snapshot: DiagnosticSnapshot = {
      app: { version: '0.1.0', platform: 'darwin' },
      databasePath: '/Users/test/mercado-agent.sqlite3',
      completeness: {
        textProvider: true,
        imageProvider: false,
        miaoshou: true,
        qiniu: false,
      },
    };
    registerDiagnosticHandlers(registrar, {
      getSnapshot: () => snapshot,
      connectionTests: { test: vi.fn() },
    });

    const response = await handlers.get(IPC_CHANNELS.diagnosticGetSnapshot)?.({}, undefined);
    expect(response).toEqual({ ok: true, data: snapshot });
    expect(JSON.stringify(response)).not.toContain('apiKey');
    expect(JSON.stringify(response)).not.toContain('secret');
  });

  it('validates model kind and supports cancelling the active test', async () => {
    const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<IpcResult<unknown>>>();
    const registrar: IpcRegistrar = {
      handle: (channel, listener) => void handlers.set(channel, listener),
    };
    let receivedSignal: AbortSignal | undefined;
    registerDiagnosticHandlers(registrar, {
      getSnapshot: vi.fn(),
      connectionTests: {
        test: vi.fn(async (_kind, signal) => {
          receivedSignal = signal;
          await new Promise<void>((resolve) =>
            signal?.addEventListener('abort', () => resolve(), { once: true }),
          );
          return {
            ok: false,
            status: 'cancelled' as const,
            message: '连接测试已取消。',
            latencyMs: 1,
          };
        }),
      },
    });

    const testPromise = handlers.get(IPC_CHANNELS.diagnosticTestConnection)?.({}, 'text');
    await Promise.resolve();
    expect(receivedSignal?.aborted).toBe(false);
    await handlers.get(IPC_CHANNELS.diagnosticCancelConnection)?.({}, 'text');
    await expect(testPromise).resolves.toMatchObject({
      ok: true,
      data: { status: 'cancelled' },
    });

    await expect(
      handlers.get(IPC_CHANNELS.diagnosticTestConnection)?.({}, 'video'),
    ).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });
});
