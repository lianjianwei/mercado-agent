import { describe, expect, it, vi } from 'vitest';

import { registerInfringementHandlers } from '../../src/main/ipc/infringement-handlers';
import { IPC_CHANNELS, type IpcListener } from '../../src/shared/ipc-contract';

function snapshotPayload(productId: string, title = `Product ${productId}`) {
  return {
    siteCollectItemInfo: {
      collectBoxDetailId: productId,
      title,
      itemNum: `ITEM-${productId}`,
      attributes: [{ name: 'Brand', values: [{ name: 'ACME' }] }],
    },
  };
}

describe('infringement batch IPC', () => {
  it('analyzes a single product with forceReanalyze so re-checks always re-run AI', async () => {
    const handlers = new Map<string, IpcListener>();
    const service = {
      analyzeProduct: vi.fn().mockResolvedValue({
        id: 'run-1',
        productId: 'a',
        fingerprint: 'a'.repeat(64),
        version: 2,
        level: 'none',
        kind: 'unbranded',
        decision: {},
        createdAt: '2026-08-27T00:00:00.000Z',
      }),
      analyzeBatch: vi.fn(),
    };
    const snapshots = {
      listForProduct: vi.fn((id: string) => [
        { id: `s-${id}`, productId: id, kind: 'miaoshou' as const, capturedAt: '2026-08-27T00:00:00.000Z', payload: snapshotPayload(id) },
      ]),
    };
    const products = { page: vi.fn() };
    registerInfringementHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      { products, snapshots, repository: { listForProduct: vi.fn(), currentForProduct: vi.fn() }, service },
    );

    await handlers.get(IPC_CHANNELS.infringementAnalyze)?.({}, { productId: 'a' });

    expect(service.analyzeProduct).toHaveBeenCalledWith('a', expect.anything(), undefined, true);
  });

  it('analyzes a batch of selected product ids', async () => {
    const handlers = new Map<string, IpcListener>();
    const service = {
      analyzeProduct: vi.fn(),
      analyzeBatch: vi.fn().mockResolvedValue({ discovered: 2, succeeded: 2, failed: 0, failures: [] }),
    };
    const snapshots = {
      listForProduct: vi.fn((id: string) => [
        { id: `s-${id}`, productId: id, kind: 'miaoshou' as const, capturedAt: '2026-08-27T00:00:00.000Z', payload: snapshotPayload(id) },
      ]),
    };
    const products = { page: vi.fn() };
    registerInfringementHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      { products, snapshots, repository: { listForProduct: vi.fn(), currentForProduct: vi.fn() }, service },
    );

    await expect(
      handlers.get(IPC_CHANNELS.infringementAnalyzeBatch)?.({}, { productIds: ['a', 'b'] }),
    ).resolves.toMatchObject({ ok: true, data: { succeeded: 2, failed: 0 } });
    expect(service.analyzeBatch).toHaveBeenCalledWith(
      [
        { productId: 'a', product: expect.anything() },
        { productId: 'b', product: expect.anything() },
      ],
      undefined,
      undefined,
    );
  });

  it('analyzes every product when the id list is empty', async () => {
    const handlers = new Map<string, IpcListener>();
    const service = {
      analyzeProduct: vi.fn(),
      analyzeBatch: vi.fn().mockResolvedValue({ discovered: 2, succeeded: 2, failed: 0, failures: [] }),
    };
    const snapshots = {
      listForProduct: vi.fn((id: string) => [
        { id: `s-${id}`, productId: id, kind: 'miaoshou' as const, capturedAt: '2026-08-27T00:00:00.000Z', payload: snapshotPayload(id) },
      ]),
    };
    const productRow = (id: string) => ({
      id,
      state: 'notPublished' as const,
      title: `Product ${id}`,
      itemNumber: null,
      thumbnailUrl: null,
      category: null,
      netProfit: null,
      stock: null,
      sites: [],
      sourcePrice: null,
      localPublishState: 'notPublished' as const,
      localPublishedAt: null,
      lastSyncedAt: '2026-08-27T00:00:00.000Z',
      createdAt: '2026-08-27T00:00:00.000Z',
      updatedAt: '2026-08-27T00:00:00.000Z',
    });
    const products = {
      page: vi.fn((query: { offset: number; limit: number }) => {
        if (query.offset === 0) {
          return { items: [productRow('a'), productRow('b')], offset: 0, limit: query.limit, total: 2 };
        }
        return { items: [], offset: query.offset, limit: query.limit, total: 2 };
      }),
    };
    registerInfringementHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      { products, snapshots, repository: { listForProduct: vi.fn(), currentForProduct: vi.fn() }, service },
    );

    await handlers.get(IPC_CHANNELS.infringementAnalyzeBatch)?.({}, { productIds: [] });

    expect(service.analyzeBatch).toHaveBeenCalledWith(
      [
        { productId: 'a', product: expect.anything() },
        { productId: 'b', product: expect.anything() },
      ],
      undefined,
      undefined,
    );
  });

  it('skips products without a snapshot and reports them as failures', async () => {
    const handlers = new Map<string, IpcListener>();
    const service = {
      analyzeProduct: vi.fn(),
      analyzeBatch: vi.fn().mockResolvedValue({ discovered: 1, succeeded: 1, failed: 0, failures: [] }),
    };
    const snapshots = {
      listForProduct: vi.fn((id: string) =>
        id === 'a'
          ? [{ id: `s-${id}`, productId: id, kind: 'miaoshou' as const, capturedAt: '2026-08-27T00:00:00.000Z', payload: snapshotPayload(id) }]
          : [],
      ),
    };
    const products = { page: vi.fn() };
    registerInfringementHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      { products, snapshots, repository: { listForProduct: vi.fn(), currentForProduct: vi.fn() }, service },
    );

    await expect(
      handlers.get(IPC_CHANNELS.infringementAnalyzeBatch)?.({}, { productIds: ['a', 'no-snapshot'] }),
    ).resolves.toMatchObject({
      ok: true,
      data: { succeeded: 1, failed: 1, discovered: 2 },
    });
    expect(service.analyzeBatch).toHaveBeenCalledWith([{ productId: 'a', product: expect.anything() }], undefined, undefined);
  });

  it('forwards batch progress lines through the injected sender on the batch channel', async () => {
    const handlers = new Map<string, IpcListener>();
    const sent: Array<{ channel: string; line: string }> = [];
    const service = {
      analyzeProduct: vi.fn(),
      analyzeBatch: vi.fn(async (_items: unknown, _signal: unknown, onProgress?: (line: string) => void) => {
        onProgress?.('商品 a 侵权检测成功。');
        return { discovered: 1, succeeded: 1, failed: 0, failures: [] };
      }),
    };
    const snapshots = {
      listForProduct: vi.fn((id: string) => [
        { id: `s-${id}`, productId: id, kind: 'miaoshou' as const, capturedAt: '2026-08-27T00:00:00.000Z', payload: snapshotPayload(id) },
      ]),
    };
    const products = { page: vi.fn() };
    registerInfringementHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      {
        products,
        snapshots,
        repository: { listForProduct: vi.fn(), currentForProduct: vi.fn() },
        service,
        sendProgress: (channel, line) => sent.push({ channel, line }),
      },
    );

    await handlers.get(IPC_CHANNELS.infringementAnalyzeBatch)?.({}, { productIds: ['a'] });

    expect(sent).toEqual([{ channel: IPC_CHANNELS.infringementBatchLog, line: '商品 a 侵权检测成功。' }]);
  });
});
