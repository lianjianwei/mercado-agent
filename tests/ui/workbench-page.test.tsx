// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  Product,
  ProductPageQuery,
  ProductSyncSummary,
} from '../../src/domain/product';
import type { ProductApi } from '../../src/shared/ipc-contract';
import { WorkbenchPage } from '../../src/ui/pages/WorkbenchPage';

afterEach(cleanup);

const products: Product[] = [
  product({
    id: 'detail-1',
    state: 'notPublished',
    title: 'Stainless Coffee Grinder',
    itemNumber: 'MLB-1001',
    thumbnailUrl: 'https://images.example.com/grinder.jpg',
  }),
  product({
    id: 'detail-2',
    state: 'timingPublish',
    title: 'Timed Ceramic Mug',
    itemNumber: 'MLB-1002',
  }),
  product({
    id: 'detail-3',
    state: 'published',
    title: 'Published Kitchen Scale',
    itemNumber: 'MLB-1003',
  }),
  product({
    id: 'detail-4',
    state: 'missing',
    title: 'Missing Silicone Lid',
    itemNumber: 'MLB-1004',
  }),
];

function product(overrides: Partial<Product> & Pick<Product, 'id' | 'state' | 'title'>): Product {
  return {
    itemNumber: null,
    thumbnailUrl: null,
    lastSyncedAt: '2026-08-27T01:00:00.000Z',
    createdAt: '2026-08-27T01:00:00.000Z',
    updatedAt: '2026-08-27T01:00:00.000Z',
    ...overrides,
  };
}

function createApi(allProducts: Product[] = products) {
  const live = [...allProducts];
  const page = vi.fn<ProductApi['page']>(async (query: ProductPageQuery) => {
    const filtered = query.state
      ? live.filter((item) => item.state === query.state)
      : live;
    const items = filtered.slice(query.offset, query.offset + query.limit);
    return { items, offset: query.offset, limit: query.limit, total: filtered.length };
  });
  const syncDefault = vi.fn<ProductApi['syncDefault']>(async () => ({
    discovered: 0,
    succeeded: 0,
    failed: 0,
    missing: 0,
    failures: [],
  }));
  const reconcileTracked = vi.fn<ProductApi['reconcileTracked']>(async () => ({
    discovered: 0,
    succeeded: 0,
    failed: 0,
    missing: 0,
    failures: [],
  }));
  const syncOne = vi.fn<ProductApi['syncOne']>(async (productId: string) => {
    const index = live.findIndex((item) => item.id === productId);
    if (index >= 0) live.splice(index, 1);
    return { status: 'deleted' };
  });

  return {
    api: { page, syncDefault, reconcileTracked, syncOne },
    page,
    syncDefault,
    syncOne,
  };
}

