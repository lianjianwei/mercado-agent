import { describe, expect, it } from 'vitest';

import type { Product } from '../../src/domain/product';
import { productDetailFromSources } from '../../src/main/ipc/product-detail-mapper';
import type { CollectBoxDetailDto } from '../../src/shared/miaoshou-schemas';

function product(): Product {
  return {
    id: '90001',
    state: 'notPublished',
    title: 'List title',
    itemNumber: 'MLB-1001',
    thumbnailUrl: null,
    category: '厨房用具',
    netProfit: null,
    stock: '86',
    sites: ['BR', 'MX'],
    sourcePrice: '18.9',
    localPublishState: 'notPublished',
    localPublishedAt: null,
    lastSyncedAt: '2026-08-28T00:00:00.000Z',
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
  };
}

function detail(
  skuMap: Record<string, unknown>,
  attributes?: CollectBoxDetailDto['siteCollectItemInfo']['attributes'],
): CollectBoxDetailDto {
  return {
    siteCollectItemInfo: {
      collectBoxDetailId: '90001',
      title: 'Detail title',
      sites: ['BR', 'MX'],
      skuMap,
      attributes,
    },
  } as CollectBoxDetailDto;
}

describe('product detail mapper', () => {
  it('surfaces package dimensions and weight from the skuMap', () => {
    const result = productDetailFromSources(
      product(),
      detail({
        ';white;': {
          imgUrls: ['https://img.test/white.jpg'],
          length: '20',
          width: '10',
          height: '8',
          lengthWidthHeightUnit: 'cm',
          weight: '0.5',
          weightUnit: 'kg',
        },
      }),
    );
    expect(result.skuList).toHaveLength(1);
    expect(result.skuList[0]).toMatchObject({
      skuKey: ';white;',
      length: '20',
      width: '10',
      height: '8',
      dimensionUnit: 'cm',
      weight: '0.5',
      weightUnit: 'kg',
    });
  });

  it('leaves dimensions and weight null when the skuMap omits them', () => {
    const result = productDetailFromSources(
      product(),
      detail({
        ';black;': { imgUrls: [] },
      }),
    );
    expect(result.skuList[0]).toMatchObject({
      skuKey: ';black;',
      length: null,
      width: null,
      height: null,
      dimensionUnit: null,
      weight: null,
      weightUnit: null,
    });
  });

  it('maps mixed SKUs so empty and populated package fields stay independent', () => {
    const result = productDetailFromSources(
      product(),
      detail({
        ';a;': { length: '15', lengthWidthHeightUnit: 'cm' },
        ';b;': { weight: '1.2', weightUnit: 'kg' },
      }),
    );
    expect(result.skuList[0]).toMatchObject({
      skuKey: ';a;',
      length: '15',
      width: null,
      height: null,
      dimensionUnit: 'cm',
      weight: null,
      weightUnit: null,
    });
    expect(result.skuList[1]).toMatchObject({
      skuKey: ';b;',
      length: null,
      width: null,
      height: null,
      dimensionUnit: null,
      weight: '1.2',
      weightUnit: 'kg',
    });
  });

  it('returns an empty sku list when there is no detail snapshot', () => {
    const result = productDetailFromSources(product(), undefined);
    expect(result.skuList).toEqual([]);
  });

  it('surfaces the stock and source price from the skuMap', () => {
    const result = productDetailFromSources(
      product(),
      detail({
        ';white;': { stock: 50, originPrice: 66 },
        ';black;': {},
      }),
    );
    expect(result.skuList[0]).toMatchObject({
      skuKey: ';white;',
      stock: '50',
      sourcePrice: '66',
    });
    // Missing values stay null.
    expect(result.skuList[1]).toMatchObject({
      skuKey: ';black;',
      stock: null,
      sourcePrice: null,
    });
  });

  it('surfaces brand and model from detail attributes (Chinese names)', () => {
    const result = productDetailFromSources(
      product(),
      detail({}, [
        { name: '品牌', values: [{ name: 'Hario' }] },
        { name: '型号', values: [{ name: 'CM-100' }] },
      ]),
    );
    expect(result.brand).toBe('Hario');
    expect(result.model).toBe('CM-100');
  });

  it('leaves brand and model null when attributes are absent', () => {
    const result = productDetailFromSources(product(), detail({}));
    expect(result.brand).toBeNull();
    expect(result.model).toBeNull();
  });
});
