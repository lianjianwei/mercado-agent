import { describe, expect, it } from 'vitest';

import {
  riskFingerprint,
  type RiskRelevantProduct,
} from '../../src/main/risk/fingerprint';

function sampleProduct(): RiskRelevantProduct {
  return {
    title: 'Wireless charger for iPhone 15',
    description: 'Fast charging pad, compatible with most phones.',
    brand: 'Generic',
    category: 'Electronics',
    attributes: { color: 'black' },
    skuName: 'charger-black',
    imageUrls: ['https://example.com/img/1.jpg', 'https://example.com/img/2.jpg'],
  };
}

describe('risk fingerprint', () => {
  it('returns a stable 64-character hex fingerprint', () => {
    const fingerprint = riskFingerprint(sampleProduct());
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable for the same input', () => {
    expect(riskFingerprint(sampleProduct())).toBe(riskFingerprint(sampleProduct()));
  });

  it('changes when the title changes', () => {
    const changed = { ...sampleProduct(), title: 'Wireless charger for Android' };
    expect(riskFingerprint(changed)).not.toBe(riskFingerprint(sampleProduct()));
  });

  it('changes when the brand changes', () => {
    const changed = { ...sampleProduct(), brand: 'APPLE' };
    expect(riskFingerprint(changed)).not.toBe(riskFingerprint(sampleProduct()));
  });

  it('changes when an image is added or removed', () => {
    const fewerImages = { ...sampleProduct(), imageUrls: ['https://example.com/img/1.jpg'] };
    expect(riskFingerprint(fewerImages)).not.toBe(riskFingerprint(sampleProduct()));
  });

  it('changes when an attribute that affects risk changes', () => {
    const changed = {
      ...sampleProduct(),
      attributes: { ...sampleProduct().attributes, color: 'white' },
    };
    expect(riskFingerprint(changed)).not.toBe(riskFingerprint(sampleProduct()));
  });

  it('does not change when an attribute order changes', () => {
    const reordered = {
      ...sampleProduct(),
      attributes: { color: 'black' },
    };
    expect(riskFingerprint(reordered)).toBe(riskFingerprint(sampleProduct()));
  });
});
