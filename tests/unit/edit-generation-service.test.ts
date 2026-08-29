import { describe, expect, it, vi } from 'vitest';

import type { ProductSnapshotRepository } from '../../src/domain/product';
import type { TextModelProvider } from '../../src/domain/providers';
import { EditGenerationService } from '../../src/main/services/edit-generation-service';
import { NetProfitCalculator } from '../../src/main/services/net-profit-calculator';
import { ModelStructuredOutputError } from '../../src/main/providers/openai-compatible-text-provider';
import type { CollectBoxDetailDto } from '../../src/shared/miaoshou-schemas';
import type { AiEditOutput } from '../../src/shared/edit-output-schema';
import {
  DEFAULT_FX_RATES,
  DEFAULT_NET_PROFIT_CONFIG,
  type FxRateRepository,
  type NetProfitSettingsRepository,
} from '../../src/domain/net-profit';

const realCalculator = new NetProfitCalculator(
  { getNetProfitConfig: () => DEFAULT_NET_PROFIT_CONFIG, saveNetProfitConfig: vi.fn() } as NetProfitSettingsRepository,
  { getFxRates: () => ({ ...DEFAULT_FX_RATES }), saveFxRates: vi.fn() } as FxRateRepository,
);

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
          stock: 50,
          originPrice: 66,
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
          stock: 40,
          originPrice: 68,
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

// The state right after a first generate: an aiDraft snapshot was appended
// after the miaoshou one. Regenerating must read the miaoshou snapshot, not
// the aiDraft (whose payload is an EditDraft with no siteCollectItemInfo).
function snapshotsWithLaterAiDraft(detailValue: CollectBoxDetailDto): ProductSnapshotRepository {
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
      {
        id: 'a1',
        productId: '90001',
        kind: 'aiDraft' as const,
        capturedAt: '2026-08-28T02:00:00.000Z',
        payload: { version: 1, title: {}, skus: [] },
      },
    ]),
  };
}

