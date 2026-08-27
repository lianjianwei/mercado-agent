import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  collectBoxDetailResponseSchema,
  listCollectBoxInputSchema,
  parseCollectBoxPage,
} from '../../src/shared/miaoshou-schemas';

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(
      path.join(process.cwd(), 'tests', 'fixtures', 'miaoshou', name),
      'utf8',
    ),
  );
}

describe('Miaoshou collect-box contracts', () => {
  it('normalizes the documented detailList response into one page DTO', () => {
    expect(
      parseCollectBoxPage(fixture('list-success.json'), {
        pageNo: 1,
        pageSize: 20,
        filter: { status: 'notPublished', filterCidSite: 'CBT' },
      }),
    ).toMatchObject({
      pageNo: 1,
      pageSize: 20,
      total: 1,
      items: [
        {
          collectBoxDetailId: '90001',
          title: 'Silicone Kitchen Brush',
          cid: 'MLB1234',
          sites: ['MX', 'BR'],
        },
      ],
    });
  });

  it('accepts the alternative list key used by existing Miaoshou tooling', () => {
    const response = fixture('list-success.json') as {
      data: { detailList?: unknown[]; list?: unknown[] };
    };
    response.data.list = response.data.detailList;
    delete response.data.detailList;

    expect(
      parseCollectBoxPage(response, { pageNo: 2, pageSize: 20 }),
    ).toMatchObject({ pageNo: 2, pageSize: 20, total: 1 });
  });

  it('normalizes nullable list metadata observed in the live Miaoshou contract', () => {
    const page = parseCollectBoxPage(fixture('list-nullable-fields.json'), {
      pageNo: 1,
      pageSize: 20,
    });

    expect(page.items).toEqual([{
      collectBoxDetailId: '90002',
      itemNum: undefined,
      breadcrumb: undefined,
      cid: undefined,
      editModel: undefined,
      subAppAccountId: undefined,
      remark: undefined,
      title: 'Synthetic nullable-field product',
      sites: [],
    }]);
  });

  it('keeps an undocumented total as unknown and derives whether another page may exist', () => {
    const response = fixture('list-success.json') as {
      data: { total?: unknown; detailList: unknown[] };
    };
    delete response.data.total;

    expect(
      parseCollectBoxPage(response, { pageNo: 1, pageSize: 20 }),
    ).toMatchObject({ total: null, hasMore: false });

    response.data.detailList = Array.from(
      { length: 20 },
      (_, index) => ({ collectBoxDetailId: index + 1 }),
    );
    expect(
      parseCollectBoxPage(response, { pageNo: 1, pageSize: 20 }),
    ).toMatchObject({ total: null, hasMore: true });
  });

  it('rejects partial or fractional pagination totals', () => {
    for (const total of ['1garbage', '1.5', 1.5, -1]) {
      expect(() =>
        parseCollectBoxPage(
          {
            result: 'success',
            code: 'success',
            data: { total, detailList: [] },
          },
          { pageNo: 1, pageSize: 20 },
        ),
      ).toThrow();
    }
  });

  it('preserves validated detail fields and unknown SKU fields for later snapshots', () => {
    const detail = collectBoxDetailResponseSchema.parse(
      fixture('detail-success.json'),
    );
    expect(detail.data.siteCollectItemInfo).toMatchObject({
      collectBoxDetailId: '90001',
      title: 'Silicone Kitchen Brush',
      sites: ['MX', 'BR'],
      skuMap: { ';1;': { stock: 5, weight: 300 } },
    });
  });

  it('preserves nullable detail metadata observed in the live Miaoshou contract', () => {
    const detail = collectBoxDetailResponseSchema.parse(
      fixture('detail-nullable-fields.json'),
    );

    expect(detail.data).toMatchObject({
      saleAttributeRules: [{ values: [{ metadata: null }] }],
      productAttributeRules: [
        { values: null },
        { values: [{ metadata: null }] },
      ],
      skuAttributeRules: [
        { values: null },
        { values: [{ metadata: null }] },
      ],
      siteCollectItemInfo: {
        collectBoxDetailId: '90003',
        itemNum: null,
        firstSkuKey: null,
        warrantyTime: null,
        hasSaveSite: null,
        saveDetailTs: null,
        hasSavePrice: null,
        site: null,
        registrationType: null,
      },
    });
  });

  it('rejects malformed success responses instead of silently returning empty data', () => {
    expect(() =>
      parseCollectBoxPage(
        { result: 'success', code: 'success', data: { total: 0 } },
        { pageNo: 1, pageSize: 20 },
      ),
    ).toThrow();
    expect(
      collectBoxDetailResponseSchema.safeParse({
        result: 'success',
        code: 'success',
        data: { siteCollectItemInfo: { title: 'missing id' } },
      }).success,
    ).toBe(false);
  });

  it('rejects invalid collect-box identity values', () => {
    for (const collectBoxDetailId of ['', '0', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        parseCollectBoxPage(
          {
            result: 'success',
            code: 'success',
            data: { total: 1, detailList: [{ collectBoxDetailId }] },
          },
          { pageNo: 1, pageSize: 20 },
        ),
      ).toThrow();

      expect(
        collectBoxDetailResponseSchema.safeParse({
          result: 'success',
          code: 'success',
          data: { siteCollectItemInfo: { collectBoxDetailId } },
        }).success,
      ).toBe(false);
    }
  });

  it('validates pagination, status and the fixed CBT category-site filter', () => {
    expect(
      listCollectBoxInputSchema.safeParse({
        pageNo: 0,
        pageSize: 10,
        filter: { status: 'deleted', filterCidSite: 'MX' },
      }).success,
    ).toBe(false);
    expect(
      listCollectBoxInputSchema.parse({
        pageNo: 1,
        pageSize: 20,
        filter: { status: 'published', filterCidSite: 'CBT' },
      }),
    ).toMatchObject({ pageNo: 1, pageSize: 20 });
  });
});
