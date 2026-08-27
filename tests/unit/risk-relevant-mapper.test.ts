import { describe, expect, it } from 'vitest';

import { riskRelevantProductFromDetail } from '../../src/main/risk/risk-relevant-mapper';
import type { CollectBoxDetailDto } from '../../src/shared/miaoshou-schemas';

function detail(overrides: {
  sourceImgUrls?: string[];
  skuImgUrls?: string[];
} = {}): CollectBoxDetailDto {
  const skuMap: Record<string, { imgUrls?: string[] }> = {};
  (overrides.skuImgUrls ?? []).forEach((url, index) => {
    skuMap[`sku-${index}`] = { imgUrls: [url] };
  });
  return {
    siteCollectItemInfo: {
      collectBoxDetailId: '90001',
      title: 'Test product',
      sourceImgUrls: overrides.sourceImgUrls,
      skuMap,
    },
  } as CollectBoxDetailDto;
}

describe('risk relevant product mapper', () => {
  it('uses the images selected on SKUs, not the full source image list', () => {
    const skuUrls = [
      'https://img.example.com/sku-1.jpg',
      'https://img.example.com/sku-2.jpg',
      'https://img.example.com/sku-3.jpg',
    ];
    // sourceImgUrls contains the full detail set (with a blocked HTTP tile);
    // the mapper must prefer the SKU-selected images.
    const product = riskRelevantProductFromDetail(
      detail({
        sourceImgUrls: [
          'https://img.example.com/detail-1.jpg',
          'http://ma.m.1688.com/touch/code/sCode?id=1',
          'https://img.example.com/detail-2.jpg',
        ],
        skuImgUrls: skuUrls,
      }),
    );
    expect(product.imageUrls).toEqual(skuUrls);
  });

  it('caps the SKU-selected images to a safe model batch', () => {
    const manySkus = Array.from(
      { length: 40 },
      (_, index) => `https://img.example.com/sku-${index}.jpg`,
    );
    const product = riskRelevantProductFromDetail(detail({ skuImgUrls: manySkus }));
    expect(product.imageUrls.length).toBeLessThanOrEqual(6);
  });

  it('keeps leading SKU images when few are present', () => {
    const skuUrls = [
      'https://img.example.com/sku-1.jpg',
      'https://img.example.com/sku-2.jpg',
    ];
    const product = riskRelevantProductFromDetail(detail({ skuImgUrls: skuUrls }));
    expect(product.imageUrls).toEqual(skuUrls);
  });

  it('drops non-HTTPS tracking images even within SKU selections', () => {
    const skuUrls = [
      'https://img.example.com/sku-1.jpg',
      'http://ma.m.1688.com/touch/code/sCode?type=offer&id=123',
    ];
    const product = riskRelevantProductFromDetail(detail({ skuImgUrls: skuUrls }));
    expect(product.imageUrls).toEqual(['https://img.example.com/sku-1.jpg']);
  });
});
