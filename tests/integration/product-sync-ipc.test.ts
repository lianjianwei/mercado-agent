import { describe, expect, it, vi } from 'vitest';

import type { ProductPage } from '../../src/domain/product';
import { registerProductHandlers } from '../../src/main/ipc/product-handlers';
import { IPC_CHANNELS, type IpcListener } from '../../src/shared/ipc-contract';

describe('product synchronization IPC', () => {
  it('runs the default sync through a typed handler', async () => {
    const handlers = new Map<string, IpcListener>();
    const service = {
      syncDefault: vi.fn().mockResolvedValue({ discovered: 1, succeeded: 1, failed: 0, missing: 0, failures: [] }),
      reconcileTracked: vi.fn(),
      syncOne: vi.fn(),
    };
    registerProductHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      { products: { page: vi.fn() }, sync: service },
    );

    await expect(handlers.get(IPC_CHANNELS.productSyncDefault)?.({}, undefined)).resolves.toEqual({
      ok: true,
      data: { discovered: 1, succeeded: 1, failed: 0, missing: 0, failures: [] },
    });
    expect(service.syncDefault).toHaveBeenCalledOnce();
  });

  it('validates tracked ids before reconciliation', async () => {
    const handlers = new Map<string, IpcListener>();
    const service = { syncDefault: vi.fn(), reconcileTracked: vi.fn(), syncOne: vi.fn() };
    registerProductHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      { products: { page: vi.fn() }, sync: service },
    );

    await expect(handlers.get(IPC_CHANNELS.productReconcileTracked)?.({}, { productIds: ['1', 2] })).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(service.reconcileTracked).not.toHaveBeenCalled();
  });

  it('returns a state-filtered product page through IPC', async () => {
    const handlers = new Map<string, IpcListener>();
    const page: ProductPage = {
      items: [
        {
          id: 'detail-1',
          state: 'notPublished',
          title: 'Coffee grinder',
          itemNumber: 'MLB-1',
          thumbnailUrl: null,
          category: null,
          netProfit: null,
          stock: null,
          sites: [],
          sourcePrice: null,
          lastSyncedAt: '2026-08-27T01:00:00.000Z',
          createdAt: '2026-08-27T01:00:00.000Z',
          updatedAt: '2026-08-27T01:00:00.000Z',
        },
      ],
      offset: 0,
      limit: 20,
      total: 1,
    };
    const service = {
      syncDefault: vi.fn(),
      reconcileTracked: vi.fn(),
      syncOne: vi.fn(),
    };
    const products = { page: vi.fn().mockReturnValue(page) };
    registerProductHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      { products, sync: service },
    );

    await expect(
      handlers.get(IPC_CHANNELS.productPage)?.({}, { state: 'notPublished', offset: 0, limit: 20 }),
    ).resolves.toEqual({ ok: true, data: page });
    expect(products.page).toHaveBeenCalledWith({ state: 'notPublished', offset: 0, limit: 20 });
  });

  it('rejects invalid product page requests', async () => {
    const handlers = new Map<string, IpcListener>();
    const products = { page: vi.fn() };
    registerProductHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      { products, sync: { syncDefault: vi.fn(), reconcileTracked: vi.fn(), syncOne: vi.fn() } },
    );

    await expect(
      handlers.get(IPC_CHANNELS.productPage)?.({}, { state: 'deleted', offset: -1, limit: 1000 }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(products.page).not.toHaveBeenCalled();
  });
});
