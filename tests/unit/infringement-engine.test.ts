import { describe, expect, it, vi } from 'vitest';

import type { MultimodalRequest } from '../../src/domain/providers';
import { InfringementEngine } from '../../src/main/risk/infringement-engine';
import type { RiskRelevantProduct } from '../../src/main/risk/fingerprint';

function sampleProduct(): RiskRelevantProduct {
  return {
    title: 'Wireless charger for iPhone 15',
    description: 'Fast charging pad.',
    brand: 'Generic',
    category: 'Electronics',
    attributes: {},
    skuName: 'charger-black',
    imageUrls: ['https://img.example/1.jpg'],
  };
}

function fakeProvider(decision: unknown) {
  return {
    generate: vi.fn(
      async (
        request: MultimodalRequest,
        signal: AbortSignal,
      ): Promise<unknown> => {
        expect(request).toBeDefined();
        expect(signal).toBeDefined();
        return decision;
      },
    ),
  };
}

describe('InfringementEngine', () => {
  it('returns a high-risk decision for a restricted brand owner without calling AI', async () => {
    const provider = fakeProvider({ level: 'none' });
    const engine = new InfringementEngine(provider as never);
    const product: RiskRelevantProduct = {
      ...sampleProduct(),
      title: 'Apple Watch Series 10',
      brand: 'APPLE',
    };

    const decision = await engine.analyze(product, new AbortController().signal);

    expect(decision.level).toBe('high');
    expect(decision.rules.some((hit) => hit.rule === 'brand-owner-high')).toBe(true);
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('calls AI for a compatible accessory and merges its decision', async () => {
    const aiDecision = {
      level: 'low',
      kind: 'compatible_accessory',
      summary: 'Generic accessory, brand word only references the compatible device.',
      evidence: [{ source: 'text', quote: 'compatible with iPhone', explanation: '明确兼容表述' }],
      imageEvidence: ['主图为通用配件，无品牌 Logo'],
    };
    const provider = fakeProvider(aiDecision);
    const engine = new InfringementEngine(provider as never);
    const product: RiskRelevantProduct = {
      ...sampleProduct(),
      title: 'Compatible replacement strap for Apple Watch',
      brand: 'Generic',
    };

    const decision = await engine.analyze(product, new AbortController().signal);

    expect(provider.generate).toHaveBeenCalledTimes(1);
    const request = provider.generate.mock.calls[0][0];
    expect(request.imageUrls).toEqual(product.imageUrls);
    expect(request.prompt).toContain(product.title);
    expect(decision.level).toBe('low');
    expect(decision.kind).toBe('compatible_accessory');
  });

  it('escalates AI low risk to high when local counterfeit language is present', async () => {
    const provider = fakeProvider({ level: 'low' });
    const engine = new InfringementEngine(provider as never);
    const product: RiskRelevantProduct = {
      ...sampleProduct(),
      title: '高仿 Apple Watch 复刻版',
      brand: 'Generic',
    };

    const decision = await engine.analyze(product, new AbortController().signal);

    expect(decision.level).toBe('high');
    expect(decision.rules.some((hit) => hit.rule === 'counterfeit-language')).toBe(true);
  });

  it('throws a structured error when AI output does not validate', async () => {
    const provider = fakeProvider({ level: 'ultra-high' });
    const engine = new InfringementEngine(provider as never);

    await expect(
      engine.analyze(sampleProduct(), new AbortController().signal),
    ).rejects.toMatchObject({ name: 'ModelStructuredOutputError' });
  });

  it('records the fingerprint and image involvement in the decision', async () => {
    const provider = fakeProvider({
      level: 'medium',
      kind: 'unknown',
      summary: 'Uncertain',
      evidence: [{ source: 'image', quote: 'logo visible', explanation: '明显 Logo' }],
    });
    const engine = new InfringementEngine(provider as never);
    const product = sampleProduct();

    const decision = await engine.analyze(product, new AbortController().signal);

    expect(decision).toMatchObject({
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      imagesIncluded: true,
    });
    expect(decision.ai?.evidence).toHaveLength(1);
  });

  it('calls AI for an unbranded product and uses its decision', async () => {
    const aiDecision = {
      level: 'none',
      kind: 'unbranded',
      summary: 'No brand or protected design detected.',
      evidence: [{ source: 'image', quote: 'handmade pattern', explanation: '无受保护标识' }],
    };
    const provider = fakeProvider(aiDecision);
    const engine = new InfringementEngine(provider as never);
    const product: RiskRelevantProduct = {
      ...sampleProduct(),
      title: 'Handmade ceramic mug with flower pattern',
      brand: 'Local Craft Co.',
    };

    const decision = await engine.analyze(product, new AbortController().signal);

    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(decision.level).toBe('none');
    expect(decision.kind).toBe('unbranded');
  });
});
