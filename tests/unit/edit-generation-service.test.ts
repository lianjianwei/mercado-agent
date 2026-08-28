import { describe, expect, it, vi } from 'vitest';

import type { ProductSnapshotRepository } from '../../src/domain/product';
import type { TextModelProvider } from '../../src/domain/providers';
import { EditGenerationService } from '../../src/main/services/edit-generation-service';
import { ModelStructuredOutputError } from '../../src/main/providers/openai-compatible-text-provider';
import type { CollectBoxDetailDto } from '../../src/shared/miaoshou-schemas';
import type { AiEditOutput } from '../../src/shared/edit-output-schema';

function detail(): CollectBoxDetailDto {
  return {
    siteCollectItemInfo: {
      collectBoxDetailId: '90001',
      title: 'Coffee grinder with ceramic burr',
      notes: 'Adjustable coarse and fine settings, stainless steel body.',
      itemNum: 'MLB-1001',
      attributes: [
        { name: '品牌', values: [{ name: 'Hario' }] },
        { name: '型号', values: [{ name: 'CM-100' }] },
      ],
      skuMap: {
        ';white;': {
          imgUrls: ['https://img.test/white.jpg'],
          itemNum: 'WHITE-1',
          length: '20',
          width: '10',
          height: '8',
          lengthWidthHeightUnit: 'cm',
          weight: '0.5',
          weightUnit: 'kg',
        },
        ';black;': {
          imgUrls: ['https://img.test/black.jpg'],
          itemNum: 'BLACK-1',
        },
      },
    },
  } as CollectBoxDetailDto;
}

function fakeSnapshots(detailValue: CollectBoxDetailDto): ProductSnapshotRepository {
  return {
    append: vi.fn(),
    listForProduct: vi.fn(() => [
      {
        id: 's1',
        productId: '90001',
        kind: 'miaoshou' as const,
        capturedAt: '2026-08-28T00:00:00.000Z',
        payload: detailValue,
      },
    ]),
  };
}

function validOutput(): AiEditOutput {
  return {
    title: { value: 'Molinillo de café con muela de cerámica', confidence: 0.95 },
    description: { value: 'Muele café en grano con muela de cerámica ajustable.', confidence: 0.88 },
    brand: { value: 'Generic', confidence: 1 },
    model: { value: 'CM-100', confidence: 0.6 },
    skus: [
      { skuKey: ';white;', name: { value: 'Blanco', confidence: 0.9 } },
      { skuKey: ';black;', name: { value: 'Negro', confidence: 0.9 } },
    ],
    package: {
      length: { value: '20', confidence: 0.7 },
      width: { value: '10', confidence: 0.7 },
      height: { value: '8', confidence: 0.7 },
      weight: { value: '500', confidence: 0.8 },
    },
  };
}

function fakeProvider(returnValue: unknown): TextModelProvider {
  return {
    generate: vi.fn(async () => returnValue),
    testConnection: vi.fn(async () => ({
      ok: true,
      status: 'success' as const,
      message: 'ok',
      latencyMs: 1,
      route: 'direct' as const,
    })),
  };
}

