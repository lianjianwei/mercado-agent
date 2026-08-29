import { describe, expect, it } from 'vitest';
import { fxRatesSchema, netProfitConfigSchema } from '../../src/shared/net-profit-schemas';
import { DEFAULT_FX_RATES, DEFAULT_NET_PROFIT_CONFIG } from '../../src/domain/net-profit';
import { editDraftSchema } from '../../src/shared/edit-output-schema';

describe('netProfitConfigSchema', () => {
  it('accepts the default config', () => {
    expect(netProfitConfigSchema.safeParse(DEFAULT_NET_PROFIT_CONFIG).success).toBe(true);
  });
  it('rejects a negative packing cost', () => {
    expect(
      netProfitConfigSchema.safeParse({ ...DEFAULT_NET_PROFIT_CONFIG, packingCost: -1 }).success,
    ).toBe(false);
  });
  it('rejects an unknown marginMode', () => {
    expect(
      netProfitConfigSchema.safeParse({ ...DEFAULT_NET_PROFIT_CONFIG, marginMode: 'net' }).success,
    ).toBe(false);
  });
  it('rejects a 100% target margin', () => {
    expect(
      netProfitConfigSchema.safeParse({ ...DEFAULT_NET_PROFIT_CONFIG, targetMargin: 100 }).success,
    ).toBe(false);
  });
  it('rejects a 100% premium commission', () => {
    expect(
      netProfitConfigSchema.safeParse({
        ...DEFAULT_NET_PROFIT_CONFIG,
        commission: { ...DEFAULT_NET_PROFIT_CONFIG.commission, premium: 100 },
      }).success,
    ).toBe(false);
  });
  it('accepts a 99.9% target margin', () => {
    expect(
      netProfitConfigSchema.safeParse({ ...DEFAULT_NET_PROFIT_CONFIG, targetMargin: 99.9 }).success,
    ).toBe(true);
  });
  it('accepts a 99.9% commission', () => {
    expect(
      netProfitConfigSchema.safeParse({
        ...DEFAULT_NET_PROFIT_CONFIG,
        commission: { ...DEFAULT_NET_PROFIT_CONFIG.commission, classic: 99.9 },
      }).success,
    ).toBe(true);
  });
});

describe('fxRatesSchema', () => {
  it('accepts the default rates', () => {
    expect(fxRatesSchema.safeParse(DEFAULT_FX_RATES).success).toBe(true);
  });
  it('rejects a non-positive rate', () => {
    expect(fxRatesSchema.safeParse({ ...DEFAULT_FX_RATES, cny: 0 }).success).toBe(false);
  });
});

describe('editDraftSchema extension', () => {
  const baseDraft = {
    version: 1,
    createdAt: '2026-08-29T00:00:00.000Z',
    title: { value: 'T', source: 'ai', confidence: 0.9 },
    description: { value: 'D', source: 'ai', confidence: 0.9 },
    brand: { value: 'Generic', source: 'fixed', confidence: 1 },
    model: { value: 'M', source: 'ai', confidence: 0.6 },
    skus: [
      {
        skuKey: ';a;',
        name: { value: 'A', source: 'ai', confidence: 0.9 },
        stock: { value: '2', source: 'ai', confidence: 1 },
        sourcePrice: { value: '20', source: 'remote', confidence: 1 },
        package: {
          length: { value: '20', source: 'ai', confidence: 0.7 },
          width: { value: '10', source: 'ai', confidence: 0.7 },
          height: { value: '8', source: 'ai', confidence: 0.7 },
          dimensionUnit: 'cm',
          weight: { value: '500', source: 'ai', confidence: 0.8 },
          weightUnit: 'g',
        },
      },
    ],
  };

  it('accepts a draft with the new net-profit fields', () => {
    const draft = {
      ...baseDraft,
      sites: ['MX(Up)'],
      siteAndPriceMap: { 'MX(Up)': '9' },
      skus: [
        {
          ...baseDraft.skus[0],
          siteAndPriceMap: { 'MX(Up)': '9' },
          siteAndListingTypeInfoMap: { MX: { listingType: 'gold_pro' } },
        },
      ],
    };
    expect(editDraftSchema.safeParse(draft).success).toBe(true);
  });

  it('defaults the new fields for a legacy draft', () => {
    const parsed = editDraftSchema.parse(baseDraft);
    expect(parsed.sites).toEqual([]);
    expect(parsed.siteAndPriceMap).toEqual({});
    expect(parsed.skus[0].siteAndPriceMap).toEqual({});
    expect(parsed.skus[0].siteAndListingTypeInfoMap).toEqual({});
  });
});
