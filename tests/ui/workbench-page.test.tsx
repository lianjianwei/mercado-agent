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
import type { EditDraft } from '../../src/domain/edit';
import type { EditApi, InfringementApi, ProductApi } from '../../src/shared/ipc-contract';
import { WorkbenchPage } from '../../src/ui/pages/WorkbenchPage';

afterEach(cleanup);

const syncLogListeners = new Set<(line: string) => void>();
const batchLogListeners = new Set<(line: string) => void>();

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
    state: 'notPublished',
    title: 'Locally Published Mug',
    itemNumber: 'MLB-1002',
    localPublishState: 'localPublished',
    localPublishedAt: '2026-08-27T02:00:00.000Z',
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
    localPublishState: 'notPublished',
    localPublishedAt: null,
    lastSyncedAt: '2026-08-27T01:00:00.000Z',
    createdAt: '2026-08-27T01:00:00.000Z',
    updatedAt: '2026-08-27T01:00:00.000Z',
    ...overrides,
  };
}

function createInfringementApi() {
  const analyze = vi.fn<InfringementApi['analyze']>(async () => run());
  const analyzeBatch = vi.fn<InfringementApi['analyzeBatch']>(async () => ({
    discovered: 0,
    succeeded: 0,
    failed: 0,
    failures: [],
  }));
  const onBatchLog = vi.fn<InfringementApi['onBatchLog']>((listener: (line: string) => void) => {
    batchLogListeners.add(listener);
    return () => batchLogListeners.delete(listener);
  });
  const history = vi.fn<InfringementApi['history']>(async () => [run()]);
  const current = vi.fn<InfringementApi['current']>(async (productId: string) =>
    productId === 'detail-1' ? run() : null,
  );
  return {
    api: { analyze, analyzeBatch, onBatchLog, history, current },
    analyze,
    analyzeBatch,
    history,
    current,
    emitBatchLog: (line: string) => batchLogListeners.forEach((listener) => listener(line)),
  };
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
    const filtered = live.filter((item) => {
      if (query.state && item.state !== query.state) return false;
      if (query.localPublishState && item.localPublishState !== query.localPublishState) return false;
      return true;
    });
    const items = filtered.slice(query.offset, query.offset + query.limit);
    return { items, offset: query.offset, limit: query.limit, total: filtered.length };
  });
  const syncDefault = vi.fn<ProductApi['syncDefault']>(async () => ({
    discovered: 0,
    succeeded: 0,
    failed: 0,
    missing: 0,
    failures: [],
    durationMs: 0,
  }));
  const onSyncLog = vi.fn<ProductApi['onSyncLog']>((listener: (line: string) => void) => {
    syncLogListeners.add(listener);
    return () => syncLogListeners.delete(listener);
  });
  const syncOne = vi.fn<ProductApi['syncOne']>(async (productId: string) => {
    const index = live.findIndex((item) => item.id === productId);
    if (index >= 0) live.splice(index, 1);
    return { status: 'deleted' };
  });
  const clear = vi.fn<ProductApi['clear']>(async () => {
    live.length = 0;
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
    brand: 'Hario',
    model: 'CM-100',
    skuList: [
      { skuKey: ';white;', name: '白色', imageUrl: 'https://images.example.com/grinder.jpg', stock: '50', sourcePrice: '16.9', netProfit: '48.6', length: '20', width: '10', height: '8', dimensionUnit: 'cm', weight: '0.5', weightUnit: 'kg' },
      { skuKey: ';black;', name: '黑色', imageUrl: null, stock: '36', sourcePrice: null, netProfit: null, length: null, width: null, height: null, dimensionUnit: null, weight: null, weightUnit: null },
    ],
  }));

  const generate = vi.fn<EditApi['generate']>(async () => editDraft());
  const draft = vi.fn<EditApi['draft']>(async () => null);
  const saveDraft = vi.fn<EditApi['saveDraft']>(async (_id, incoming) => incoming);

  return {
    api: {
      products: { page, detail, syncDefault, onSyncLog, syncOne, clear },
      infringement: createInfringementApi().api,
      edit: { generate, draft, saveDraft },
    },
    products: { page, detail, syncDefault, onSyncLog, syncOne, clear },
    edit: { generate, draft, saveDraft },
    page,
    detail,
    syncDefault,
    syncOne,
    clear,
    generate,
    draft,
    saveDraft,
    emitSyncLog: (line: string) => syncLogListeners.forEach((listener) => listener(line)),
  };
}

