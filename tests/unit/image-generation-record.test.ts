// tests/unit/image-generation-record.test.ts
import { describe, expect, it, vi } from 'vitest';
import { ImageGenerationService } from '../../src/main/services/image-generation-service';
import { aiImagesSnapshotSchema } from '../../src/shared/image-schemas';
import type { ProductDetail } from '../../src/domain/product';
import type { EditDraft } from '../../src/domain/edit';
import type { ImageModelProvider, TextModelProvider } from '../../src/domain/providers';

const detail = { productId: 'p1', title: 'T', description: 'D', category: 'C', skuList: [
  { skuKey: ';a;', name: 'A', imageUrls: ['https://ref/a.png'] },
] } as unknown as ProductDetail;
const draft = { title: { value: 'T' }, description: { value: 'D' } } as unknown as EditDraft;

describe('aiImages record contract', () => {
  it('every emitted image satisfies the snapshot schema and a deletable planned path', async () => {
    const appended: Array<{ kind: string; payload: unknown }> = [];
    const imageProvider = { testConnection: vi.fn(), generate: vi.fn(async () => [{ url: '', dataBase64: 'AAAA' }]) } as unknown as ImageModelProvider;
    const textProvider = {
      testConnection: vi.fn(),
      generate: vi.fn(async (request: { prompt?: string }) =>
        String(request.prompt ?? '').includes('质检')
          ? { ok: true, issues: [] }
          : { plans: [
              { id: 'd1', kind: '功能图', subject: 's', textEs: 'Es', textPt: 'Pt', hasPerson: false, referenceNote: '' },
            ] }),
    } as unknown as TextModelProvider;
    const service = new ImageGenerationService({
      readDetail: () => detail, readDraft: () => draft,
      imageProvider: () => imageProvider, textProvider: () => textProvider,
      appendImages: (productId, result) => appended.push({ kind: 'aiImages', payload: result }),
      imagesDir: '/tmp/imgs', now: () => '2026-08-29T00:00:00.000Z',
    });
    const result = await service.generate('p1');
    expect(aiImagesSnapshotSchema.safeParse(result).success).toBe(true);
    expect(appended).toHaveLength(1);
    expect(appended[0].kind).toBe('aiImages');
    // 命名规则:主图 main-{SKU序号}.png,详情图 detail-{N}.png。
    const planned = [...result.mainImages, ...result.detailImages].map((image) => image.plannedPath).sort();
    expect(planned).toEqual(['mercado/p1/detail-1.png', 'mercado/p1/main-1.png']);
  });
});
