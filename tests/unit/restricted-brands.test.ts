import { describe, expect, it } from 'vitest';

import {
  isRestrictedBrand,
  restrictedBrandNames,
} from '../../src/main/risk/restricted-brands';

describe('restricted brand snapshot', () => {
  it('parses the full local snapshot with stable canonical names', () => {
    const names = restrictedBrandNames();
    expect(names).toContain('ADIDAS');
    expect(names).toContain('Yves Saint Laurent');
    expect(names).toContain('Tiffany & Co.');
    expect(names).toContain('Calvin Klein');
    expect(names).toContain('Audemars Piguet');
  });

  it('matches a brand case-insensitively', () => {
    expect(isRestrictedBrand('adidas')).toBe(true);
    expect(isRestrictedBrand('Adidas')).toBe(true);
    expect(isRestrictedBrand('ADIDAS')).toBe(true);
  });

  it('matches a brand ignoring punctuation and extra whitespace', () => {
    expect(isRestrictedBrand('Tiffany and Co.')).toBe(true);
    expect(isRestrictedBrand('Tiffany & Co')).toBe(true);
    expect(isRestrictedBrand('  DOLCE GABBANA  ')).toBe(true);
    expect(isRestrictedBrand('van cleef & arpels')).toBe(true);
  });

  it('matches documented aliases such as CK and YSL', () => {
    expect(isRestrictedBrand('CK')).toBe(true);
    expect(isRestrictedBrand('YSL')).toBe(true);
  });

  it('does not match an unrelated brand', () => {
    expect(isRestrictedBrand('Generic')).toBe(false);
    expect(isRestrictedBrand('Bambu Lab')).toBe(false);
    expect(isRestrictedBrand('')).toBe(false);
  });

  it('reports the snapshot source and count for audit', () => {
    const names = restrictedBrandNames();
    expect(names.length).toBeGreaterThanOrEqual(99);
  });
});
