import { describe, expect, it } from 'vitest';

import { buildSiteNetProfit } from '../../src/ui/features/editor/DetailPreview';
import type { PreviewSku } from '../../src/ui/features/editor/DetailPreview';

const sku = { skuKey: ';a;', name: { value: 'A', editable: false }, sourcePrice: { value: '20', editable: false }, stock: { value: '2', editable: false }, pkg: { length: { value: '1', editable: false }, width: { value: '1', editable: false }, height: { value: '1', editable: false }, weight: { value: '1', editable: false }, dimensionUnit: 'cm', weightUnit: 'g' }, images: [] } as unknown as PreviewSku;

describe('buildSiteNetProfit site filtering', () => {
  it('shows only the product-level publish sites, not extra per-SKU sites', () => {
    // 妙手 skuMap 的 per-SKU siteAndPriceMap 常带回 CL/CO/MX(Full)/UY 等未发布站点。
    const perSkuMap: Record<string, string> = {
      'AR(Up)': '11.5', 'BR(Up)': '8.5', 'MX(Up)': '9',
      'CL(Up)': '5', 'CO(Up)': '6', 'MX(Full)(Up)': '10', 'UY(Up)': '7',
    };
    const result = buildSiteNetProfit(
      [sku],
      [perSkuMap],
      [{ MX: { listingType: 'gold_pro' }, AR: { listingType: 'gold_special' } }],
      undefined,
      undefined,
      ['MX(Up)', 'BR(Up)', 'AR(Up)'], // 产品实际发布站点
    );

    const codes = result.columns.map((column) => column.code).sort();
    expect(codes).toEqual(['AR', 'BR', 'MX']);
  });

  it('keeps the union of all SKU sites when no product sites are given (back-compat)', () => {
    const perSkuMap: Record<string, string> = { 'MX(Up)': '9', 'CL(Up)': '5' };
    const result = buildSiteNetProfit([sku], [perSkuMap], [{}]);
    expect(result.columns.map((column) => column.code).sort()).toEqual(['CL', 'MX']);
  });
});
