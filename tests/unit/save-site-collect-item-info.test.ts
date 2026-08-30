import { describe, expect, it } from 'vitest';

import { buildSiteCollectItemInfo } from '../../src/main/services/save-site-collect-item-info';
import type { EditDraft, EditField, SkuEditField } from '../../src/domain/edit';

const field = (value: string, source: EditField['source'] = 'ai'): EditField => ({
  value,
  source,
  confidence: 1,
});

const original: Record<string, unknown> = {
  title: 'Old title',
  notes: 'Old notes',
  itemNum: 'SKU-001',
  price: 22.9,
  originPrice: 20,
  cid: 'MLB1234',
  warrantyType: 'no_warranty',
  warrantyTime: '0',
  source: '1688',
  sourceItemId: '123',
  sourceItemUrl: 'https://detail.1688.com/offer/123.html',
  sourceList: [{ source: '1688', sourceItemId: '123' }],
  pricingMode: 'netProceeds',
  shopId: '50001',
  saleAttributes: [{ name: 'Color', values: [{ skuKey: '1', name: 'Black' }] }],
  sites: ['MX', 'BR'],
  siteAndPriceMap: { MX: 8.5, BR: 8.5 },
  siteAndListingTypeList: [{ site: 'MX', listingType: 'gold_special' }],
  attributes: [{ name: 'Brand', valueType: 'string', values: [{ name: 'Generic' }] }],
  skuMap: {
    ';1;': {
      stock: 5,
      itemNum: 'SKU-001-BLACK',
      originPrice: 20,
      imgUrls: ['https://images.example.test/original.jpg'],
      length: 20,
      width: 10,
      height: 5,
      lengthWidthHeightUnit: 'cm',
      weight: 300,
      weightUnit: 'g',
      siteAndPriceMap: { MX: 9.1, BR: 9.1 },
      siteAndListingTypeInfoMap: { MX: { listingType: 'gold_special' } },
    },
    ';2;': {
      stock: 3,
      itemNum: 'SKU-002-WHITE',
      originPrice: 15,
      imgUrls: ['https://images.example.test/original-white.jpg'],
      length: 20,
      width: 10,
      height: 5,
      lengthWidthHeightUnit: 'cm',
      weight: 300,
      weightUnit: 'g',
      siteAndPriceMap: { MX: 8.0, BR: 8.0 },
    },
  },
  firstSkuKey: ';1;',
  hasSaveSite: 1,
};

function makeDraft(overrides: Partial<EditDraft> = {}, skuOverrides: Partial<SkuEditField> = {}): EditDraft {
  return {
    version: 1,
    createdAt: '2026-08-31T00:00:00.000Z',
    title: field('Nuevo título'),
    description: field('Nueva descripción\n• Punto 1'),
    brand: field('Generic', 'fixed'),
    model: field('MC-100'),
    sites: ['MX', 'BR'],
    siteAndPriceMap: { MX: '7.25', BR: '7.25' },
    skus: [
      {
        skuKey: ';1;',
        name: field('Negro'),
        stock: field('5'),
        sourcePrice: field('12.5'),
        package: {
          length: field('22'),
          width: field('11'),
          height: field('6'),
          dimensionUnit: 'cm',
          weight: field('280'),
          weightUnit: 'g',
        },
        imageUrl: 'https://cdn.qiniu.test/main-1.png',
        imageUrls: [
          'https://cdn.qiniu.test/main-1.png',
          'https://cdn.qiniu.test/detail-1.png',
        ],
        siteAndPriceMap: { MX: '7.25', BR: '7.25' },
        siteAndListingTypeInfoMap: { MX: { listingType: 'gold_pro' }, BR: { listingType: 'gold_special' } },
        ...skuOverrides,
      },
    ],
    ...overrides,
  };
}

