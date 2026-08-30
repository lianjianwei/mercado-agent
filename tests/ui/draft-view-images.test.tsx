// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { EditDraft, EditField, SkuEditField } from '../../src/domain/edit';
import type { ProductDetail } from '../../src/domain/product';
import { DraftView } from '../../src/ui/features/editor/DraftView';

afterEach(cleanup);

const field = (value = ''): EditField => ({ value, source: 'ai', confidence: 1 });

const detail = {
  productId: 'p1',
  title: 'T',
  description: 'D',
  category: '猫',
  sites: [],
  skuList: [],
  mainImage: null,
  images: [],
  brand: null,
  model: null,
  netProfit: null,
  stock: null,
  sourcePrice: null,
  siteAndPriceMap: {},
} as unknown as ProductDetail;

// 多 SKU:每个 SKU 的 imageUrls 都带「自己的主图 + 4 张共用详情图」(写回后的新数据)。
function sku(key: string, nameValue: string, main: string): SkuEditField {
  return {
    skuKey: key,
    name: field(nameValue),
    stock: field(),
    sourcePrice: field(),
    package: {
      length: field(),
      width: field(),
      height: field(),
      weight: field(),
      dimensionUnit: 'cm',
      weightUnit: 'g',
    },
    imageUrl: main,
    imageUrls: [main, 'd1', 'd2', 'd3', 'd4'],
    siteAndPriceMap: {},
    siteAndListingTypeInfoMap: {},
  };
}

const draft: EditDraft = {
  version: 1,
  createdAt: '2026-08-30T00:00:00.000Z',
  title: field('T'),
  description: field('D'),
  brand: { value: 'Generic', source: 'fixed', confidence: 1 },
  model: field('M'),
  sites: [],
  siteAndPriceMap: {},
  images: ['m1', 'm2', 'd1', 'd2', 'd3', 'd4'],
  skus: [sku('s1', '白', 'm1'), sku('s2', '黑', 'm2')],
};

describe('DraftView multi-SKU images', () => {
  it('shows main + the shared detail images inside each SKU block', () => {
    render(
      <DraftView
        draft={draft}
        detail={detail}
        onUpdateField={() => undefined}
        onUpdateSkuField={() => undefined}
        onUpdateSkuPackage={() => undefined}
        onSave={() => undefined}
        saving={false}
      />,
    );

    // 产品图片只有一处标题;每个 SKU 各一块,共 2 块。
    expect(screen.getAllByText('产品图片')).toHaveLength(1);
    expect(screen.getAllByText('白')).toHaveLength(1);
    expect(screen.getAllByText('黑')).toHaveLength(1);

    // 每个 SKU 块都渲染 5 张图(main + 4 详情),总计 10 张缩略图。
    expect(document.querySelectorAll('.sku-images')).toHaveLength(2);
    expect(document.querySelectorAll('.sku-images .product-image-thumb')).toHaveLength(10);
  });
});