describe('WorkbenchPage', () => {
  it('loads unpublished products by default and renders workflow columns', async () => {
    const fake = createApi();
    render(<WorkbenchPage api={fake.api} />);

    expect(await screen.findByRole('button', { name: '未发布 1' })).toBeTruthy();
    expect(fake.page).toHaveBeenCalledWith({ state: 'notPublished', offset: 0, limit: 20 });
    expect(screen.getByRole('row', { name: /Stainless Coffee Grinder/ })).toBeTruthy();
    expect(screen.queryByText('Timed Ceramic Mug')).toBeNull();
    expect(screen.getAllByText('未检测').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('未编辑').length).toBeGreaterThanOrEqual(1);
  });

  it('switches across lifecycle state tabs and all records', async () => {
    const user = userEvent.setup();
    const fake = createApi();
    render(<WorkbenchPage api={fake.api} />);

    await user.click(await screen.findByRole('button', { name: '定时发布 1' }));
    expect(await screen.findByRole('row', { name: /Timed Ceramic Mug/ })).toBeTruthy();
    expect(fake.page).toHaveBeenLastCalledWith({ state: 'timingPublish', offset: 0, limit: 20 });

    await user.click(screen.getByRole('button', { name: '已发布历史 1' }));
    expect(await screen.findByRole('row', { name: /Published Kitchen Scale/ })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '远端缺失 1' }));
    expect(await screen.findByRole('row', { name: /Missing Silicone Lid/ })).toBeTruthy();
    expect(screen.getAllByText('远端三状态均未命中，只读保留').length).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByRole('button', { name: '全部记录 4' }));
    expect(await screen.findByRole('row', { name: /Stainless Coffee Grinder/ })).toBeTruthy();
    expect(screen.getByRole('row', { name: /Missing Silicone Lid/ })).toBeTruthy();
    expect(fake.page).toHaveBeenLastCalledWith({ offset: 0, limit: 20 });
  });

  it('paginates local history without changing the active state filter', async () => {
    const user = userEvent.setup();
    const manyProducts = Array.from({ length: 21 }, (_, index) =>
      product({
        id: `detail-${index + 1}`,
        state: 'notPublished',
        title: `Draft Product ${index + 1}`,
        itemNumber: `MLB-${index + 1}`,
      }),
    );
    const fake = createApi(manyProducts);
    render(<WorkbenchPage api={fake.api} />);

    expect(
      await screen.findByRole('row', { name: /Draft Product 1\s+未发布\s+MLB-1\s+未检测/ }),
    ).toBeTruthy();
    expect(screen.getByText('1-20 / 21')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '下一页' }));

    expect(
      await screen.findByRole('row', { name: /Draft Product 21\s+未发布\s+MLB-21\s+未检测/ }),
    ).toBeTruthy();
    expect(fake.page).toHaveBeenLastCalledWith({ state: 'notPublished', offset: 20, limit: 20 });
    expect(screen.getByText('21-21 / 21')).toBeTruthy();
  });

  it('shows quick inspection and readonly detail for the selected row', async () => {
    const user = userEvent.setup();
    const fake = createApi();
    render(<WorkbenchPage api={fake.api} />);

    const row = await screen.findByRole('row', { name: /Stainless Coffee Grinder/ });
    await user.click(row);
    expect(screen.getByRole('heading', { name: '快速检查' })).toBeTruthy();
    expect(within(screen.getByLabelText('快速检查详情')).getByText('MLB-1001')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '只读详情概要' })).toBeTruthy();
    expect(screen.getByText('当前任务只读，不编辑、不发布。')).toBeTruthy();
  });

  it('shows per-product synchronization failures', async () => {
    const user = userEvent.setup();
    const summary: ProductSyncSummary = {
      discovered: 2,
      succeeded: 1,
      failed: 1,
      missing: 0,
      failures: [{ id: 'detail-9', message: '详情读取失败' }],
    };
    const fake = createApi();
    fake.syncDefault.mockResolvedValueOnce(summary);
    render(<WorkbenchPage api={fake.api} />);

    await user.click(await screen.findByRole('button', { name: '同步未发布商品' }));

    expect(await screen.findByText('同步完成：发现 2，成功 1，失败 1，缺失 0。')).toBeTruthy();
    expect(screen.getByText('detail-9：详情读取失败')).toBeTruthy();
    expect(await screen.findByRole('row', { name: /Stainless Coffee Grinder/ })).toBeTruthy();
    expect(screen.queryByText('正在读取本地商品...')).toBeNull();
  });

  it('shows the readonly detail summary alongside quick inspection without double-click', async () => {
    const fake = createApi();
    render(<WorkbenchPage api={fake.api} />);

    expect(await screen.findByRole('row', { name: /Stainless Coffee Grinder/ })).toBeTruthy();
    // The readonly detail summary is visible immediately for the selected product.
    expect(screen.getByRole('heading', { name: '只读详情概要' })).toBeTruthy();
    expect(screen.getByText('当前任务只读，不编辑、不发布。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull();
  });

  it('runs a per-row sync and removes the row when the product was deleted remotely', async () => {
    const user = userEvent.setup();
    const fake = createApi();
    render(<WorkbenchPage api={fake.api} />);

    const row = await screen.findByRole('row', { name: /Stainless Coffee Grinder/ });
    const syncButton = within(row).getByRole('button', { name: /同步/ });
    await user.click(syncButton);

    expect(fake.syncOne).toHaveBeenCalledWith('detail-1');
    expect(await screen.findByText('该商品已从妙手删除，已移除本地记录。')).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole('row', { name: /Stainless Coffee Grinder/ })).toBeNull();
    });
  });

  it('keeps the row and shows success when a per-row sync succeeds', async () => {
    const user = userEvent.setup();
    const fake = createApi();
    render(<WorkbenchPage api={fake.api} />);

    const row = await screen.findByRole('row', { name: /Stainless Coffee Grinder/ });
    const syncButton = within(row).getByRole('button', { name: /同步/ });
    fake.syncOne.mockResolvedValueOnce({
      status: 'synced',
      product: {
        id: 'detail-1',
        state: 'notPublished',
        title: 'Stainless Coffee Grinder',
        itemNumber: 'MLB-1001',
        thumbnailUrl: null,
        lastSyncedAt: '2026-08-27T03:00:00.000Z',
        createdAt: '2026-08-27T01:00:00.000Z',
        updatedAt: '2026-08-27T03:00:00.000Z',
      },
    });
    await user.click(syncButton);

    expect(fake.syncOne).toHaveBeenCalledWith('detail-1');
    expect(await screen.findByText('同步完成：Stainless Coffee Grinder')).toBeTruthy();
    expect(screen.getByRole('row', { name: /Stainless Coffee Grinder/ })).toBeTruthy();
  });
});
