// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InfringementRun } from '../../src/domain/infringement';
import type { InfringementApi, ProductApi } from '../../src/shared/ipc-contract';
import { InfringementPage } from '../../src/ui/pages/InfringementPage';

afterEach(cleanup);

const productsApi: ProductApi = {
  page: async () => ({
    items: [
      {
        id: 'product-1',
        state: 'notPublished',
        title: 'Apple Watch Series 10',
        itemNumber: 'MLB-1001',
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
  }),
  syncDefault: async () => ({ discovered: 0, succeeded: 0, failed: 0, missing: 0, failures: [] }),
  reconcileTracked: async () => ({ discovered: 0, succeeded: 0, failed: 0, missing: 0, failures: [] }),
  syncOne: async () => ({ status: 'deleted' }),
  detail: async () => ({
    productId: 'product-1',
    title: 'Apple Watch Series 10',
    description: null,
    itemNumber: 'MLB-1001',
    category: null,
    sites: [],
    stock: null,
    netProfit: null,
    sourcePrice: null,
    mainImage: null,
    images: [],
    skuList: [],
  }),
};

function run(overrides: Partial<InfringementRun> = {}): InfringementRun {
  return {
    id: 'run-1',
    productId: 'product-1',
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
        { rule: 'brand-owner-high', level: 'high', reason: '受限品牌 Apple 本体商品默认高风险。' },
      ],
      summary: 'Apple 本体商品，未授权销售高风险。',
      evidence: [
        { source: 'image', quote: 'Apple Logo 清晰可见', explanation: '主图包含受保护 Logo' },
      ],
      ai: null,
    },
    createdAt: '2026-08-27T02:00:00.000Z',
    ...overrides,
  };
}

function createInfringementApi(): {
  api: InfringementApi;
  analyze: ReturnType<typeof vi.fn>;
  history: ReturnType<typeof vi.fn>;
  current: ReturnType<typeof vi.fn>;
} {
  const analyze = vi.fn<InfringementApi['analyze']>(async () => run());
  const history = vi.fn<InfringementApi['history']>(async () => [run(), run({ id: 'run-2', version: 2, level: 'none' })]);
  const current = vi.fn<InfringementApi['current']>(async () => run());
  return { api: { analyze, history, current }, analyze, history, current };
}

describe('InfringementPage', () => {
  it('shows the product list and its current risk label', async () => {
    const fake = createInfringementApi();
    render(<InfringementPage api={{ products: productsApi, infringement: fake.api }} />);

    expect(await screen.findByRole('row', { name: /Apple Watch Series 10/ })).toBeTruthy();
    expect((await screen.findAllByText('高风险')).length).toBeGreaterThanOrEqual(1);
  });

  it('runs analysis and shows evidence and rule hits', async () => {
    const user = userEvent.setup();
    const fake = createInfringementApi();
    render(<InfringementPage api={{ products: productsApi, infringement: fake.api }} />);

    await user.click(await screen.findByRole('button', { name: '分析侵权风险' }));

    expect(fake.analyze).toHaveBeenCalledWith('product-1');
    expect(await screen.findByText(/Apple 本体商品，未授权销售高风险/)).toBeTruthy();
    expect(screen.getByText(/brand-owner-high/)).toBeTruthy();
    expect(screen.getByText(/Apple Logo 清晰可见/)).toBeTruthy();
  });

  it('shows V1 and V2 with the older version marked as expired', async () => {
    const fake = createInfringementApi();
    render(<InfringementPage api={{ products: productsApi, infringement: fake.api }} />);

    expect((await screen.findAllByText('V2')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('V1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('已过期').length).toBeGreaterThanOrEqual(1);
  });

  it('records continue-edit without changing the risk conclusion', async () => {
    const user = userEvent.setup();
    const fake = createInfringementApi();
    render(<InfringementPage api={{ products: productsApi, infringement: fake.api }} />);

    const continueButton = await screen.findByRole('button', { name: '继续编辑' });
    await user.click(continueButton);

    expect(await screen.findByText('已记录继续编辑，风险结论不变。')).toBeTruthy();
    expect(screen.getAllByText('高风险').length).toBeGreaterThanOrEqual(1);
  });
});
