import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FX_RATES,
  DEFAULT_NET_PROFIT_CONFIG,
  SITE_META_BY_CODE,
  normalizeSiteKey,
  siteMetaFor,
} from '../../src/domain/net-profit';

describe('net-profit domain defaults', () => {
  it('provides a default config', () => {
    expect(DEFAULT_NET_PROFIT_CONFIG).toEqual({
      targetMargin: 20,
      marginMode: 'price',
      commission: { classic: 12, premium: 20 },
      packingCost: 2.5,
    });
  });

  it('provides default fx rates with an empty updatedAt', () => {
    expect(DEFAULT_FX_RATES.cny).toBeGreaterThan(0);
    expect(DEFAULT_FX_RATES.updatedAt).toBe('');
  });
});

describe('site meta', () => {
  it('covers MX/BR/AR with their thresholds', () => {
    expect(SITE_META_BY_CODE.MX.threshold).toBe(299);
    expect(SITE_META_BY_CODE.BR.threshold).toBe(79);
    expect(SITE_META_BY_CODE.AR.threshold).toBe(33000);
    expect(SITE_META_BY_CODE.MX.currency).toBe('MXN');
    expect(SITE_META_BY_CODE.BR.currency).toBe('BRL');
    expect(SITE_META_BY_CODE.AR.currency).toBe('ARS');
  });

  it('normalizes (Up)-suffixed site keys and looks the meta up', () => {
    expect(normalizeSiteKey('MX(Up)')).toBe('MX');
    expect(siteMetaFor('BR(Up)')?.code).toBe('BR');
    expect(siteMetaFor('US')).toBeNull();
  });

  it('keeps every shipping tier with a positive price', () => {
    for (const meta of Object.values(SITE_META_BY_CODE)) {
      expect(meta.tiers.length).toBeGreaterThan(0);
      for (const tier of meta.tiers) {
        expect(tier[2]).toBeGreaterThan(0);
        expect(tier[3]).toBeGreaterThan(0);
      }
    }
  });
});
