import { describe, expect, it } from 'vitest';

import { riskRelevantProductFromDetail } from '../../src/main/risk/risk-relevant-mapper';
import type { CollectBoxDetailDto } from '../../src/shared/miaoshou-schemas';

function detail(overrides: { imageUrls?: string[] } = {}): CollectBoxDetailDto {
  return {
    siteCollectItemInfo: {
      collectBoxDetailId: '90001',
      title: 'Test product',
      sourceImgUrls: overrides.imageUrls,
    },
  } as CollectBoxDetailDto;
}

describe('risk relevant product mapper', () => {
  it('limits the image URLs sent to the model to a safe subset', () => {
    const manyUrls = Array.from(
      { length: 60 },
      (_, index) => `https://img.example.com/photo-${index}.jpg`,
    );
    const product = riskRelevantProductFromDetail(detail({ imageUrls: manyUrls }));
    expect(product.imageUrls.length).toBeLessThanOrEqual(5);
  });

  it('drops non-HTTPS and tracking image URLs before sending to the model', () => {
    const imageUrls = [
      'https://img.example.com/main.jpg',
      'http://ma.m.1688.com/touch/code/sCode?type=offer&id=123', // HTTP, not downloadable
      'https://img.example.com/second.jpg',
    ];
    const product = riskRelevantProductFromDetail(detail({ imageUrls }));
    expect(product.imageUrls).toEqual([
      'https://img.example.com/main.jpg',
      'https://img.example.com/second.jpg',
    ]);
  });

  it('keeps the leading product images when many are present', () => {
    const imageUrls = [
      'https://img.example.com/main.jpg',
      'https://img.example.com/ref1.jpg',
      'https://img.example.com/ref2.jpg',
      'https://img.example.com/ref3.jpg',
    ];
    const product = riskRelevantProductFromDetail(detail({ imageUrls }));
    expect(product.imageUrls).toEqual(imageUrls);
  });
});
