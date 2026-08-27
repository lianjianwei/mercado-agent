// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InfringementRun } from '../../src/domain/infringement';
import type { Product } from '../../src/domain/product';
import { RiskReviewPanel } from '../../src/ui/components/RiskReviewPanel';

afterEach(cleanup);

const product: Product = {
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
  localPublishState: 'notPublished',
  localPublishedAt: null,
  lastSyncedAt: '2026-08-27T01:00:00.000Z',
  createdAt: '2026-08-27T01:00:00.000Z',
  updatedAt: '2026-08-27T01:00:00.000Z',
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
        { source: 'image', quote: 'Apple Logo 清晰可见', explanation: '主图包含受保护标识' },
      ],
      ai: null,
    },
    createdAt: '2026-08-27T02:00:00.000Z',
    ...overrides,
  };
}

describe('RiskReviewPanel', () => {
  it('shows the current decision, rule hits and evidence', () => {
    const current = run();
    render(
      <RiskReviewPanel
        analyzing={false}
        continueEditId={null}
        current={current}
        error=""
        onAnalyze={() => undefined}
        onContinueEdit={() => undefined}
        product={product}
        runs={[current]}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Apple Watch Series 10' })).toBeTruthy();
    // 高风险 appears in both the decision pill and the run-history row.
    expect(screen.getAllByText('高风险').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Apple 本体商品，未授权销售高风险/)).toBeTruthy();
    expect(screen.getByText(/brand-owner-high/)).toBeTruthy();
    expect(screen.getByText(/Apple Logo 清晰可见/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '继续编辑' })).toBeTruthy();
  });

  it('shows V1 and V2 with the older version marked as expired', () => {
    const runs = [run(), run({ id: 'run-2', version: 2, level: 'none', kind: 'unbranded' })];
    render(
      <RiskReviewPanel
        analyzing={false}
        continueEditId={null}
        current={runs[1]!}
        error=""
        onAnalyze={() => undefined}
        onContinueEdit={() => undefined}
        product={product}
        runs={runs}
      />,
    );

    const history = screen.getByRole('region', { name: '检测历史' });
    expect(within(history).getByText('V2')).toBeTruthy();
    expect(within(history).getByText('V1')).toBeTruthy();
    expect(within(history).getByText('已过期')).toBeTruthy();
    expect(within(history).getByText('当前有效')).toBeTruthy();
  });

  it('records continue-edit without changing the risk conclusion', async () => {
    const user = userEvent.setup();
    const current = run();
    const onContinueEdit = vi.fn();
    const { rerender } = render(
      <RiskReviewPanel
        analyzing={false}
        continueEditId={null}
        current={current}
        error=""
        onAnalyze={() => undefined}
        onContinueEdit={onContinueEdit}
        product={product}
        runs={[current]}
      />,
    );

    await user.click(screen.getByRole('button', { name: '继续编辑' }));

    expect(onContinueEdit).toHaveBeenCalled();
    rerender(
      <RiskReviewPanel
        analyzing={false}
        continueEditId="product-1"
        current={current}
        error=""
        onAnalyze={() => undefined}
        onContinueEdit={onContinueEdit}
        product={product}
        runs={[current]}
      />,
    );
    expect(await screen.findByText('已记录继续编辑，风险结论不变。')).toBeTruthy();
  });

  it('shows the empty state when no runs exist', () => {
    render(
      <RiskReviewPanel
        analyzing={false}
        continueEditId={null}
        current={null}
        error=""
        onAnalyze={() => undefined}
        onContinueEdit={() => undefined}
        product={product}
        runs={[]}
      />,
    );

    expect(screen.getByText(/该商品尚无检测结论/)).toBeTruthy();
  });
});
