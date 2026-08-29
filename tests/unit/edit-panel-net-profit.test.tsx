// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditPanel } from '../../src/ui/features/editor/EditPanel';
import type { EditDraft } from '../../src/domain/edit';
import type { Product, ProductDetail } from '../../src/domain/product';
import type { EditApi } from '../../src/shared/ipc-contract';

afterEach(cleanup);

const draft: EditDraft = {
  version: 1,
  createdAt: '2026-08-29T00:00:00.000Z',
  title: { value: 'Título', source: 'ai', confidence: 0.9 },
  description: { value: 'Descripción', source: 'ai', confidence: 0.9 },
  brand: { value: 'Generic', source: 'fixed', confidence: 1 },
  model: { value: 'M', source: 'ai', confidence: 0.6 },
  sites: ['MX(Up)', 'AR(Up)'],
  siteAndPriceMap: { 'MX(Up)': '11.5', 'AR(Up)': '11.5' },
  skus: [
    {
      skuKey: ';a;',
      name: { value: 'Blanco', source: 'ai', confidence: 0.9 },
      stock: { value: '2', source: 'ai', confidence: 1 },
      sourcePrice: { value: '20', source: 'remote', confidence: 1 },
      package: {
        length: { value: '20', source: 'ai', confidence: 0.7 },
        width: { value: '10', source: 'ai', confidence: 0.7 },
        height: { value: '8', source: 'ai', confidence: 0.7 },
        dimensionUnit: 'cm',
        weight: { value: '500', source: 'ai', confidence: 0.8 },
        weightUnit: 'g',
      },
      siteAndPriceMap: { 'MX(Up)': '9', 'AR(Up)': '11.5' },
      siteAndListingTypeInfoMap: {
        MX: { listingType: 'gold_pro' },
        AR: { listingType: 'gold_special' },
      },
    },
  ],
};

function api(): EditApi {
  return {
    draft: vi.fn(async () => draft),
    generate: vi.fn(async () => draft),
    saveDraft: vi.fn(async (_id, value) => value),
  };
}

const product = { id: 'p1', title: 'Metrónomo' } as Product;

function detail(): ProductDetail {
  return {
    productId: 'p1',
    title: 'Metrónomo',
    description: 'Afinador',
    itemNumber: null,
    category: null,
    sites: ['MX(Up)', 'AR(Up)'],
    stock: null,
    netProfit: null,
    sourcePrice: null,
    mainImage: null,
    images: [],
    skuList: [],
    brand: null,
    model: null,
    siteAndPriceMap: {},
  };
}

describe('EditPanel net profit display', () => {
  it('shows the global net profit and per-site type + net profit on each SKU card', async () => {
    render(<EditPanel api={api()} loadDetail={async () => detail()} product={product} />);

    // 草稿存在 → 出现「AI 编辑详情」页签
    fireEvent.click(await screen.findByText('AI 编辑详情'));

    // 全球净收益:数值框 + 币种框并排。
    const globalSection = screen.getByText('全球净收益').closest('section')!;
    expect(within(globalSection).getByText('11.5')).toBeTruthy();
    expect(within(globalSection).getByText('USD')).toBeTruthy();
    // 站点净收益矩阵:列 = 站点(墨西哥/阿根廷),单元格 = 净收益 + 产品类型。
    const siteSection = screen.getByText('站点净收益 (USD)').closest('section')!;
    expect(within(siteSection).getByText('墨西哥')).toBeTruthy();
    expect(within(siteSection).getByText('阿根廷')).toBeTruthy();
    expect(within(siteSection).getByText('铂金')).toBeTruthy();
    expect(within(siteSection).getByText('经典')).toBeTruthy();
    expect(within(siteSection).getByText('9')).toBeTruthy();
  });
});
