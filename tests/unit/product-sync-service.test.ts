import { describe, expect, it, vi } from 'vitest';

import type { MiaoshouGateway } from '../../src/main/gateways/miaoshou/miaoshou-gateway';
import { MiaoshouApiError } from '../../src/main/gateways/miaoshou/errors';
import type { CollectBoxDetailDto, CollectBoxListItemDto } from '../../src/shared/miaoshou-schemas';
import type {
  ProductRepository,
  ProductSnapshotRepository,
  ProductPage,
  Product,
  ProductSnapshot,
} from '../../src/domain/product';
import { ProductSyncService } from '../../src/main/services/product-sync-service';

const item = (id: string): CollectBoxListItemDto => ({
  collectBoxDetailId: id,
  title: `Product ${id}`,
  itemNum: `ITEM-${id}`,
  thumbnail: `https://img.test/${id}.jpg`,
  breadcrumb: '厨房用具 / 咖啡机',
  globalPrice: 52.4,
  stock: 86,
  price: 18.9,
  sites: ['MX', 'BR'],
});

const detail = (id: string): CollectBoxDetailDto => ({
  siteCollectItemInfo: { collectBoxDetailId: id, title: `Product ${id}` },
});

const detailWithListColumns = (id: string): CollectBoxDetailDto => ({
  siteCollectItemInfo: {
    collectBoxDetailId: id,
    title: `Product ${id}`,
    cateList: ['发饰、头饰', '发箍'],
    sites: ['BR(Up)', 'MX(Up)'],
    skuMap: {
      ';red;': { stock: 42, originPrice: 12.5, imgUrls: ['https://img.test/1.jpg'] },
      ';blue;': { stock: 7, originPrice: 9.9 },
    },
  },
});

function fakeRepositories() {
  const products = new Map<string, Product>();
  const snapshots: ProductSnapshot[] = [];
  const productRepository: ProductRepository & { transaction<T>(fn: () => T): T } = {
    upsertRemoteIdentity: vi.fn((input) => {
      const product = {
        id: input.id,
        state: input.state,
        title: input.title ?? null,
        itemNumber: input.itemNumber ?? null,
        thumbnailUrl: input.thumbnailUrl ?? null,
        category: input.category ?? null,
        netProfit: input.netProfit ?? null,
        stock: input.stock ?? null,
        sites: input.sites ?? [],
        sourcePrice: input.sourcePrice ?? null,
        lastSyncedAt: input.syncedAt,
        createdAt: input.syncedAt,
        updatedAt: input.syncedAt,
      };
      products.set(input.id, product);
      return product;
    }),
    transition: vi.fn((id, state, at) => { const product = products.get(id); if (!product) throw new Error('missing'); product.state = state; product.lastSyncedAt = at; }),
    page: vi.fn((query): ProductPage => ({ items: [...products.values()].filter((p) => !query.state || p.state === query.state), offset: query.offset, limit: query.limit, total: products.size })),
    getById: vi.fn((id) => { const product = products.get(id); if (!product) throw new Error('missing'); return product; }),
    delete: vi.fn((id) => { products.delete(id); }),
    transaction: (fn) => fn(),
  };
  const snapshotRepository: ProductSnapshotRepository = {
    append: vi.fn((snapshot) => snapshots.push(snapshot)),
    listForProduct: vi.fn((id) => snapshots.filter((snapshot) => snapshot.productId === id)),
  };
  return { productRepository, snapshotRepository, products, snapshots };
}

