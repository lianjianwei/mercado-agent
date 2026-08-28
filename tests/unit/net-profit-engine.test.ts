import { describe, expect, it } from 'vitest';
import { DEFAULT_NET_PROFIT_CONFIG, type FxRates } from '../../src/domain/net-profit';
import {
  billableWeightKg,
  computeSkuNetProfit,
  computeSiteNetProfit,
  findTier,
  formatNetProfit,
  listingTypeFor,
} from '../../src/main/services/net-profit-engine';
import { SITE_META_BY_CODE } from '../../src/domain/net-profit';

const FX: FxRates = { cny: 7.18, mxn: 17.35, brl: 5.5, ars: 1450, updatedAt: '2026-08-29' };

describe('billableWeightKg', () => {
  it('uses gross weight below 500g without comparing volume', () => {
    expect(billableWeightKg(320, 20, 20, 20)).toBe(0.32);
  });
  it('picks the max of gross and volume at/above 500g', () => {
    expect(billableWeightKg(800, 0, 0, 0)).toBe(0.8);
    // volume = 20*20*20/6000 ≈ 1.333
    expect(billableWeightKg(800, 20, 20, 20)).toBeCloseTo(1.3333, 3);
  });
});

describe('findTier', () => {
  it('finds the tier containing the billable weight and clamps past the last', () => {
    const mx = SITE_META_BY_CODE.MX;
    expect(findTier(mx.tiers, 0.32)).toEqual([0.3, 0.4, 6.31, 3.16]);
    expect(findTier(mx.tiers, 20)).toEqual([15, Infinity, 148.86, 148.86]);
  });
});

describe('formatNetProfit', () => {
  it('rounds to 2 decimals and strips trailing zeros', () => {
    expect(formatNetProfit(4.2845)).toBe('4.28');
    expect(formatNetProfit(15)).toBe('15');
    expect(formatNetProfit(15.2)).toBe('15.2');
  });
});

describe('listingTypeFor', () => {
  it('classic below 10 yuan AND 200g, else premium', () => {
    expect(listingTypeFor('MX', 9.99, 199)).toBe('gold_special');
    expect(listingTypeFor('MX', 10, 199)).toBe('gold_pro');
    expect(listingTypeFor('MX', 9, 200)).toBe('gold_pro');
  });
  it('forces classic in AR regardless of price/weight', () => {
    expect(listingTypeFor('AR', 20, 500)).toBe('gold_special');
  });
});

describe('computeSiteNetProfit', () => {
  it('solves mode-price premium on MX with the documented example', () => {
    // doc example: cost 14.90, packing 2.50, 320g, mode 2, comm 20%, target 20%
    const result = computeSiteNetProfit({
      siteKey: 'MX(Up)',
      siteCode: 'MX',
      sourcePriceCny: 14.9,
      weightG: 320,
      lengthCm: 0,
      widthCm: 0,
      heightCm: 0,
      config: DEFAULT_NET_PROFIT_CONFIG,
      fx: FX,
    });
    expect(result.listingType).toBe('gold_pro'); // 14.9 >= 10
    expect(result.netProfitFormatted).toBe('4.28');
    expect(result.isHigh).toBe(false);
    expect(result.shipping).toBe(3.16);
  });

  it('solves mode-income independently of shipping', () => {
    const result = computeSiteNetProfit({
      siteKey: 'MX(Up)',
      siteCode: 'MX',
      sourcePriceCny: 14.9,
      weightG: 320,
      lengthCm: 0,
      widthCm: 0,
      heightCm: 0,
      config: { ...DEFAULT_NET_PROFIT_CONFIG, marginMode: 'income' },
      fx: FX,
    });
    expect(result.netProfitFormatted).toBe('3.03');
  });

  it('flips to the high-price shipping column when the price crosses the threshold', () => {
    // 2000g premium on MX → derived price ≈ 347 MXN >= 299 → high column
    const result = computeSiteNetProfit({
      siteKey: 'MX(Up)',
      siteCode: 'MX',
      sourcePriceCny: 20,
      weightG: 2000,
      lengthCm: 0,
      widthCm: 0,
      heightCm: 0,
      config: DEFAULT_NET_PROFIT_CONFIG,
      fx: FX,
    });
    expect(result.isHigh).toBe(true);
    expect(result.shipping).toBe(14.46);
    expect(result.netProfitFormatted).toBe('9');
  });

  it('forces classic commission on AR and uses the ARS threshold', () => {
    const result = computeSiteNetProfit({
      siteKey: 'AR(Up)',
      siteCode: 'AR',
      sourcePriceCny: 20,
      weightG: 2000,
      lengthCm: 0,
      widthCm: 0,
      heightCm: 0,
      config: DEFAULT_NET_PROFIT_CONFIG,
      fx: FX,
    });
    expect(result.listingType).toBe('gold_special');
    expect(result.isHigh).toBe(true); // ≈ 35576 ARS >= 33000
    expect(result.netProfitFormatted).toBe('11.5');
  });
});

describe('computeSkuNetProfit', () => {
  it('fills per-site maps keyed like Miaoshou (price by full key, type by code)', () => {
    const result = computeSkuNetProfit({
      sourcePriceCny: 20,
      weightG: 2000,
      lengthCm: 0,
      widthCm: 0,
      heightCm: 0,
      sites: ['MX(Up)', 'AR(Up)'],
      config: DEFAULT_NET_PROFIT_CONFIG,
      fx: FX,
    });
    expect(result.siteAndPriceMap).toEqual({ 'MX(Up)': '9', 'AR(Up)': '11.5' });
    expect(result.siteAndListingTypeInfoMap).toEqual({
      MX: { listingType: 'gold_pro' },
      AR: { listingType: 'gold_special' },
    });
  });

  it('skips unsupported site keys', () => {
    const result = computeSkuNetProfit({
      sourcePriceCny: 20,
      weightG: 2000,
      lengthCm: 0,
      widthCm: 0,
      heightCm: 0,
      sites: ['MX(Up)', 'US(Up)'],
      config: DEFAULT_NET_PROFIT_CONFIG,
      fx: FX,
    });
    expect(result.siteAndPriceMap).toEqual({ 'MX(Up)': '9' });
    expect(result.siteAndListingTypeInfoMap).toEqual({ MX: { listingType: 'gold_pro' } });
  });
});
