import { describe, expect, it } from 'vitest';

import { buildSaveChangeList } from '../../src/ui/features/editor/save-change-summary';
import type { EditDraft } from '../../src/domain/edit';
import type { ProductDetail } from '../../src/domain/product';

const detail: ProductDetail = {
  productId: 'p1',
  title: 'Stainless Coffee Grinder',
  description: '一体式陶瓷磨芯。',
  itemNumber: 'MLB-1001',
  category: '厨房用具',
  sites: ['BR', 'MX'],
  stock: '86',
  netProfit: '52.40',
  sourcePrice: '18.9',
  mainImage: null,
  images: [],
  brand: 'Hario',
  model: 'CM-100',
  siteAndPriceMap: {},
  skuList: [
    {
      skuKey: ';white;',
      name: '白色',
      imageUrl: null,
      stock: '50',
      sourcePrice: '16.9',
      netProfit: null,
      length: '20',
      width: '10',
      height: '8',
      dimensionUnit: 'cm',
      weight: '0.5',
      weightUnit: 'kg',
      siteAndPriceMap: {},
      siteAndListingTypeInfoMap: {},
      imageUrls: [],
    },
  ],
};

function draft(overrides: Partial<EditDraft> = {}): EditDraft {
  return {
    version: 1,
    createdAt: '2026-08-31T00:00:00.000Z',
    title: { value: 'Molinillo de café', source: 'ai', confidence: 0.9 },
    description: { value: 'Muele café en grano.', source: 'ai', confidence: 0.8 },
    brand: { value: 'Generic', source: 'fixed', confidence: 1 },
    model: { value: 'CM-100', source: 'ai', confidence: 0.6 },
    siteAndPriceMap: {},
    skus: [
      {
        skuKey: ';white;',
        name: { value: 'Blanco', source: 'ai', confidence: 0.9 },
        stock: { value: '2', source: 'ai', confidence: 1 },
        sourcePrice: { value: '66', source: 'remote', confidence: 1 },
        package: {
          length: { value: '20', source: 'ai', confidence: 0.7 },
          width: { value: '10', source: 'ai', confidence: 0.7 },
          height: { value: '8', source: 'ai', confidence: 0.7 },
          dimensionUnit: 'cm',
          weight: { value: '500', source: 'ai', confidence: 0.8 },
          weightUnit: 'g',
        },
        siteAndPriceMap: {},
        siteAndListingTypeInfoMap: {},
      },
    ],
    ...overrides,
  };
}

describe('buildSaveChangeList', () => {
  it('lists text, brand, and SKU changes that differ from the detail', () => {
    const lines = buildSaveChangeList(draft(), detail);

    expect(lines).toContain('标题');
    expect(lines).toContain('描述');
    expect(lines).toContain('品牌（Generic）');
    expect(lines).toContain('SKU 名称 / 包裹尺寸重量');
  });

  it('lists net profit, listing type, and image changes when the draft carries them', () => {
    const sku = {
      ...draft().skus[0],
      siteAndPriceMap: { 'MX(Up)': '7.25' },
      siteAndListingTypeInfoMap: { MX: { listingType: 'gold_pro' } },
      imageUrls: ['https://cdn.qiniu.test/main-1.png'],
    };
    const d: EditDraft = { ...draft(), siteAndPriceMap: { 'MX(Up)': '7.25' }, skus: [sku] };
    const lines = buildSaveChangeList(d, detail);

    expect(lines).toContain('站点净收益 / 全球净收益');
    expect(lines).toContain('产品类型');
    expect(lines).toContain('图片（有 AI 生成的图才替换）');
  });

  it('lists 库存 / 货源价 when the draft carries a user-edited stock or a changed source price', () => {
    const sku = {
      ...draft().skus[0],
      stock: { value: '10', source: 'user' as const, confidence: 1 },
      sourcePrice: { value: '22.5', source: 'user' as const, confidence: 1 },
    };
    const lines = buildSaveChangeList({ ...draft(), skus: [sku] }, detail);

    expect(lines).toContain('库存 / 货源价');
  });

  it('omits model when unchanged and reports no changes when identical fields', () => {
    const same: EditDraft = {
      ...draft(),
      title: { value: detail.title!, source: 'ai', confidence: 0.9 },
      description: { value: detail.description!, source: 'ai', confidence: 0.9 },
      brand: { value: detail.brand!, source: 'fixed', confidence: 1 },
      model: { value: detail.model!, source: 'ai', confidence: 0.6 },
      skus: [
        {
          ...draft().skus[0],
          name: { value: '白色', source: 'ai', confidence: 0.9 },
          // 货源价、库存都与妙手一致 → 不触发「库存 / 货源价」。
          sourcePrice: { value: '16.9', source: 'remote', confidence: 1 },
          stock: { value: '50', source: 'ai', confidence: 1 },
          package: {
            ...draft().skus[0].package,
            length: { value: '20', source: 'ai', confidence: 0.7 },
            width: { value: '10', source: 'ai', confidence: 0.7 },
            height: { value: '8', source: 'ai', confidence: 0.7 },
            weight: { value: '0.5', source: 'ai', confidence: 0.8 },
          },
        },
      ],
    };
    const lines = buildSaveChangeList(same, detail);

    expect(lines).not.toContain('型号（CM-100）');
    expect(lines).toContain('没有检测到需要保存的变更');
  });
});