describe('buildSiteCollectItemInfo', () => {
  it('writes draft-owned text fields and preserves everything else', () => {
    const result = buildSiteCollectItemInfo(original, makeDraft());

    // 草稿拥有的文本字段被写入。
    expect(result.title).toBe('Nuevo título');
    expect(result.notes).toBe('Nueva descripción\n• Punto 1');

    // 非草稿字段一律保留妙手原值(关键是别把平台数据写坏)。
    expect(result.cid).toBe('MLB1234');
    expect(result.warrantyType).toBe('no_warranty');
    expect(result.pricingMode).toBe('netProceeds');
    expect(result.price).toBe(22.9);
    expect(result.shopId).toBe('50001');
    expect(result.sourceItemUrl).toBe('https://detail.1688.com/offer/123.html');
    expect(result.sourceList).toEqual([{ source: '1688', sourceItemId: '123' }]);
    // saleAttributes 保持原样(含字符串 skuKey);无规则时也不额外加 id。
    expect(result.saleAttributes).toEqual([
      { name: 'Color', values: [{ skuKey: '1', name: 'Black' }] },
    ]);
    expect(result.firstSkuKey).toBe(';1;');
  });

  it('updates brand in place and appends model as a product attribute', () => {
    const result = buildSiteCollectItemInfo(original, makeDraft());

    expect(result.attributes).toEqual([
      { name: 'Brand', valueType: 'string', values: [{ name: 'Generic' }] },
      { name: 'Model', valueType: 'string', values: [{ name: 'MC-100' }] },
    ]);
  });

  it('writes product-level and per-SKU net profit as numbers', () => {
    const result = buildSiteCollectItemInfo(original, makeDraft());

    // 产品级全球净收益(替换整表)。
    expect(result.siteAndPriceMap).toEqual({ MX: 7.25, BR: 7.25 });
    // SKU 级站点净收益,值转成 number。
    expect((result.skuMap as Record<string, Record<string, unknown>>)[';1;'].siteAndPriceMap).toEqual({
      MX: 7.25,
      BR: 7.25,
    });
  });

  it('writes per-SKU name, package, units, and listing type', () => {
    const result = buildSiteCollectItemInfo(original, makeDraft());
    const sku = (result.skuMap as Record<string, Record<string, unknown>>)[';1;'];

    expect(sku.skuName).toBe('Negro');
    expect(sku.length).toBe('22');
    expect(sku.width).toBe('11');
    expect(sku.height).toBe('6');
    expect(sku.lengthWidthHeightUnit).toBe('cm');
    expect(sku.weight).toBe('280');
    expect(sku.weightUnit).toBe('g');
    expect(sku.siteAndListingTypeInfoMap).toEqual({
      MX: { listingType: 'gold_pro' },
      BR: { listingType: 'gold_special' },
    });
  });

  it('writes per-SKU 货源价 (originPrice) when it differs from the original', () => {
    const draft = makeDraft({}, { sourcePrice: field('12.5', 'user') });
    const result = buildSiteCollectItemInfo(original, draft);
    const sku = (result.skuMap as Record<string, Record<string, unknown>>)[';1;'];

    expect(sku.originPrice).toBe('12.5');
  });

  it('leaves originPrice untouched when the draft value equals the original', () => {
    // 草稿默认 sourcePrice 即妙手原值(原 20),应不重复写。
    const draft = makeDraft({}, { sourcePrice: field('20', 'remote') });
    const result = buildSiteCollectItemInfo(original, draft);
    const sku = (result.skuMap as Record<string, Record<string, unknown>>)[';1;'];

    expect(sku.originPrice).toBe(20);
  });

  it('pushes the draft stock value when it differs from the original inventory', () => {
    // 妙手库存 5,草稿库存 '2'(用户要的控制低库存)→ 更新为 '2'。
    const draft = makeDraft({}, { stock: field('2', 'ai') });
    const result = buildSiteCollectItemInfo(original, draft);
    const sku = (result.skuMap as Record<string, Record<string, unknown>>)[';1;'];

    expect(sku.stock).toBe('2');
  });

  it('leaves stock untouched when the draft value equals the original', () => {
    const draft = makeDraft({}, { stock: field('5', 'remote') });
    const result = buildSiteCollectItemInfo(original, draft);
    const sku = (result.skuMap as Record<string, Record<string, unknown>>)[';1;'];

    expect(sku.stock).toBe(5);
  });

  it('overwrites per-SKU imgUrls when the draft has AI-generated images', () => {
    const result = buildSiteCollectItemInfo(original, makeDraft());
    const sku = (result.skuMap as Record<string, Record<string, unknown>>)[';1;'];

    expect(sku.imgUrls).toEqual([
      'https://cdn.qiniu.test/main-1.png',
      'https://cdn.qiniu.test/detail-1.png',
    ]);
  });

  it('leaves imgUrls untouched when the draft has none (protects platform images)', () => {
    const draft = makeDraft({}, { imageUrl: undefined, imageUrls: [] });
    const result = buildSiteCollectItemInfo(original, draft);
    const sku = (result.skuMap as Record<string, Record<string, unknown>>)[';1;'];

    expect(sku.imgUrls).toEqual(['https://images.example.test/original.jpg']);
  });

  it('preserves SKUs the draft does not carry by cloning them verbatim', () => {
    const result = buildSiteCollectItemInfo(original, makeDraft());
    const skuTwo = (result.skuMap as Record<string, Record<string, unknown>>)[';2;'];

    expect(skuTwo).toMatchObject({
      stock: 3,
      itemNum: 'SKU-002-WHITE',
      originPrice: 15,
      imgUrls: ['https://images.example.test/original-white.jpg'],
      length: 20,
      siteAndPriceMap: { MX: 8.0, BR: 8.0 },
    });
  });

  it('aggregates per-SKU listing types into the product-level siteAndListingTypeList', () => {
    const result = buildSiteCollectItemInfo(original, makeDraft());

    expect(result.siteAndListingTypeList).toEqual([
      { site: 'MX', listingType: 'gold_pro' },
      { site: 'BR', listingType: 'gold_special' },
    ]);
  });

  it('defaults a missing/null warrantyTime to 0 (Miaoshou requires it)', () => {
    const noWarranty = { ...original, warrantyTime: null };
    const result = buildSiteCollectItemInfo(noWarranty, makeDraft());

    expect(result.warrantyTime).toBe(0);
  });

  it('keeps an existing non-empty warrantyTime as-is', () => {
    const result = buildSiteCollectItemInfo(original, makeDraft());

    expect(result.warrantyTime).toBe('0');
  });

  it('normalizes a stale firstSkuKey to a real skuMap key', () => {
    const stale = { ...original, firstSkuKey: ';missing;' };
    const result = buildSiteCollectItemInfo(stale, makeDraft());

    expect(result.firstSkuKey).toBe(';1;');
  });

  it('keeps a valid firstSkuKey as-is', () => {
    const result = buildSiteCollectItemInfo(original, makeDraft());

    expect(result.firstSkuKey).toBe(';1;');
  });

  it('writes single-SKU per-site net profit to product-level siteAndPriceMap and sets price', () => {
    const baseSkuOne = (original.skuMap as Record<string, Record<string, unknown>>)[';1;'];
    const singleOriginal = {
      ...original,
      firstSkuKey: ';;',
      saleAttributes: [],
      skuMap: { ';;': { ...baseSkuOne, stock: 85244 } },
    };
    const baseSku = makeDraft().skus[0];
    const draft = makeDraft({
      // 产品级「全球净收益」是统一值,但逐站点是差异值(2.79/2.54)。
      siteAndPriceMap: { MX: '2.79', BR: '2.79' },
      skus: [{ ...baseSku, skuKey: ';;', siteAndPriceMap: { MX: '2.79', BR: '2.54' } }],
    });
    const result = buildSiteCollectItemInfo(singleOriginal, draft);

    // 单品:产品级 siteAndPriceMap = 该 SKU 的逐站点差异值(不是统一最大值)。
    expect(result.siteAndPriceMap).toEqual({ MX: 2.79, BR: 2.54 });
    // 全球净收益(price)= 草稿全局值 2.79。
    expect(result.price).toBe(2.79);
  });

  it('includes shared detail images in sku imgUrls even when the sku.imageUrls only has the main', () => {
    const baseSkuOne = (original.skuMap as Record<string, Record<string, unknown>>)[';1;'];
    const singleOriginal = {
      ...original,
      firstSkuKey: ';;',
      saleAttributes: [],
      skuMap: { ';;': { ...baseSkuOne, imgUrls: ['orig1', 'orig2'] } },
    };
    const baseSku = makeDraft().skus[0];
    const draft = makeDraft({
      images: ['main', 'd1', 'd2', 'd3', 'd4'],
      skus: [{ ...baseSku, skuKey: ';;', imageUrls: ['main'] }],
    });
    const result = buildSiteCollectItemInfo(singleOriginal, draft);
    const sku = (result.skuMap as Record<string, Record<string, unknown>>)[';;'];

    expect(sku.imgUrls).toEqual(['main', 'd1', 'd2', 'd3', 'd4']);
  });

  it('adds the saleAttribute rule id (matched by name/displayName, not hardcoded) and keeps string skuKey', () => {
    const multiOriginal = {
      ...original,
      saleAttributes: [
        { name: 'Color', values: [{ skuKey: '633b93b4', name: 'MT-32白色' }] },
        { name: 'Talla', values: [{ skuKey: '2', name: 'M' }] },
      ],
    };
    const result = buildSiteCollectItemInfo(multiOriginal, makeDraft(), [
      { id: 'COLOR', name: 'Color', displayName: '颜色' },
      { id: 'SIZE', name: 'Size', displayName: 'Talla' },
    ]);

    expect(result.saleAttributes).toEqual([
      { name: 'Color', values: [{ skuKey: '633b93b4', name: 'MT-32白色' }], id: 'COLOR' },
      // 规格名 "Talla" 与规则 displayName 匹配 → 解析出 SIZE,而非固定 COLOR。
      { name: 'Talla', values: [{ skuKey: '2', name: 'M' }], id: 'SIZE' },
    ]);
  });

  it('creates a skuMap entry when the draft references a SKU missing from the original', () => {
    const draft = makeDraft({
      skus: [
        {
          skuKey: ';3;',
          name: field('Azul'),
          stock: field('7'),
          sourcePrice: field('9'),
          package: {
            length: field('18'),
            width: field('9'),
            height: field('4'),
            dimensionUnit: 'cm',
            weight: field('150'),
            weightUnit: 'g',
          },
          imageUrl: 'https://cdn.qiniu.test/main-3.png',
          imageUrls: ['https://cdn.qiniu.test/main-3.png'],
          siteAndPriceMap: {},
          siteAndListingTypeInfoMap: {},
        },
      ],
    });
    const result = buildSiteCollectItemInfo(original, draft);
    const sku = (result.skuMap as Record<string, Record<string, unknown>>)[';3;'];

    expect(sku.skuName).toBe('Azul');
    expect(sku.imgUrls).toEqual(['https://cdn.qiniu.test/main-3.png']);
  });
});
