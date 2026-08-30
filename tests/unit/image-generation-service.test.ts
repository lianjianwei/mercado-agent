import { describe, expect, it, vi } from 'vitest';
import { ImageGenerationService, buildDetailImagePrompt, buildMainImagePrompt, detectQuantity } from '../../src/main/services/image-generation-service';
import type { ProductDetail } from '../../src/domain/product';
import type { EditDraft } from '../../src/domain/edit';
import type { AiImagesResult, DetailPlanItem, GeneratedImage } from '../../src/domain/images';
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

  it('adds a stacking rule to the main-image prompt for a multi-unit product', () => {
    const prompt = buildMainImagePrompt({ title: '10个装 一次性碗筷', description: 'x', category: '餐具', quantity: '10 个' });
    expect(prompt).toContain('多件装');
    expect(prompt).toContain('堆叠');
    expect(prompt).toContain('不必精确画出');
  });

  it('detectQuantity reads a multi-unit count from the title or description', () => {
    expect(detectQuantity('10个装 派对发箍', '一次性用品')).toBe('10 个');
    expect(detectQuantity('一次性碗筷 100只装', 'x')).toBe('100 只');
    expect(detectQuantity('普通单品 发箍')).toBeNull(); // 无数量
    expect(detectQuantity('2个装 小套件')).toBeNull(); // 少量不触发
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
    // 主图按 SKU 序号命名(main-{序号}.png)。
    expect(result.mainImages[0].imageId).toBe('main-1');
    expect(result.mainImages[0].localPath).toBe('/tmp/imgs/p1/main-1.png');
    expect(result.mainImages[0].plannedPath).toBe('mercado/p1/main-1.png');
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

  it('publishExisting uploads already-generated images without regenerating', async () => {
    const appendImages = vi.fn();
    const writeDraftImages = vi.fn();
    const existing: AiImagesResult = {
      version: 1, productId: 'p1',
      mainImages: [{ imageId: 'main-1', kind: 'main', skuKey: ';a;', localPath: '/tmp/imgs/p1/main-1.png', plannedPath: 'mercado/p1/main-1.png', sourceRefImages: [], prompt: 'p', attempts: 1, status: 'ok', createdAt: 'x' }],
      detailImages: [], plan: [], status: 'done', createdAt: 'x',
    };
    const publish = vi.fn(async (_productId: string, images: GeneratedImage[]) =>
      images.map((image) => ({ ...image, publicUrl: `https://cdn/x/${image.imageId}.png` })),
    );
    const readImages = vi.fn(() => existing);
    const imageProvider = { testConnection: vi.fn(), generate: vi.fn() } as unknown as ImageModelProvider;
    const textProvider = { testConnection: vi.fn(), generate: vi.fn() } as unknown as TextModelProvider;

    const service = new ImageGenerationService({
      readDetail: () => detail, readDraft: () => draft,
      imageProvider: () => imageProvider, textProvider: () => textProvider,
      appendImages, imagesDir: '/tmp/imgs', now: () => 'x',
      publish, writeDraftImages, readImages,
    });
    const result = await service.publishExisting('p1');

    // 不重新生成:只上传已存在的图,并写回草稿。
    expect(imageProvider.generate).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(result.mainImages[0].publicUrl).toBe('https://cdn/x/main-1.png');
    expect(writeDraftImages).toHaveBeenCalledWith('p1', expect.any(Array), expect.any(Array));
    // 上传后的快照用新时间戳,避免与最初生成那份撞 time 导致读回挑错。
    expect(result.createdAt).toBe('x');
  });

  it('publishes (compress+upload) images after generation and writes back the draft', async () => {
    const appendImages = vi.fn();
    const writeDraftImages = vi.fn();
    const publish = vi.fn(async (_productId: string, images: GeneratedImage[]) =>
      images.map((image) => ({ ...image, publicUrl: `https://cdn/x/${image.imageId}.png` })),
    );
    const imageProvider = { testConnection: vi.fn(), generate: vi.fn(async () => [{ url: '', dataBase64: 'AAAA' }]) } as unknown as ImageModelProvider;
    const textProvider = {
      testConnection: vi.fn(),
      generate: vi.fn(async (request: { prompt?: string }) =>
        String(request.prompt ?? '').includes('质检')
          ? { ok: true, issues: [] }
          : { plans: [{ id: 'd1', kind: '功能图', subject: 's', textEs: '', textPt: '', hasPerson: false, referenceNote: '' }] },
      ),
    } as unknown as TextModelProvider;

    const service = new ImageGenerationService({
      readDetail: () => detail, readDraft: () => draft,
      imageProvider: () => imageProvider, textProvider: () => textProvider,
      appendImages, imagesDir: '/tmp/imgs', now: () => '2026-08-29T00:00:00.000Z',
      publish, writeDraftImages,
    });
    const result = await service.generate('p1');

    expect(publish).toHaveBeenCalledTimes(1);
    expect(result.mainImages[0].publicUrl).toBe('https://cdn/x/main-1.png');
    expect(result.detailImages[0].publicUrl).toBe('https://cdn/x/detail-1.png');
    expect(writeDraftImages).toHaveBeenCalledWith('p1', expect.any(Array), expect.any(Array));
  });

  it('uses generateBatch once when available and retries only the failing image', async () => {
    const appendImages = vi.fn();
    const onProgress = vi.fn();
    // 自检文本:规划返回 2 张详情图;首次自检不过(触发补跑),后续都过。
    const generateText = vi.fn(async (request: { prompt?: string }) => {
      if (!String(request.prompt ?? '').includes('质检')) {
        return { plans: [
          { id: 'd1', kind: '功能图', subject: 's1', textEs: '', textPt: '', hasPerson: false, referenceNote: '' },
          { id: 'd2', kind: '场景图', subject: 's2', textEs: '', textPt: '', hasPerson: false, referenceNote: '' },
        ] };
      }
      const selfChecks = generateText.mock.calls.filter((c) => String(c[0].prompt).includes('质检'));
      return selfChecks.length < 2 ? { ok: false, issues: ['主体不清晰'] } : { ok: true, issues: [] };
    });
    const textProvider = { testConnection: vi.fn(), generate: generateText as unknown as TextModelProvider['generate'] } as unknown as TextModelProvider;

    const generate = vi.fn(async (_request: { prompt?: string }) => [{ url: '', dataBase64: 'RETRY' }]);
    const generateBatch = vi.fn(async () => [{ url: '', dataBase64: 'AAAA' }, { url: '', dataBase64: 'BBBB' }, { url: '', dataBase64: 'CCCC' }]);
    const imageProvider = { testConnection: vi.fn(), generate, generateBatch } as unknown as ImageModelProvider;

    const service = new ImageGenerationService({
      readDetail: () => detail, readDraft: () => draft,
      imageProvider: () => imageProvider, textProvider: () => textProvider,
      appendImages, imagesDir: '/tmp/imgs', now: () => '2026-08-29T00:00:00.000Z', onProgress,
    });
    const result = await service.generate('p1');

    // 一次批量产出(主图 1 + 详情图 2)。
    expect(generateBatch).toHaveBeenCalledTimes(1);
    expect(result.mainImages).toHaveLength(1);
    expect(result.detailImages).toHaveLength(2);

    // 主图首次自检不过 → 只对这一张单独补跑一次;补跑后过检 → 状态 ok,attempts=2。
    expect(generate).toHaveBeenCalledTimes(1);
    expect(String(generate.mock.calls[0][0].prompt)).toContain('未过质检');
    expect(result.mainImages[0].status).toBe('ok');
    expect(result.mainImages[0].attempts).toBe(2);

    // 详情图都过一次自检,无需补跑。
    expect(result.detailImages[0].status).toBe('ok');
    expect(result.detailImages[1].status).toBe('ok');
    expect(appendImages).toHaveBeenCalledWith('p1', expect.objectContaining({ status: 'done' }));
  });
});