describe('EditGenerationService', () => {
  it('builds a draft from a structured model response', async () => {
    const provider = fakeProvider(validOutput());
    const service = new EditGenerationService(
      { getById: vi.fn() },
      fakeSnapshots(detail()),
      () => provider,
      { now: () => '2026-08-28T01:00:00.000Z' },
    );

    const draft = await service.generate('90001');

    expect(draft).toEqual({
      version: 1,
      createdAt: '2026-08-28T01:00:00.000Z',
      title: { value: 'Molinillo de café con muela de cerámica', source: 'ai', confidence: 0.95 },
      description: { value: 'Muele café en grano con muela de cerámica ajustable.', source: 'ai', confidence: 0.88 },
      brand: { value: 'Generic', source: 'ai', confidence: 1 },
      model: { value: 'CM-100', source: 'ai', confidence: 0.6 },
      skus: [
        { skuKey: ';white;', name: { value: 'Blanco', source: 'ai', confidence: 0.9 } },
        { skuKey: ';black;', name: { value: 'Negro', source: 'ai', confidence: 0.9 } },
      ],
      package: {
        length: { value: '20', source: 'ai', confidence: 0.7 },
        width: { value: '10', source: 'ai', confidence: 0.7 },
        height: { value: '8', source: 'ai', confidence: 0.7 },
        dimensionUnit: 'cm',
        weight: { value: '500', source: 'ai', confidence: 0.8 },
        weightUnit: 'g',
      },
    });
  });

  it('sends the product images selected from the skuMap to the model', async () => {
    const provider = fakeProvider(validOutput());
    const service = new EditGenerationService(
      { getById: vi.fn() },
      fakeSnapshots(detail()),
      () => provider,
    );

    await service.generate('90001');

    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrls: ['https://img.test/white.jpg', 'https://img.test/black.jpg'],
      }),
      expect.anything(),
    );
  });

  it('includes the original package dimensions and weight in the prompt', async () => {
    const provider = fakeProvider(validOutput());
    const service = new EditGenerationService(
      { getById: vi.fn() },
      fakeSnapshots(detail()),
      () => provider,
    );

    await service.generate('90001');

    const prompt = (provider.generate as ReturnType<typeof vi.fn>).mock
      .calls[0][0].prompt as string;
    expect(prompt).toContain('长20 宽10 高8 cm');
    expect(prompt).toContain('0.5 kg');
  });

  it('instructs the model on a title formula with local-market phrasing', async () => {
    const provider = fakeProvider(validOutput());
    const service = new EditGenerationService(
      { getById: vi.fn() },
      fakeSnapshots(detail()),
      () => provider,
    );

    await service.generate('90001');

    const prompt = (provider.generate as ReturnType<typeof vi.fn>).mock
      .calls[0][0].prompt as string;
    // The title must follow a formula (category keyword + selling point +
    // model) and stay within 60 characters.
    expect(prompt).toMatch(/品类词/);
    expect(prompt).toMatch(/卖点/);
    expect(prompt).toMatch(/60 个字符/);
  });

  it('demands localized Spanish/Portuguese instead of literal translation', async () => {
    const provider = fakeProvider(validOutput());
    const service = new EditGenerationService(
      { getById: vi.fn() },
      fakeSnapshots(detail()),
      () => provider,
    );

    await service.generate('90001');

    const prompt = (provider.generate as ReturnType<typeof vi.fn>).mock
      .calls[0][0].prompt as string;
    // 本土化: use the terms Latin American buyers actually search, never a
    // word-for-word translation of the source title/description.
    expect(prompt).toMatch(/本土化/);
    expect(prompt).toMatch(/直译/);
  });

  it('asks the description to cover contents, options, dimensions, use cases, and compat models', async () => {
    const provider = fakeProvider(validOutput());
    const service = new EditGenerationService(
      { getById: vi.fn() },
      fakeSnapshots(detail()),
      () => provider,
    );

    await service.generate('90001');

    const prompt = (provider.generate as ReturnType<typeof vi.fn>).mock
      .calls[0][0].prompt as string;
    // Description should state what is included, the selectable options
    // (SKU/colors), dimensions, use cases, and for accessories which models
    // they fit.
    expect(prompt).toMatch(/商品内容|包括|包含/);
    expect(prompt).toMatch(/规格|SKU|颜色/);
    expect(prompt).toMatch(/适用场景|使用场景/);
    expect(prompt).toMatch(/型号|兼容/);
  });

  it('throws when the model response does not match the schema', async () => {
    const provider = fakeProvider({ title: { value: 'x'.repeat(61) } });
    const service = new EditGenerationService(
      { getById: vi.fn() },
      fakeSnapshots(detail()),
      () => provider,
    );

    await expect(service.generate('90001')).rejects.toBeInstanceOf(
      ModelStructuredOutputError,
    );
  });

  it('throws a clear error when there is no sync snapshot', async () => {
    const provider = fakeProvider(validOutput());
    const snapshots: ProductSnapshotRepository = {
      append: vi.fn(),
      listForProduct: vi.fn(() => []),
    };
    const service = new EditGenerationService(
      { getById: vi.fn() },
      snapshots,
      () => provider,
    );

    await expect(service.generate('90001')).rejects.toThrow(
      '尚无同步快照',
    );
  });
});