describe('ProductSyncService', () => {
  it('paginates notPublished items, deduplicates ids, and writes identity plus snapshot', async () => {
    const repositories = fakeRepositories();
    const gateway: MiaoshouGateway = {
      listCollectBox: vi.fn(async (input) => {
        const status = input.filter?.status;
        if (status === 'notPublished') {
          // First page, then a second page with an overlapping item to prove dedup.
          return input.pageNo === 1
            ? { pageNo: 1, pageSize: 20, total: 3, hasMore: true, items: [item('1'), item('2')] }
            : { pageNo: 2, pageSize: 20, total: 3, hasMore: false, items: [item('2'), item('3')] };
        }
        return { pageNo: 1, pageSize: 20, total: 0, hasMore: false, items: [] };
      }),
      getCollectBoxDetail: vi.fn(async (id) => detail(id)),
    };
    const service = new ProductSyncService(gateway, repositories.productRepository, repositories.snapshotRepository, { now: () => '2026-08-27T00:00:00.000Z' });

    await expect(service.syncDefault()).resolves.toMatchObject({ discovered: 3, succeeded: 3, failed: 0 });
    expect(gateway.listCollectBox).toHaveBeenNthCalledWith(
      1,
      {
        pageNo: 1,
        pageSize: 20,
        filter: { status: 'notPublished' },
      },
      undefined,
    );
    expect(gateway.listCollectBox).toHaveBeenNthCalledWith(
      2,
      {
        pageNo: 2,
        pageSize: 20,
        filter: { status: 'notPublished' },
      },
      undefined,
    );
    expect(gateway.getCollectBoxDetail).toHaveBeenCalledTimes(3);
    expect(repositories.snapshots).toHaveLength(3);
    expect(repositories.productRepository.upsertRemoteIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        category: '厨房用具 / 咖啡机',
        netProfit: '52.4',
        stock: '86',
        sites: ['MX', 'BR'],
        sourcePrice: '18.9',
      }),
    );
  });

  it('continues a batch when one detail fails and reports the failed id', async () => {
    const repositories = fakeRepositories();
    const gateway: MiaoshouGateway = {
      listCollectBox: vi.fn(async (input) => input.filter?.status === 'notPublished'
        ? { pageNo: 1, pageSize: 20, total: 2, hasMore: false, items: [item('1'), item('2')] }
        : { pageNo: 1, pageSize: 20, total: 0, hasMore: false, items: [] }),
      getCollectBoxDetail: vi.fn(async (id) => { if (id === '1') throw new Error('detail unavailable'); return detail(id); }),
    };
    const service = new ProductSyncService(gateway, repositories.productRepository, repositories.snapshotRepository);

    await expect(service.syncDefault()).resolves.toMatchObject({ discovered: 2, succeeded: 1, failed: 1, failures: [{ id: '1' }] });
    expect(repositories.productRepository.upsertRemoteIdentity).toHaveBeenCalledTimes(1);
  });

  it('syncs all three lifecycle states during a full sync', async () => {
    const repositories = fakeRepositories();
    const gateway: MiaoshouGateway = {
      listCollectBox: vi.fn(async (input) => {
        const status = input.filter?.status;
        if (status === 'notPublished') return { pageNo: 1, pageSize: 20, total: 1, hasMore: false, items: [item('1')] };
        if (status === 'timingPublish') return { pageNo: 1, pageSize: 20, total: 1, hasMore: false, items: [item('2')] };
        return { pageNo: 1, pageSize: 20, total: 1, hasMore: false, items: [item('3')] };
      }),
      getCollectBoxDetail: vi.fn(async (id) => detail(id)),
    };
    const service = new ProductSyncService(gateway, repositories.productRepository, repositories.snapshotRepository, { now: () => '2026-08-27T00:00:00.000Z' });

    await expect(service.syncDefault()).resolves.toMatchObject({ discovered: 3, succeeded: 3, failed: 0 });
    expect(repositories.products.get('1')?.state).toBe('notPublished');
    expect(repositories.products.get('2')?.state).toBe('timingPublish');
    expect(repositories.products.get('3')?.state).toBe('published');
    expect(gateway.listCollectBox).toHaveBeenNthCalledWith(
      1,
      { pageNo: 1, pageSize: 20, filter: { status: 'notPublished' } },
      undefined,
    );
    expect(gateway.listCollectBox).toHaveBeenNthCalledWith(
      2,
      { pageNo: 1, pageSize: 20, filter: { status: 'timingPublish' } },
      undefined,
    );
    expect(gateway.listCollectBox).toHaveBeenNthCalledWith(
      3,
      { pageNo: 1, pageSize: 20, filter: { status: 'published' } },
      undefined,
    );
  });

  it('reconciles tracked ids across timingPublish and published before marking missing', async () => {
    const repositories = fakeRepositories();
    repositories.productRepository.upsertRemoteIdentity({ id: '1', state: 'notPublished', title: 'One', syncedAt: '2026-08-26T00:00:00.000Z' });
    repositories.productRepository.upsertRemoteIdentity({ id: '2', state: 'notPublished', title: 'Two', syncedAt: '2026-08-26T00:00:00.000Z' });
    const gateway: MiaoshouGateway = {
      listCollectBox: vi.fn(async (input) => input.filter?.status === 'timingPublish'
        ? { pageNo: 1, pageSize: 20, total: 1, hasMore: false, items: [item('1')] }
        : { pageNo: 1, pageSize: 20, total: 0, hasMore: false, items: [] }),
      getCollectBoxDetail: vi.fn(async (id) => detail(id)),
    };
    const service = new ProductSyncService(gateway, repositories.productRepository, repositories.snapshotRepository, { now: () => '2026-08-27T01:00:00.000Z' });

    await expect(service.reconcileTracked(['1', '2'])).resolves.toMatchObject({ discovered: 1, succeeded: 1, missing: 1, failed: 0 });
    expect(repositories.products.get('1')?.state).toBe('timingPublish');
    expect(repositories.products.get('2')?.state).toBe('missing');
  });

  it('stops before another page when cancelled', async () => {
    const controller = new AbortController();
    const repositories = fakeRepositories();
    const gateway: MiaoshouGateway = {
      listCollectBox: vi.fn(async () => { controller.abort(); return { pageNo: 1, pageSize: 20, total: 40, hasMore: true, items: [item('1')] }; }),
      getCollectBoxDetail: vi.fn(async (id) => detail(id)),
    };
    const service = new ProductSyncService(gateway, repositories.productRepository, repositories.snapshotRepository);

    await expect(service.syncDefault(controller.signal)).rejects.toThrow('同步已取消');
    expect(gateway.listCollectBox).toHaveBeenCalledTimes(1);
  });

  it('propagates cancellation that occurs during a detail request', async () => {
    const controller = new AbortController();
    const repositories = fakeRepositories();
    const gateway: MiaoshouGateway = {
      listCollectBox: vi.fn().mockResolvedValue({ pageNo: 1, pageSize: 20, total: 1, hasMore: false, items: [item('1')] }),
      getCollectBoxDetail: vi.fn(async () => {
        controller.abort();
        throw new Error('request cancelled');
      }),
    };
    const service = new ProductSyncService(gateway, repositories.productRepository, repositories.snapshotRepository);

    await expect(service.syncDefault(controller.signal)).rejects.toThrow('同步已取消');
    expect(repositories.productRepository.upsertRemoteIdentity).not.toHaveBeenCalled();
  });

  it('syncs a single product by id, keeping its state and appending a snapshot', async () => {
    const repositories = fakeRepositories();
    repositories.productRepository.upsertRemoteIdentity({ id: '1', state: 'notPublished', title: 'Old title', itemNumber: 'OLD-1', syncedAt: '2026-08-26T00:00:00.000Z' });
    const gateway: MiaoshouGateway = {
      listCollectBox: vi.fn(async () => ({ pageNo: 1, pageSize: 20, total: 0, hasMore: false, items: [] })),
      getCollectBoxDetail: vi.fn(async (id) => detail(id)),
    };
    const service = new ProductSyncService(gateway, repositories.productRepository, repositories.snapshotRepository, { now: () => '2026-08-27T00:00:00.000Z' });

    const result = await service.syncOne('1');

    expect(result.status).toBe('synced');
    expect(repositories.products.get('1')?.title).toBe('Product 1');
    expect(repositories.products.get('1')?.state).toBe('notPublished');
    expect(repositories.snapshots).toHaveLength(1);
    expect(repositories.snapshots[0]?.productId).toBe('1');
    expect(gateway.getCollectBoxDetail).toHaveBeenCalledWith('1', undefined);
  });

  it('moves a single product to published when it appears in the published list', async () => {
    const repositories = fakeRepositories();
    repositories.productRepository.upsertRemoteIdentity({ id: '1', state: 'notPublished', title: 'Old title', itemNumber: 'OLD-1', syncedAt: '2026-08-26T00:00:00.000Z' });
    const gateway: MiaoshouGateway = {
      listCollectBox: vi.fn(async (input) => input.filter?.status === 'published'
        ? { pageNo: 1, pageSize: 20, total: 1, hasMore: false, items: [item('1')] }
        : { pageNo: 1, pageSize: 20, total: 0, hasMore: false, items: [] }),
      getCollectBoxDetail: vi.fn(async (id) => detail(id)),
    };
    const service = new ProductSyncService(gateway, repositories.productRepository, repositories.snapshotRepository);

    const result = await service.syncOne('1');

    expect(result.status).toBe('synced');
    expect(repositories.products.get('1')?.state).toBe('published');
    if (result.status === 'synced') {
      expect(result.product.state).toBe('published');
    }
  });

  it('moves a single product to timingPublish when it appears there', async () => {
    const repositories = fakeRepositories();
    repositories.productRepository.upsertRemoteIdentity({ id: '1', state: 'notPublished', title: 'Old title', itemNumber: 'OLD-1', syncedAt: '2026-08-26T00:00:00.000Z' });
    const gateway: MiaoshouGateway = {
      listCollectBox: vi.fn(async (input) => input.filter?.status === 'timingPublish'
        ? { pageNo: 1, pageSize: 20, total: 1, hasMore: false, items: [item('1')] }
        : { pageNo: 1, pageSize: 20, total: 0, hasMore: false, items: [] }),
      getCollectBoxDetail: vi.fn(async (id) => detail(id)),
    };
    const service = new ProductSyncService(gateway, repositories.productRepository, repositories.snapshotRepository);

    await service.syncOne('1');

    expect(repositories.products.get('1')?.state).toBe('timingPublish');
  });

  it('falls back to detail list columns when the list item omits them', async () => {
    const repositories = fakeRepositories();
    const bareItem: CollectBoxListItemDto = {
      collectBoxDetailId: '1',
      itemNum: 'ITEM-1',
      title: 'Product 1',
      thumbnail: 'https://img.test/1.jpg',
      sites: [],
    };
    const gateway: MiaoshouGateway = {
      listCollectBox: vi.fn().mockResolvedValue({ pageNo: 1, pageSize: 20, total: 1, hasMore: false, items: [bareItem] }),
      getCollectBoxDetail: vi.fn(async (id) => detailWithListColumns(id)),
    };
    const service = new ProductSyncService(gateway, repositories.productRepository, repositories.snapshotRepository);

    await service.syncDefault();

    expect(repositories.productRepository.upsertRemoteIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        category: '发饰、头饰 / 发箍',
        netProfit: null,
        stock: '42',
        sites: ['BR', 'MX'],
        sourcePrice: '12.5',
      }),
    );
  });

  it('fills list columns from the detail during a single-product sync', async () => {
    const repositories = fakeRepositories();
    repositories.productRepository.upsertRemoteIdentity({ id: '1', state: 'notPublished', title: 'Old title', itemNumber: 'OLD-1', syncedAt: '2026-08-26T00:00:00.000Z' });
    const gateway: MiaoshouGateway = {
      listCollectBox: vi.fn(),
      getCollectBoxDetail: vi.fn(async (id) => detailWithListColumns(id)),
    };
    const service = new ProductSyncService(gateway, repositories.productRepository, repositories.snapshotRepository);

    await service.syncOne('1');

    expect(repositories.productRepository.upsertRemoteIdentity).toHaveBeenLastCalledWith(
      expect.objectContaining({
        category: '发饰、头饰 / 发箍',
        netProfit: null,
        stock: '42',
        sites: ['BR', 'MX'],
        sourcePrice: '12.5',
      }),
    );
  });

  it('passes null for list-only fields during a single-product sync', async () => {
    const repositories = fakeRepositories();
    repositories.productRepository.upsertRemoteIdentity({ id: '1', state: 'notPublished', title: 'Old title', itemNumber: 'OLD-1', syncedAt: '2026-08-26T00:00:00.000Z' });
    const gateway: MiaoshouGateway = {
      listCollectBox: vi.fn(),
      getCollectBoxDetail: vi.fn(async (id) => detail(id)),
    };
    const service = new ProductSyncService(gateway, repositories.productRepository, repositories.snapshotRepository);

    await service.syncOne('1');

    expect(repositories.productRepository.upsertRemoteIdentity).toHaveBeenLastCalledWith(
      expect.objectContaining({
        category: null,
        netProfit: null,
        stock: null,
        sites: null,
        sourcePrice: null,
      }),
    );
  });

  it('deletes the local product and its snapshots when Miaoshou confirms it is gone', async () => {
    const repositories = fakeRepositories();
    repositories.productRepository.upsertRemoteIdentity({ id: '1', state: 'notPublished', title: 'One', syncedAt: '2026-08-26T00:00:00.000Z' });
    repositories.snapshotRepository.append({ id: 's1', productId: '1', kind: 'miaoshou', capturedAt: '2026-08-26T00:00:00.000Z', payload: {} });
    const gateway: MiaoshouGateway = {
      listCollectBox: vi.fn(),
      getCollectBoxDetail: vi.fn(async () => { throw new MiaoshouApiError('product_not_found'); }),
    };
    const service = new ProductSyncService(gateway, repositories.productRepository, repositories.snapshotRepository);

    const result = await service.syncOne('1');

    expect(result.status).toBe('deleted');
    expect(repositories.products.has('1')).toBe(false);
  });

  it('rethrows non-api errors from a single product sync', async () => {
    const repositories = fakeRepositories();
    repositories.productRepository.upsertRemoteIdentity({ id: '1', state: 'notPublished', title: 'One', syncedAt: '2026-08-26T00:00:00.000Z' });
    const gateway: MiaoshouGateway = {
      listCollectBox: vi.fn(),
      getCollectBoxDetail: vi.fn(async () => { throw new Error('network down'); }),
    };
    const service = new ProductSyncService(gateway, repositories.productRepository, repositories.snapshotRepository);

    await expect(service.syncOne('1')).rejects.toThrow('network down');
    expect(repositories.products.has('1')).toBe(true);
  });
});
