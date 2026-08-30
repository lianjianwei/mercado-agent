import { describe, expect, it, vi } from 'vitest';
import { ImageGenerationService, buildDetailImagePrompt, buildMainImagePrompt } from '../../src/main/services/image-generation-service';
import type { ProductDetail } from '../../src/domain/product';
import type { EditDraft } from '../../src/domain/edit';
import type { DetailPlanItem } from '../../src/domain/images';
import type { ImageModelProvider, TextModelProvider } from '../../src/domain/providers';

const detail = { productId: 'p1', title: 'T', description: 'D', category: '猫咪用品',
  skuList: [
    { skuKey: ';a;', name: 'A', imageUrls: ['https://ref/a.png'], weight: null, length: null, width: null, height: null, stock: null, sourcePrice: null, netProfit: null, dimensionUnit: null, weightUnit: null, siteAndPriceMap: {}, siteAndListingTypeInfoMap: {}, imageUrl: null },
  ] } as unknown as ProductDetail;

const draft = { title: { value: 'T' }, description: { value: 'D' } } as unknown as EditDraft;

describe('ImageGenerationService', () => {
  it('builds a white-bg main-image prompt without logo or text', () => {
    const prompt = buildMainImagePrompt({ title: '按摩仪', description: 'x', category: '健康' });
    expect(prompt).toContain('白底');
    expect(prompt).toContain('无 logo');
  });

  it('builds a detail prompt in a single target language (no mixed languages)', () => {
    const item: DetailPlanItem = { id: 'd1', kind: '功能图', subject: 's', textEs: 'Es Text', textPt: 'Pt Text', hasPerson: false, referenceNote: '' };
    const es = buildDetailImagePrompt(item, 'T', 'es');
    expect(es).toContain('西班牙语');
    expect(es).toContain('Es Text');
    expect(es).not.toContain('Pt Text');

    const pt = buildDetailImagePrompt(item, 'T', 'pt');
    expect(pt).toContain('葡萄牙语');
    expect(pt).toContain('Pt Text');
    expect(pt).not.toContain('Es Text');
  });

  it('emits one main image per SKU with a local file and a snapshot record', async () => {
    const appendImages = vi.fn();
    const onProgress = vi.fn();
    const imageProvider = { testConnection: vi.fn(), generate: vi.fn(async () => [{ url: '', dataBase64: 'AAAA' }]) } as unknown as ImageModelProvider;
    const textProvider = {
      testConnection: vi.fn(),
      // 规划返回 plans;自检(提示词含「质检」)返回 ok:true,否则每张图都会按失败处理。
      generate: vi.fn(async (request: { prompt?: string }) =>
        String(request.prompt ?? '').includes('质检')
          ? { ok: true, issues: [] }
          : { plans: [{ id: 'd1', kind: '功能图', subject: 's', textEs: '', textPt: '', hasPerson: false, referenceNote: '' }] },
      ),
    } as unknown as TextModelProvider;
    const service = new ImageGenerationService({
      readDetail: () => detail,
      readDraft: () => draft,
      imageProvider: () => imageProvider,
      textProvider: () => textProvider,
      appendImages,
      imagesDir: '/tmp/imgs',
      now: () => '2026-08-29T00:00:00.000Z',
      onProgress,
    });
    const result = await service.generate('p1');
    expect(appendImages).toHaveBeenCalledWith('p1', expect.objectContaining({ status: 'done' }));
    expect(result.mainImages).toHaveLength(1);
    // 主图按 SKU 命名(main-{sku}.png)。
    expect(result.mainImages[0].imageId).toBe('main-;a;');
    expect(result.mainImages[0].localPath).toBe('/tmp/imgs/p1/main-;a;.png');
    expect(result.mainImages[0].plannedPath).toBe('mercado/p1/main-;a;.png');
    // 详情图按序号命名(detail-{N}.png)。
    expect(result.detailImages[0].plannedPath).toBe('mercado/p1/detail-1.png');
    // 进度回调覆盖规划、主图与详情图,并带耗时。
    const lines = onProgress.mock.calls.map((call) => String(call[0]));
    expect(lines.some((line) => line.includes('规划详情图'))).toBe(true);
    expect(lines.some((line) => line.includes('生成') && line.includes('主图'))).toBe(true);
    expect(lines.some((line) => line.includes('详情图') && line.includes('耗时'))).toBe(true);
  });

  it('isolates a self-check failure and still appends a snapshot', async () => {
    const appendImages = vi.fn();
    const imageProvider = { testConnection: vi.fn(), generate: vi.fn(async () => [{ url: '', dataBase64: 'AAAA' }]) } as unknown as ImageModelProvider;
    const textProvider = {
      testConnection: vi.fn(),
      // 自检分支(提示词含「质检」)直接抛出,模拟自检服务不可用;规划分支仍返回 plans。
      generate: vi.fn(async (request: { prompt?: string }) => {
        if (String(request.prompt ?? '').includes('质检')) throw new Error('自检服务异常');
        return { plans: [{ id: 'd1', kind: '功能图', subject: 's', textEs: '', textPt: '', hasPerson: false, referenceNote: '' }] };
      }),
    } as unknown as TextModelProvider;
    const service = new ImageGenerationService({
      readDetail: () => detail,
      readDraft: () => draft,
      imageProvider: () => imageProvider,
      textProvider: () => textProvider,
      appendImages,
      imagesDir: '/tmp/imgs',
      now: () => '2026-08-29T00:00:00.000Z',
    });
    const result = await service.generate('p1');
    expect(appendImages).toHaveBeenCalledWith('p1', expect.objectContaining({ status: 'done' }));
    expect(result.status).toBe('done');
    // 自检被跳过,但仍保存图片(状态 ok)。
    expect(result.mainImages[0].status).toBe('ok');
    expect(result.mainImages[0].localPath).toMatch(/\/tmp\/imgs\/p1\/.+\.png$/);
  });

  it('throws when there is no miaoshou detail', async () => {
    const imageProvider = { testConnection: vi.fn(), generate: vi.fn() } as unknown as ImageModelProvider;
    const textProvider = { testConnection: vi.fn(), generate: vi.fn() } as unknown as TextModelProvider;
    const service = new ImageGenerationService({
      readDetail: () => null,
      readDraft: () => null,
      imageProvider: () => imageProvider,
      textProvider: () => textProvider,
      appendImages: vi.fn(),
      imagesDir: '/tmp/imgs',
      now: () => '2026-08-29T00:00:00.000Z',
    });
    await expect(service.generate('p1')).rejects.toThrow(/暂无|无法生图/);
  });
});
