import { describe, expect, it, vi } from 'vitest';

import { registerProductHandlers } from '../../src/main/ipc/product-handlers';
import { IPC_CHANNELS, type IpcListener } from '../../src/shared/ipc-contract';

describe('product synchronization IPC', () => {
  it('runs the default sync through a typed handler', async () => {
    const handlers = new Map<string, IpcListener>();
    const service = {
      syncDefault: vi.fn().mockResolvedValue({ discovered: 1, succeeded: 1, failed: 0, missing: 0, failures: [] }),
      reconcileTracked: vi.fn(),
    };
    registerProductHandlers({ handle: (channel, listener) => handlers.set(channel, listener) }, service);

    await expect(handlers.get(IPC_CHANNELS.productSyncDefault)?.({}, undefined)).resolves.toEqual({
      ok: true,
      data: { discovered: 1, succeeded: 1, failed: 0, missing: 0, failures: [] },
    });
    expect(service.syncDefault).toHaveBeenCalledOnce();
  });

  it('validates tracked ids before reconciliation', async () => {
    const handlers = new Map<string, IpcListener>();
    const service = { syncDefault: vi.fn(), reconcileTracked: vi.fn() };
    registerProductHandlers({ handle: (channel, listener) => handlers.set(channel, listener) }, service);

    await expect(handlers.get(IPC_CHANNELS.productReconcileTracked)?.({}, { productIds: ['1', 2] })).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(service.reconcileTracked).not.toHaveBeenCalled();
  });
});