function editDraft(): EditDraft {
  return {
    version: 1,
    createdAt: '2026-08-28T01:00:00.000Z',
    title: { value: 'Titulo', source: 'ai', confidence: 0.9 },
    description: { value: 'Descripción', source: 'ai', confidence: 0.8 },
    brand: { value: 'Generic', source: 'ai', confidence: 1 },
    model: { value: 'CM-100', source: 'ai', confidence: 0.6 },
    skus: [
      { skuKey: ';white;', name: { value: 'Blanco', source: 'ai', confidence: 0.9 } },
    ],
    package: {
      length: { value: '20', source: 'ai', confidence: 0.7 },
      width: { value: '10', source: 'ai', confidence: 0.7 },
      height: { value: '8', source: 'ai', confidence: 0.7 },
      dimensionUnit: { value: 'cm', source: 'ai', confidence: 0.99 },
      weight: { value: '0.5', source: 'ai', confidence: 0.8 },
      weightUnit: { value: 'kg', source: 'ai', confidence: 0.99 },
    },
  };
}

describe('WorkbenchPage', () => {
  it('loads unpublished products by default and renders the workflow columns', async () => {
    const fake = createApi();
    render(<WorkbenchPage api={fake.api} />);

    expect(await screen.findByRole('button', { name: '未发布 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '本地已发布 1' })).toBeTruthy();
    expect(fake.page).toHaveBeenCalledWith({ state: 'notPublished', offset: 0, limit: 20 });
    const row = await screen.findByRole('row', { name: /Stainless Coffee Grinder/ });
    expect(within(row).getByText('厨房用具')).toBeTruthy();
    expect(within(row).getByText('52.40')).toBeTruthy();
    expect(within(row).getByText('86')).toBeTruthy();
    expect(within(row).getByText('BR、MX')).toBeTruthy();
    expect(within(row).getByText('18.9')).toBeTruthy();
    // 本地发布列 defaults to 未发布 for products without a local publish.
    expect(within(row).getByText('未发布')).toBeTruthy();
    // 侵权列 shows the current risk from the infringement API.
    expect((await screen.findAllByText('高风险')).length).toBeGreaterThanOrEqual(1);
    // A locally-published product still appears here (it is still notPublished
    // on Miaoshou) with its local badge visible.
    expect(screen.queryByText('Locally Published Mug')).toBeTruthy();
  });

  it('switches to the locally-published tab and filters by local state', async () => {
    const user = userEvent.setup();
    const fake = createApi();
    render(<WorkbenchPage api={fake.api} />);

    await user.click(await screen.findByRole('button', { name: '本地已发布 1' }));
    expect(await screen.findByRole('row', { name: /Locally Published Mug/ })).toBeTruthy();
    expect(screen.queryByRole('row', { name: /Stainless Coffee Grinder/ })).toBeNull();
    expect(fake.page).toHaveBeenLastCalledWith({
      localPublishState: 'localPublished',
      offset: 0,
      limit: 20,
    });
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
    render(<WorkbenchPage api={fake.api} />);

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
    render(<WorkbenchPage api={{ ...fake.api, infringement: risk.api }} />);

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
    render(<WorkbenchPage api={{ ...fake.api, infringement: risk.api }} />);

    const row = await screen.findByRole('row', { name: /Stainless Coffee Grinder/ });
    await user.click(within(row).getByRole('button', { name: '侵权' }));
    await user.click(await screen.findByRole('button', { name: '分析侵权风险' }));

    expect(risk.analyze).toHaveBeenCalledWith('detail-1');
    expect(await screen.findByText(/brand-owner-high/)).toBeTruthy();
    expect(screen.getByText(/Apple Logo 清晰可见/)).toBeTruthy();
    const history = screen.getByRole('region', { name: '检测历史' });
    expect(within(history).getByText('V1')).toBeTruthy();
  });

  it('opens the AI edit panel from the row button and keeps 发布 as a placeholder', async () => {
    const user = userEvent.setup();
    const fake = createApi();
    render(<WorkbenchPage api={fake.api} />);

    const row = await screen.findByRole('row', { name: /Stainless Coffee Grinder/ });
    await user.click(within(row).getByRole('button', { name: 'AI编辑' }));
    expect(await screen.findByRole('button', { name: '生成 AI 草稿' })).toBeTruthy();
    expect(fake.draft).toHaveBeenCalledWith('detail-1');

    await user.click(within(row).getByRole('button', { name: '发布' }));
    expect(await screen.findByText(/发布功能将在后续阶段实现/)).toBeTruthy();
  });

  it('opens the detail modal and shows title, description and SKUs', async () => {
    const user = userEvent.setup();
    const fake = createApi();
    render(<WorkbenchPage api={fake.api} />);

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

  it('shows per-product synchronization failures and the elapsed time', async () => {
    const user = userEvent.setup();
    const summary: ProductSyncSummary = {
      discovered: 2,
      succeeded: 1,
      failed: 1,
      missing: 0,
      failures: [{ id: 'detail-9', message: '详情读取失败' }],
      durationMs: 71_000,
    };
    const fake = createApi();
    fake.syncDefault.mockResolvedValueOnce(summary);
    render(<WorkbenchPage api={fake.api} />);

    await user.click(await screen.findByRole('button', { name: '同步全部' }));

    expect(await screen.findByText(/同步完成：发现 2，成功 1，失败 1，耗时 1 分 11 秒/)).toBeTruthy();
    expect(screen.getByText('detail-9：详情读取失败')).toBeTruthy();
    expect(await screen.findByRole('row', { name: /Stainless Coffee Grinder/ })).toBeTruthy();
  });

  it('streams progress log lines into the sync log panel', async () => {
    const user = userEvent.setup();
    const fake = createApi();
    render(<WorkbenchPage api={fake.api} />);

    await user.click(await screen.findByRole('button', { name: '同步全部' }));
    fake.emitSyncLog('正在请求未发布商品第 1 页…');
    fake.emitSyncLog('第 1 页完成：20 条。');

    const log = await screen.findByRole('log');
    expect(log.textContent).toContain('正在请求未发布商品第 1 页…');
    expect(log.textContent).toContain('第 1 页完成：20 条。');
  });

  it('clears all product data after confirmation', async () => {
    const user = userEvent.setup();
    const fake = createApi();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<WorkbenchPage api={fake.api} />);

    await user.click(await screen.findByRole('button', { name: '清理数据' }));

    expect(fake.clear).toHaveBeenCalledOnce();
    expect(confirmSpy).toHaveBeenCalled();
    expect(await screen.findByText('暂无本地商品记录')).toBeTruthy();
    confirmSpy.mockRestore();
  });

  it('runs a per-row sync and removes the row when the product was deleted remotely', async () => {
    const user = userEvent.setup();
    const fake = createApi();
    render(<WorkbenchPage api={fake.api} />);

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
    render(<WorkbenchPage api={fake.api} />);

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
        localPublishState: 'notPublished',
        localPublishedAt: null,
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

  it('offers 全部检测 when nothing is selected and runs against every product', async () => {
    const user = userEvent.setup();
    const fake = createApi();
    const risk = createInfringementApi();
    render(<WorkbenchPage api={{ ...fake.api, infringement: risk.api }} />);

    await screen.findByRole('row', { name: /Stainless Coffee Grinder/ });
    const button = screen.getByRole('button', { name: '全部检测' });

    await user.click(button);

    expect(risk.analyzeBatch).toHaveBeenCalledWith([]);
  });

  it('selects rows and runs 批量侵权检测 against the chosen ids', async () => {
    const user = userEvent.setup();
    const fake = createApi();
    const risk = createInfringementApi();
    render(<WorkbenchPage api={{ ...fake.api, infringement: risk.api }} />);

    const row = await screen.findByRole('row', { name: /Stainless Coffee Grinder/ });
    await user.click(within(row).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: '批量侵权检测' }));

    expect(risk.analyzeBatch).toHaveBeenCalledWith(['detail-1']);
  });

  it('selects all rows through the header checkbox', async () => {
    const user = userEvent.setup();
    const fake = createApi();
    const risk = createInfringementApi();
    render(<WorkbenchPage api={{ ...fake.api, infringement: risk.api }} />);

    await screen.findByRole('row', { name: /Stainless Coffee Grinder/ });
    await user.click(screen.getByRole('checkbox', { name: '选择全部' }));
    await user.click(screen.getByRole('button', { name: '批量侵权检测' }));

    expect(risk.analyzeBatch).toHaveBeenCalledWith(['detail-1', 'detail-2']);
  });

  it('shows batch infringement progress in the 侵权检测日志 tab', async () => {
    const user = userEvent.setup();
    const fake = createApi();
    const risk = createInfringementApi();
    render(<WorkbenchPage api={{ ...fake.api, infringement: risk.api }} />);

    const row = await screen.findByRole('row', { name: /Stainless Coffee Grinder/ });
    await user.click(within(row).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: '批量侵权检测' }));
    risk.emitBatchLog('商品 detail-1 侵权检测成功。');

    await user.click(await screen.findByRole('tab', { name: /侵权检测日志/ }));

    const logPanel = screen.getByRole('log');
    expect(logPanel.textContent).toContain('商品 detail-1 侵权检测成功。');
  });
});
