import { describe, expect, it, vi } from 'vitest';
import type { EditDraft } from '../../src/domain/edit';
import {
  DEFAULT_NET_PROFIT_CONFIG,
  type FxRateRepository,
  type FxRates,
  type NetProfitSettingsRepository,
  type NetProfitConfig,
} from '../../src/domain/net-profit';
import { NetProfitCalculator } from '../../src/main/services/net-profit-calculator';

const FX: FxRates = { cny: 7.18, mxn: 17.35, brl: 5.5, ars: 1450, updatedAt: '' };

function settings(config: NetProfitConfig = DEFAULT_NET_PROFIT_CONFIG): NetProfitSettingsRepository {
  return { getNetProfitConfig: vi.fn(() => config), saveNetProfitConfig: vi.fn() };
}
function fxStore(rates: FxRates = FX): FxRateRepository {
  return { getFxRates: vi.fn(() => rates), saveFxRates: vi.fn() };
}

function draftWith(skus: EditDraft['skus']): EditDraft {
  return {
    version: 1,
    createdAt: '2026-08-29T00:00:00.000Z',
    title: { value: 'T', source: 'ai', confidence: 0.9 },
    description: { value: 'D', source: 'ai', confidence: 0.9 },
    brand: { value: 'Generic', source: 'fixed', confidence: 1 },
    model: { value: 'M', source: 'ai', confidence: 0.6 },
    sites: ['MX(Up)', 'AR(Up)'],
    siteAndPriceMap: {},
    skus,
  };
}

function sku(skuKey: string, sourcePrice: string, weight: string, dims: [string, string, string]): EditDraft['skus'][number] {
  return {
    skuKey,
    name: { value: skuKey, source: 'ai', confidence: 0.9 },
    stock: { value: '2', source: 'ai', confidence: 1 },
    sourcePrice: { value: sourcePrice, source: 'remote', confidence: 1 },
    package: {
      length: { value: dims[0], source: 'ai', confidence: 0.7 },
      width: { value: dims[1], source: 'ai', confidence: 0.7 },
      height: { value: dims[2], source: 'ai', confidence: 0.7 },
      dimensionUnit: 'cm',
      weight: { value: weight, source: 'ai', confidence: 0.8 },
      weightUnit: 'g',
    },
    siteAndPriceMap: {},
    siteAndListingTypeInfoMap: {},
  };
}

describe('NetProfitCalculator', () => {
  it('fills per-SKU maps and the global maximum into the draft', () => {
    const draft = draftWith([
      sku(';heavy;', '20', '2000', ['0', '0', '0']), // MX 9, AR 11.5
      sku(';light;', '5', '150', ['0', '0', '0']), // MX classic 1.9
    ]);
    const calculator = new NetProfitCalculator(settings(), fxStore());

    const result = calculator.computeForDraft(draft);

    expect(result.skus[0].siteAndPriceMap).toEqual({ 'MX(Up)': '8.33', 'AR(Up)': '6.97' });
    expect(result.skus[0].siteAndListingTypeInfoMap).toEqual({
      MX: { listingType: 'gold_pro' },
      AR: { listingType: 'gold_special' },
    });
    expect(result.skus[1].siteAndPriceMap).toEqual({ 'MX(Up)': '1.9', 'AR(Up)': '2.59' });
    // global = max(8.33, 6.97, 1.9)
    expect(result.siteAndPriceMap).toEqual({ 'MX(Up)': '8.33', 'AR(Up)': '8.33' });
    // 计算明细随每次计算写入,按裸站点码索引。
    expect(result.skus[0].siteNetProfitDetail?.MX.netProfitUsd).toBeCloseTo(8.33, 1);
    expect(result.skus[0].siteNetProfitDetail?.AR.currency).toBe('ARS');
  });

  it('leaves a SKU with no source price empty and still aggregates the rest', () => {
    const draft = draftWith([
      sku(';heavy;', '20', '2000', ['0', '0', '0']),
      sku(';no-price;', '', '150', ['0', '0', '0']),
    ]);
    const calculator = new NetProfitCalculator(settings(), fxStore());

    const result = calculator.computeForDraft(draft);

    expect(result.skus[1].siteAndPriceMap).toEqual({});
    expect(result.skus[1].siteAndListingTypeInfoMap).toEqual({});
    expect(result.skus[1].siteNetProfitDetail).toEqual({});
    expect(result.siteAndPriceMap).toEqual({ 'MX(Up)': '8.33', 'AR(Up)': '8.33' });
  });

  it('treats missing weight/dimensions as zero instead of failing', () => {
    const draft = draftWith([sku(';a;', '20', '', ['', '', ''])]);
    const calculator = new NetProfitCalculator(settings(), fxStore());

    const result = calculator.computeForDraft(draft);

    expect(result.skus[0].siteAndPriceMap?.['MX(Up)']).toBeTruthy();
  });

  it('applies user net-profit / listing-type overrides on top of the computed values', () => {
    const base = sku(';heavy;', '20', '2000', ['0', '0', '0']); // MX 8.33, AR 6.97
    base.siteNetProfitOverrides = {
      MX: { netProfit: '12.34', listingType: 'gold_special' },
      AR: { listingType: 'gold_pro' },
    };
    const draft = draftWith([base]);
    const calculator = new NetProfitCalculator(settings(), fxStore());

    const result = calculator.computeForDraft(draft);

    // 覆盖站点用覆盖值;未覆盖数目的站点仍按规则算。
    expect(result.skus[0].siteAndPriceMap['MX(Up)']).toBe('12.34');
    expect(result.skus[0].siteAndPriceMap['AR(Up)']).toBe('6.97');
    expect(result.skus[0].siteAndListingTypeInfoMap).toEqual({
      MX: { listingType: 'gold_special' },
      AR: { listingType: 'gold_pro' },
    });
    // 全球净收益取覆盖后的最大值(12.34 > 6.97)。
    expect(result.siteAndPriceMap).toEqual({ 'MX(Up)': '12.34', 'AR(Up)': '12.34' });
  });

  it('uses the global net-profit override when set, instead of the computed max', () => {
    const draft = draftWith([sku(';heavy;', '20', '2000', ['0', '0', '0'])]);
    draft.globalNetProfitOverride = '999';
    const calculator = new NetProfitCalculator(settings(), fxStore());

    const result = calculator.computeForDraft(draft);

    expect(result.siteAndPriceMap).toEqual({ 'MX(Up)': '999', 'AR(Up)': '999' });
  });
});
