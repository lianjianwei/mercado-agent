import { describe, expect, it } from 'vitest';

import {
  compactMiaoshouBody,
  createMiaoshouSignature,
} from '../../src/main/gateways/miaoshou/signature';

describe('Miaoshou request signature', () => {
  it('signs the exact compact JSON body in the documented field order', () => {
    const path =
      '/open/v1/product/collect_box/mercadolibre/collect_box/search_collect_box_detailList';
    const bodyJson = compactMiaoshouBody({
      pageNo: 1,
      pageSize: 20,
      filter: { status: 'notPublished', filterCidSite: 'CBT' },
    });

    expect(bodyJson).toBe(
      '{"pageNo":1,"pageSize":20,"filter":{"status":"notPublished","filterCidSite":"CBT"}}',
    );
    expect(
      createMiaoshouSignature({
        appSecret: 'as_secret_123',
        path,
        timestamp: '1720000000',
        appKey: 'ak_test_123',
        bodyJson,
      }),
    ).toBe('e80698540d76ba4915ae74a1d4bcf1f2fd9e3019f221f7930ac955f332e0259c');
  });

  it('uses an empty string only when the request has no body', () => {
    expect(compactMiaoshouBody(undefined)).toBe('');
    expect(compactMiaoshouBody({})).toBe('{}');
  });
});