function validOutput(): AiEditOutput {
  return {
    title: { value: 'Molinillo de café con muela de cerámica', confidence: 0.95 },
    description: { value: 'Muele café en grano con muela de cerámica ajustable.', confidence: 0.88 },
    model: { value: 'CM-100', confidence: 0.6 },
    skus: [
      {
        skuKey: ';white;',
        name: { value: 'Blanco', confidence: 0.9 },
        package: {
          length: { value: '20', confidence: 0.7 },
          width: { value: '10', confidence: 0.7 },
          height: { value: '8', confidence: 0.7 },
          weight: { value: '500', confidence: 0.8 },
        },
      },
      {
        skuKey: ';black;',
        name: { value: 'Negro', confidence: 0.9 },
        package: {
          length: { value: '20', confidence: 0.7 },
          width: { value: '10', confidence: 0.7 },
          height: { value: '8', confidence: 0.7 },
          weight: { value: '500', confidence: 0.8 },
        },
      },
    ],
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
      brand: { value: 'Generic', source: 'fixed', confidence: 1 },
      model: { value: 'CM-100', source: 'ai', confidence: 0.6 },
      sites: [],
      siteAndPriceMap: {},
      skus: [
        {
          skuKey: ';white;',
          name: { value: 'Blanco', source: 'ai', confidence: 0.9 },
          stock: { value: '2', source: 'ai', confidence: 1 },
          sourcePrice: { value: '66', source: 'remote', confidence: 1 },
          package: {
            length: { value: '20', source: 'ai', confidence: 0.7 },
            width: { value: '10', source: 'ai', confidence: 0.7 },
            height: { value: '8', source: 'ai', confidence: 0.7 },
            dimensionUnit: 'cm',
            weight: { value: '500', source: 'ai', confidence: 0.8 },
            weightUnit: 'g',
          },
          siteAndPriceMap: {},
          siteAndListingTypeInfoMap: {},
        },
        {
          skuKey: ';black;',
          name: { value: 'Negro', source: 'ai', confidence: 0.9 },
          stock: { value: '2', source: 'ai', confidence: 1 },
          sourcePrice: { value: '68', source: 'remote', confidence: 1 },
          package: {
            length: { value: '20', source: 'ai', confidence: 0.7 },
            width: { value: '10', source: 'ai', confidence: 0.7 },
            height: { value: '8', source: 'ai', confidence: 0.7 },
            dimensionUnit: 'cm',
            weight: { value: '500', source: 'ai', confidence: 0.8 },
            weightUnit: 'g',
          },
          siteAndPriceMap: {},
          siteAndListingTypeInfoMap: {},
        },
      ],
    });
  });

  it('computes net profit on the generated draft when a calculator is wired', async () => {
    const withSitesDetail: CollectBoxDetailDto = {
      siteCollectItemInfo: {
        ...detail().siteCollectItemInfo,
        sites: ['MX(Up)', 'AR(Up)'],
      },
    };
    const provider = fakeProvider(validOutput());
    const service = new EditGenerationService(
      { getById: vi.fn() },
      fakeSnapshots(withSitesDetail),
      () => provider,
      { now: () => '2026-08-28T01:00:00.000Z', netProfit: realCalculator },
    );

    const draft = await service.generate('90001');

    expect(draft.sites).toEqual(['MX(Up)', 'AR(Up)']);
    // 66 元 / 500g → 铂金;MX 与 AR 均有净收益。
    expect(draft.skus[0].siteAndPriceMap['MX(Up)']).toBeTruthy();
    expect(draft.skus[0].siteAndListingTypeInfoMap.MX).toEqual({ listingType: 'gold_pro' });
    expect(draft.skus[0].siteAndListingTypeInfoMap.AR).toEqual({ listingType: 'gold_special' });
    // The top-level product map is the global net profit (max across every
    // SKU × site), applied uniformly to each publish site.
    const globalMax = draft.skus
      .flatMap((sku) => Object.values(sku.siteAndPriceMap))
      .reduce((a, b) => (Number(a) > Number(b) ? a : b));
    expect(Object.values(draft.siteAndPriceMap ?? {})).toEqual([globalMax, globalMax]);
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
    expect(prompt).toContain('长20 宽10 高8');
    expect(prompt).toContain('原重量：0.5');
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

  it('teaches the title formula from high-selling samples, with a hard 60-char cap', async () => {
    const provider = fakeProvider(validOutput());
    const service = new EditGenerationService(
      { getById: vi.fn() },
      fakeSnapshots(detail()),
      () => provider,
    );

    await service.generate('90001');

    const prompt = (provider.generate as ReturnType<typeof vi.fn>).mock
      .calls[0][0].prompt as string;
    // The title rules should be taught from the buyer's samples: real word
    // stacking with counts/params, brand+model kept, "para + model" targets,
    // and a strict 60-char limit that trumps the samples (some samples exceed
    // 60 chars and must be shortened, not copied verbatim).
    expect(prompt).toMatch(/Metronomo Mecánico/);
    expect(prompt).toMatch(/Tenlamp G10|Galaxy Tab|Lawan Ab02/);
    expect(prompt).toMatch(/实词|堆叠|参数/);
    expect(prompt).toMatch(/60 个字符/);
    expect(prompt).toMatch(/照抄|不要.*抄|示例/);
  });

  it('tells the model to keep numeric specs and brand/model but cut fillers', async () => {
    const provider = fakeProvider(validOutput());
    const service = new EditGenerationService(
      { getById: vi.fn() },
      fakeSnapshots(detail()),
      () => provider,
    );

    await service.generate('90001');

    const prompt = (provider.generate as ReturnType<typeof vi.fn>).mock
      .calls[0][0].prompt as string;
    // High-selling titles carry counts/capacity/params and keep the brand and
    // model; fillers (New/Hot/原装) and verbatim copy of the source must go.
    expect(prompt).toMatch(/数量|容量|数字|参数/);
    expect(prompt).toMatch(/品牌.*型号|型号.*品牌/);
    expect(prompt).toMatch(/New|Hot|原装|包邮/);
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

  it('drops SKUs whose original stock is missing or ≤1 and sets survivors to 2', async () => {
    const lowStockDetail: CollectBoxDetailDto = {
      siteCollectItemInfo: {
        collectBoxDetailId: '90001',
        title: 'Grinder with variants',
        notes: 'Three color options.',
        skuMap: {
          ';good;': { itemNum: 'GOOD', stock: 100, originPrice: 66 },
          ';one;': { itemNum: 'ONE', stock: 1, originPrice: 66 },
          ';zero;': { itemNum: 'ZERO', stock: 0, originPrice: 66 },
          ';none;': { itemNum: 'NONE', originPrice: 66 },
        },
      },
    } as CollectBoxDetailDto;
    const provider = fakeProvider({
      ...validOutput(),
      skus: [
        {
          skuKey: ';good;',
          name: { value: 'Gris', confidence: 0.9 },
          package: {
            length: { value: '20', confidence: 0.7 },
            width: { value: '10', confidence: 0.7 },
            height: { value: '8', confidence: 0.7 },
            weight: { value: '500', confidence: 0.8 },
          },
        },
        // The model echoes dropped SKUs too; the service must drop them.
        {
          skuKey: ';one;',
          name: { value: 'Uno', confidence: 0.9 },
          package: {
            length: { value: '20', confidence: 0.7 },
            width: { value: '10', confidence: 0.7 },
            height: { value: '8', confidence: 0.7 },
            weight: { value: '500', confidence: 0.8 },
          },
        },
      ],
    });
    const service = new EditGenerationService(
      { getById: vi.fn() },
      fakeSnapshots(lowStockDetail),
      () => provider,
    );

    const draft = await service.generate('90001');

    // Only the stock-100 SKU survives; every survivor gets stock '2'.
    expect(draft.skus.map((sku) => sku.skuKey)).toEqual([';good;']);
    expect(draft.skus[0].stock).toEqual({ value: '2', source: 'ai', confidence: 1 });
  });

  it('keeps every surviving SKU when the model garbles or omits the opaque keys', async () => {
    // Real skuMap keys are opaque hashes like ;633b93b4;. The model usually
    // can't echo them back verbatim (it may rewrite them or drop the array),
    // so the draft must not drop the SKU just because the key didn't match.
    const opaqueDetail: CollectBoxDetailDto = {
      siteCollectItemInfo: {
        collectBoxDetailId: '90001',
        title: 'Metrónomo MT-32',
        notes: 'Tres colores.',
        skuMap: {
          ';633b93b4;': { itemNum: 'MT-32 Blanco', stock: 668, originPrice: 66, length: '10', weight: '300' },
          ';071c2366;': { itemNum: 'MT-32 Azul', stock: 634, originPrice: 66, length: '10', weight: '300' },
          ';b649bd41;': { itemNum: 'MT-32 Rosa', stock: 660, originPrice: 66, length: '10', weight: '300' },
        },
      },
    } as CollectBoxDetailDto;
    // Model returns NO skus at all.
    const provider = fakeProvider({
      title: { value: 'Metrónomo Digital MT-32', confidence: 0.9 },
      description: { value: 'Afinador digital.', confidence: 0.9 },
      model: { value: 'MT-32', confidence: 0.9 },
      skus: [],
    });
    const service = new EditGenerationService(
      { getById: vi.fn() },
      fakeSnapshots(opaqueDetail),
      () => provider,
    );

    const draft = await service.generate('90001');

    // All three surviving SKUs must still be present, with the original
    // dimensions/weight carried over and stock set to '2'.
    expect(draft.skus.map((sku) => sku.skuKey)).toEqual([
      ';633b93b4;',
      ';071c2366;',
      ';b649bd41;',
    ]);
    expect(draft.skus.every((sku) => sku.stock.value === '2')).toBe(true);
    expect(draft.skus[0].package).toMatchObject({
      length: { value: '10', source: 'remote', confidence: 1 },
      weight: { value: '300', source: 'remote', confidence: 1 },
    });
    expect(draft.skus[0].name).toEqual({ value: 'MT-32 Blanco', source: 'remote', confidence: 1 });
  });

  it('matches model SKU output by order when the key is rewritten', async () => {
    // Model reorders nothing but rewrites each opaque key (e.g. to a label).
    const opaqueDetail: CollectBoxDetailDto = {
      siteCollectItemInfo: {
        collectBoxDetailId: '90001',
        title: 'Metrónomo MT-32',
        notes: 'Tres colores.',
        skuMap: {
          ';633b93b4;': { itemNum: 'MT-32 Blanco', stock: 668 },
          ';071c2366;': { itemNum: 'MT-32 Azul', stock: 634 },
          ';b649bd41;': { itemNum: 'MT-32 Rosa', stock: 660 },
        },
      },
    } as CollectBoxDetailDto;
    const provider = fakeProvider({
      title: { value: 'Metrónomo Digital MT-32', confidence: 0.9 },
      description: { value: 'Afinador digital.', confidence: 0.9 },
      model: { value: 'MT-32', confidence: 0.9 },
      skus: [
        {
          skuKey: 'SKU1',
          name: { value: 'Blanco', confidence: 0.9 },
          package: {
            length: { value: '11', confidence: 0.7 },
            width: { value: '6', confidence: 0.7 },
            height: { value: '2', confidence: 0.7 },
            weight: { value: '320', confidence: 0.8 },
          },
        },
        {
          skuKey: 'SKU2',
          name: { value: 'Azul', confidence: 0.9 },
          package: {
            length: { value: '11', confidence: 0.7 },
            width: { value: '6', confidence: 0.7 },
            height: { value: '2', confidence: 0.7 },
            weight: { value: '320', confidence: 0.8 },
          },
        },
        {
          skuKey: 'SKU3',
          name: { value: 'Rosa Claro', confidence: 0.9 },
          package: {
            length: { value: '11', confidence: 0.7 },
            width: { value: '6', confidence: 0.7 },
            height: { value: '2', confidence: 0.7 },
            weight: { value: '320', confidence: 0.8 },
          },
        },
      ],
    });
    const service = new EditGenerationService(
      { getById: vi.fn() },
      fakeSnapshots(opaqueDetail),
      () => provider,
    );

    const draft = await service.generate('90001');

    // Order-based fallback assigns the model output in prompt order, so the
    // translated names and AI-estimated packages land on the right SKUs.
    expect(draft.skus.map((sku) => [sku.skuKey, sku.name.value])).toEqual([
      [';633b93b4;', 'Blanco'],
      [';071c2366;', 'Azul'],
      [';b649bd41;', 'Rosa Claro'],
    ]);
    expect(draft.skus[2].package.length).toEqual({ value: '11', source: 'ai', confidence: 0.7 });
  });

  it('keeps the brand fixed to Generic regardless of the model', async () => {
    const provider = fakeProvider(validOutput());
    const service = new EditGenerationService(
      { getById: vi.fn() },
      fakeSnapshots(detail()),
      () => provider,
    );

    const draft = await service.generate('90001');

    expect(draft.brand).toEqual({ value: 'Generic', source: 'fixed', confidence: 1 });
  });

  it('defaults an empty model to Generic', async () => {
    const provider = fakeProvider({
      ...validOutput(),
      model: { value: '', confidence: 0 },
    });
    const service = new EditGenerationService(
      { getById: vi.fn() },
      fakeSnapshots(detail()),
      () => provider,
    );

    const draft = await service.generate('90001');

    expect(draft.model).toEqual({ value: 'Generic', source: 'fixed', confidence: 1 });
  });

  it('regenerates from the miaoshou snapshot even when an aiDraft was appended after it', async () => {
    // After the first generate, the newest snapshot is an aiDraft (EditDraft
    // payload with no siteCollectItemInfo). Regenerating must read the latest
    // miaoshou snapshot instead, or it crashes on skuMap access.
    const provider = fakeProvider(validOutput());
    const service = new EditGenerationService(
      { getById: vi.fn() },
      snapshotsWithLaterAiDraft(detail()),
      () => provider,
    );

    const draft = await service.generate('90001');

    expect(draft.skus.map((sku) => sku.skuKey)).toEqual([';white;', ';black;']);
    expect(draft.title.value).toBe('Molinillo de café con muela de cerámica');
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
