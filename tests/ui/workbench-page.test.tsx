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
import type { InfringementRun } from '../../src/domain/infringement';
import type { InfringementApi, ProductApi } from '../../src/shared/ipc-contract';
import { WorkbenchPage } from '../../src/ui/pages/WorkbenchPage';

afterEach(cleanup);

const products: Product[] = [
  product({
    id: 'detail-1',
    state: 'notPublished',
    title: 'Stainless Coffee Grinder',
    itemNumber: 'MLB-1001',
    thumbnailUrl: 'https://images.example.com/grinder.jpg',
    category: '厨房用具',
    netProfit: '52.40',
    stock: '86',
    sites: ['BR', 'MX'],
    sourcePrice: '18.9',
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
    category: null,
    netProfit: null,
    stock: null,
    sites: [],
    sourcePrice: null,
    lastSyncedAt: '2026-08-27T01:00:00.000Z',
    createdAt: '2026-08-27T01:00:00.000Z',
    updatedAt: '2026-08-27T01:00:00.000Z',
    ...overrides,
  };
}

function createInfringementApi() {
  const analyze = vi.fn<InfringementApi['analyze']>(async () => run());
  const history = vi.fn<InfringementApi['history']>(async () => [run()]);
  const current = vi.fn<InfringementApi['current']>(async (productId: string) =>
    productId === 'detail-1' ? run() : null,
  );
  return { api: { analyze, history, current }, analyze, history, current };
}

function run(overrides: Partial<InfringementRun> = {}): InfringementRun {
  return {
    id: 'run-1',
    productId: 'detail-1',
    fingerprint: 'a'.repeat(64),
    version: 1,
    level: 'high',
    kind: 'brand_owner',
    decision: {
      level: 'high',
      kind: 'brand_owner',
      fingerprint: 'a'.repeat(64),
      imagesIncluded: true,
      rules: [
        { rule: 'brand-owner-high', level: 'high', reason: '受限品牌关键词命中，默认高风险。' },
      ],
      summary: '品牌本体商品，未授权销售高风险。',
      evidence: [
        { source: 'image', quote: 'Apple Logo 清晰可见', explanation: '主图包含受保护标识' },
      ],
      ai: null,
    },
    createdAt: '2026-08-27T02:00:00.000Z',
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
  const detail = vi.fn<ProductApi['detail']>(async () => ({
    productId: 'detail-1',
    title: 'Stainless Coffee Grinder',
    description: '一体式陶瓷磨芯，粗细可调。',
    itemNumber: 'MLB-1001',
    category: '厨房用具',
    sites: ['BR', 'MX'],
    stock: '86',
    netProfit: '52.40',
    sourcePrice: '18.9',
    mainImage: 'https://images.example.com/grinder.jpg',
    images: ['https://images.example.com/grinder.jpg', 'https://images.example.com/grinder-2.jpg'],
    skuList: [
      { skuKey: ';white;', name: '白色', imageUrl: 'https://images.example.com/grinder.jpg', stock: '50', sourcePrice: '16.9', netProfit: '48.6' },
      { skuKey: ';black;', name: '黑色', imageUrl: null, stock: '36', sourcePrice: null, netProfit: null },
    ],
  }));

  return {
    api: { page, detail, syncDefault, reconcileTracked, syncOne },
    page,
    detail,
    syncDefault,
    syncOne,
  };
}

describe('WorkbenchPage', () => {
  it('loads unpublished products by default and renders the workflow columns', async () => {
    const fake = createApi();
    render(<WorkbenchPage api={{ products: fake.api, infringement: createInfringementApi().api }} />);

    expect(await screen.findByRole('button', { name: '未发布 1' })).toBeTruthy();
    expect(fake.page).toHaveBeenCalledWith({ state: 'notPublished', offset: 0, limit: 20 });
    const row = await screen.findByRole('row', { name: /Stainless Coffee Grinder/ });
    expect(within(row).getByText('厨房用具')).toBeTruthy();
    expect(within(row).getByText('52.40')).toBeTruthy();
    expect(within(row).getByText('86')).toBeTruthy();
    expect(within(row).getByText('BR、MX')).toBeTruthy();
    expect(within(row).getByText('18.9')).toBeTruthy();
    // 侵权列 shows the current risk from the infringement API.
    expect((await screen.findAllByText('高风险')).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Timed Ceramic Mug')).toBeNull();
  });

  it('switches across lifecycle state tabs and all records', async () => {
    const user = userEvent.setup();
    const fake = createApi();
    render(<WorkbenchPage api={{ products: fake.api, infringement: createInfringementApi().api }} />);

    await user.click(await screen.findByRole('button', { name: '定时发布 1' }));
    expect(await screen.findByRole('row', { name: /Timed Ceramic Mug/ })).toBeTruthy();
    expect(fake.page).toHaveBeenLastCalledWith({ state: 'timingPublish', offset: 0, limit: 20 });

    await user.click(screen.getByRole('button', { name: '已发布历史 1' }));
    expect(await screen.findByRole('row', { name: /Published Kitchen Scale/ })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '远端缺失 1' }));
    expect(await screen.findByRole('row', { name: /Missing Silicone Lid/ })).toBeTruthy();

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
    render(<WorkbenchPage api={{ products: fake.api, infringement: createInfringementApi().api }} />);

    expect(
      await screen.findByRole('row', { name: /Draft Product 1\s/ }),
    ).toBeTruthy();
    expect(screen.getByText('1-20 / 21')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '下一页' }));

    expect(
      await screen.findByRole('row', { name: /Draft Product 21\s/ }),
    ).toBeTruthy();
    expect(fake.page).toHaveBeenLastCalledWith({ state: 'notPublished', offset: 20, limit: 20 });
    expect(screen.getByText('21-21 / 21')).toBeTruthy();
  });

  it('shows quick inspection with the selected product on the quick tab', async () => {
    const user = userEvent.setup();
    const fake = createApi();
    render(<WorkbenchPage api={{ products: fake.api, infringement: createInfringementApi().api }} />);

    const row = await screen.findByRole('row', { name: /Stainless Coffee Grinder/ });
    await user.click(row);
    expect(screen.getByRole('tab', { name: '快速检查' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '快速检查' })).toBeTruthy();
    expect(within(screen.getByLabelText('快速检查详情')).getByText('MLB-1001')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '只读详情概要' })).toBeTruthy();
  });

  it('switches to the risk tab when the row 侵权 button is clicked', async () => {
    const user = userEvent.setup();
    const fake = createApi();
    const risk = createInfringementApi();
    render(<WorkbenchPage api={{ products: fake.api, infringement: risk.api }} />);

    const row = await screen.findByRole('row', { name: /Stainless Coffee Grinder/ });
    await user.click(within(row).getByRole('button', { name: '侵权' }));

    expect(await screen.findByRole('button', { name: '分析侵权风险' })).toBeTruthy();
    expect(await screen.findByText(/品牌本体商品，未授权销售高风险/)).toBeTruthy();
    expect(risk.analyze).not.toHaveBeenCalled();
  });

  it('runs analysis from the risk tab and shows evidence and history', async () => {
    const user = userEvent.setup();
    const fake = createApi();
    const risk = createInfringementApi();
    render(<WorkbenchPage api={{ products: fake.api, infringement: risk.api }} />);

    const row = await screen.findByRole('row', { name: /Stainless Coffee Grinder/ });
    await user.click(within(row).getByRole('button', { name: '侵权' }));
    await user.click(await screen.findByRole('button', { name: '分析侵权风险' }));

    expect(risk.analyze).toHaveBeenCalledWith('detail-1');
    expect(await screen.findByText(/brand-owner-high/)).toBeTruthy();
    expect(screen.getByText(/Apple Logo 清晰可见/)).toBeTruthy();
    const history = screen.getByRole('region', { name: '检测历史' });
    expect(within(history).getByText('V1')).toBeTruthy();
  });

  it('shows AI 编辑 and 发布 placeholders via the row buttons', async () => {
    const user = userEvent.setup();
    const fake = createApi();
    render(<WorkbenchPage api={{ products: fake.api, infringement: createInfringementApi().api }} />);

    const row = await screen.findByRole('row', { name: /Stainless Coffee Grinder/ });
    await user.click(within(row).getByRole('button', { name: 'AI编辑' }));
    expect(await screen.findByText(/AI 编辑功能将在后续阶段实现/)).toBeTruthy();

    await user.click(within(row).getByRole('button', { name: '发布' }));
    expect(await screen.findByText(/发布功能将在后续阶段实现/)).toBeTruthy();
  });

  it('opens the detail modal and shows title, description and SKUs', async () => {
    const user = userEvent.setup();
    const fake = createApi();
    render(<WorkbenchPage api={{ products: fake.api, infringement: createInfringementApi().api }} />);

    const row = await screen.findByRole('row', { name: /Stainless Coffee Grinder/ });
    await user.click(within(row).getByRole('button', { name: '详情' }));

    expect(fake.detail).toHaveBeenCalledWith('detail-1');
    expect(await screen.findByRole('dialog', { name: '商品详情' })).toBeTruthy();
    expect(await screen.findByText(/一体式陶瓷磨芯，粗细可调/)).toBeTruthy();
    expect(screen.getByText('白色')).toBeTruthy();
    expect(screen.getByText('黑色')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '商品详情' })).toBeNull();
    });
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
    render(<WorkbenchPage api={{ products: fake.api, infringement: createInfringementApi().api }} />);

    await user.click(await screen.findByRole('button', { name: '同步未发布商品' }));

    expect(await screen.findByText('同步完成：发现 2，成功 1，失败 1，缺失 0。')).toBeTruthy();
    expect(screen.getByText('detail-9：详情读取失败')).toBeTruthy();
    expect(await screen.findByRole('row', { name: /Stainless Coffee Grinder/ })).toBeTruthy();
  });

  it('runs a per-row sync and removes the row when the product was deleted remotely', async () => {
    const user = userEvent.setup();
    const fake = createApi();
    render(<WorkbenchPage api={{ products: fake.api, infringement: createInfringementApi().api }} />);

    const row = await screen.findByRole('row', { name: /Stainless Coffee Grinder/ });
    const syncButton = within(row).getByRole('button', { name: /^同步/ });
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
    render(<WorkbenchPage api={{ products: fake.api, infringement: createInfringementApi().api }} />);

    const row = await screen.findByRole('row', { name: /Stainless Coffee Grinder/ });
    const syncButton = within(row).getByRole('button', { name: /^同步/ });
    fake.syncOne.mockResolvedValueOnce({
      status: 'synced',
      product: {
        id: 'detail-1',
        state: 'notPublished',
        title: 'Stainless Coffee Grinder',
        itemNumber: 'MLB-1001',
        thumbnailUrl: null,
        category: '厨房用具',
        netProfit: '52.40',
        stock: '86',
        sites: ['BR'],
        sourcePrice: '18.9',
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
