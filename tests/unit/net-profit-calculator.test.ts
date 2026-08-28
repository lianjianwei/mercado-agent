import { describe, expect, it, vi } from 'vitest';
import type { EditDraft } from '../../src/domain/edit';
import {
  DEFAULT_FX_RATES,
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

    expect(result.skus[0].siteAndPriceMap).toEqual({ 'MX(Up)': '9', 'AR(Up)': '11.5' });
    expect(result.skus[0].siteAndListingTypeInfoMap).toEqual({
      MX: { listingType: 'gold_pro' },
      AR: { listingType: 'gold_special' },
    });
    expect(result.skus[1].siteAndPriceMap).toEqual({ 'MX(Up)': '1.9', 'AR(Up)': '2.59' });
    // global = max(9, 11.5, 1.9)
    expect(result.siteAndPriceMap).toEqual({ 'MX(Up)': '11.5', 'AR(Up)': '11.5' });
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
    expect(result.siteAndPriceMap).toEqual({ 'MX(Up)': '11.5', 'AR(Up)': '11.5' });
  });

  it('treats missing weight/dimensions as zero instead of failing', () => {
    const draft = draftWith([sku(';a;', '20', '', ['', '', ''])]);
    const calculator = new NetProfitCalculator(settings(), fxStore());

    const result = calculator.computeForDraft(draft);

    expect(result.skus[0].siteAndPriceMap?.['MX(Up)']).toBeTruthy();
  });
});
