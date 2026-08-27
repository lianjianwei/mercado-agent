import { describe, expect, it, vi } from 'vitest';

import type { ProductPage } from '../../src/domain/product';
import { ProductNotFoundError } from '../../src/main/repositories/product-repository';
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
      { products: { page: vi.fn(), getById: vi.fn() }, sync: service },
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
      { products: { page: vi.fn(), getById: vi.fn() }, sync: service },
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
    const products = { page: vi.fn().mockReturnValue(page), getById: vi.fn() };
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
    const products = { page: vi.fn(), getById: vi.fn() };
    registerProductHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      { products, sync: { syncDefault: vi.fn(), reconcileTracked: vi.fn(), syncOne: vi.fn() } },
    );

    await expect(
      handlers.get(IPC_CHANNELS.productPage)?.({}, { state: 'deleted', offset: -1, limit: 1000 }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(products.page).not.toHaveBeenCalled();
  });

  it('returns a lean product detail view from the latest snapshot', async () => {
    const handlers = new Map<string, IpcListener>();
    const product = {
      id: 'detail-1',
      state: 'notPublished' as const,
      title: 'Coffee grinder',
      itemNumber: 'MLB-1',
      thumbnailUrl: 'https://img.test/main.jpg',
      category: '厨房用具',
      netProfit: '52.4',
      stock: '86',
      sites: ['BR'],
      sourcePrice: '18.9',
      lastSyncedAt: '2026-08-27T01:00:00.000Z',
      createdAt: '2026-08-27T01:00:00.000Z',
      updatedAt: '2026-08-27T01:00:00.000Z',
    };
    const products = { page: vi.fn(), getById: vi.fn().mockReturnValue(product) };
    const snapshots = {
      listForProduct: vi.fn().mockReturnValue([
        {
          id: 's1',
          productId: 'detail-1',
          kind: 'miaoshou' as const,
          capturedAt: '2026-08-27T01:00:00.000Z',
          payload: {
            siteCollectItemInfo: {
              collectBoxDetailId: 'detail-1',
              title: 'Coffee grinder (latest)',
              itemNum: 'MLB-1',
              notes: 'Latest description',
              notesFull: 'Longer description',
              sites: ['BR', 'MX'],
              skuMap: {
                ';0a310071;': { itemNum: 'SKU-A', stock: 12, imgUrls: ['https://img.test/a.jpg'] },
                ';502c632b;': { itemNum: 'SKU-B', stock: 3, imgUrls: ['https://img.test/b.jpg', 'https://img.test/a.jpg'] },
              },
            },
          },
        },
      ]),
    };
    registerProductHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      { products, snapshots, sync: { syncDefault: vi.fn(), reconcileTracked: vi.fn(), syncOne: vi.fn() } },
    );

    await expect(
      handlers.get(IPC_CHANNELS.productDetail)?.({}, { productId: 'detail-1' }),
    ).resolves.toEqual({
      ok: true,
      data: {
        productId: 'detail-1',
        title: 'Coffee grinder (latest)',
        description: 'Latest description',
        itemNumber: 'MLB-1',
        category: '厨房用具',
        sites: ['BR', 'MX'],
        stock: '86',
        netProfit: '52.4',
        sourcePrice: '18.9',
        mainImage: 'https://img.test/main.jpg',
        images: ['https://img.test/a.jpg', 'https://img.test/b.jpg'],
        skuList: [
          { skuKey: ';0a310071;', name: 'SKU-A', imageUrl: 'https://img.test/a.jpg', stock: '12', sourcePrice: null, netProfit: null },
          { skuKey: ';502c632b;', name: 'SKU-B', imageUrl: 'https://img.test/b.jpg', stock: '3', sourcePrice: null, netProfit: null },
        ],
      },
    });
    expect(snapshots.listForProduct).toHaveBeenCalledWith('detail-1');
  });

  it('returns NOT_FOUND when the product does not exist', async () => {
    const handlers = new Map<string, IpcListener>();
    const products = {
      page: vi.fn(),
      getById: vi.fn(() => {
        throw new ProductNotFoundError('nope');
      }),
    };
    registerProductHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      { products, sync: { syncDefault: vi.fn(), reconcileTracked: vi.fn(), syncOne: vi.fn() } },
    );

    await expect(
      handlers.get(IPC_CHANNELS.productDetail)?.({}, { productId: 'nope' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
});
