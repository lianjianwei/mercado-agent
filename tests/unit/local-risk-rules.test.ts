import { describe, expect, it } from 'vitest';

import {
  evaluateLocalRules,
  type LocalRulesInput,
} from '../../src/main/risk/local-rules';

function baseInput(): LocalRulesInput {
  return {
    title: 'Wireless charger for iPhone 15',
    description: 'Fast charging pad.',
    brand: 'Generic',
    category: 'Electronics',
    attributes: {},
    skuName: 'charger-black',
    imageUrls: [],
  };
}

describe('local risk rules', () => {
  it('flags a restricted-brand product as high risk by default', () => {
    const result = evaluateLocalRules({
      ...baseInput(),
      title: 'Apple Watch Series 10',
      brand: 'APPLE',
    });
    expect(result.effectiveLevel).toBe('high');
    expect(result.hits.map((hit) => hit.rule)).toContain('brand-owner-high');
  });

  it('does not flag a Generic compatible accessory solely for the brand word', () => {
    const result = evaluateLocalRules({
      ...baseInput(),
      title: 'Compatible replacement strap for Apple Watch',
      brand: 'Generic',
    });
    expect(result.effectiveLevel).not.toBe('high');
    expect(result.needsAiReview).toBe(true);
  });

  it('does not flag a compatible accessory in Chinese with 适用', () => {
    const result = evaluateLocalRules({
      ...baseInput(),
      title: '适用于 iPhone 的钢化膜 保护壳 不包含 iPhone 本体',
      brand: 'Generic',
    });
    expect(result.effectiveLevel).not.toBe('high');
    expect(result.needsAiReview).toBe(true);
  });

  it('flags counterfeit language as high risk even for an accessory', () => {
    const result = evaluateLocalRules({
      ...baseInput(),
      title: '高仿 Apple Watch 复刻版',
      brand: 'Generic',
    });
    expect(result.effectiveLevel).toBe('high');
    expect(result.hits.map((hit) => hit.rule)).toContain('counterfeit-language');
  });

  it('flags official-license hints as requiring review and raising risk', () => {
    const result = evaluateLocalRules({
      ...baseInput(),
      title: '官方正品授权 Apple 配件',
      brand: 'Generic',
    });
    expect(result.hits.map((hit) => hit.rule)).toContain('license-hint');
  });

  it('flags a branded product in a sensitive clothing category as high', () => {
    const result = evaluateLocalRules({
      ...baseInput(),
      title: 'Nike Dri-FIT 运动上衣',
      brand: 'NIKE',
      category: 'Fashion & Beauty',
    });
    expect(result.effectiveLevel).toBe('high');
  });

  it('sends unbranded products to AI review without local hits', () => {
    const result = evaluateLocalRules({
      ...baseInput(),
      title: 'Handmade ceramic mug with flower pattern',
      brand: 'Local Craft Co.',
    });
    expect(result.effectiveLevel).toBe('none');
    expect(result.hits).toEqual([]);
    expect(result.needsAiReview).toBe(true);
  });

  it('provides structured AI context that includes brand and category', () => {
    const result = evaluateLocalRules({
      ...baseInput(),
      title: 'Apple Watch Series 10',
      brand: 'APPLE',
    });
    expect(result.aiContext).toContain('APPLE');
    expect(result.aiContext).toContain('Electronics');
  });
});
