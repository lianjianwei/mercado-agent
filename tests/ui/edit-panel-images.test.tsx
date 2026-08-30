// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditPanel } from '../../src/ui/features/editor/EditPanel';
import type { Product } from '../../src/domain/product';

afterEach(cleanup);

describe('EditPanel image generation', () => {
  it('chains image generation after the draft generate action and shows the mirrored 产品图片 section', async () => {
    const generateImages = vi.fn(async () => ({ version: 1, productId: 'p1',
      mainImages: [{ imageId: 'i1', kind: 'main', skuKey: ';a;', localPath: '/x/i1.png', plannedPath: 'mercado/p1/i1.png', sourceRefImages: [], prompt: 'p', attempts: 1, status: 'ok' as const, createdAt: 'x' }],
      detailImages: [], plan: [], status: 'done' as const, createdAt: 'x' }));
    const draft = {
      version: 1, createdAt: '2026-08-29T00:00:00.000Z',
      title: { value: 'T', source: 'ai' as const, confidence: 0.9 },
      description: { value: 'D', source: 'ai' as const, confidence: 0.9 },
      brand: { value: 'Generic', source: 'fixed' as const, confidence: 1 },
      model: { value: 'M', source: 'ai' as const, confidence: 0.6 },
      sites: [], siteAndPriceMap: {}, mainImage: null, images: [], skus: [],
    };
    const api = {
      generate: vi.fn(async () => draft),
      draft: vi.fn(async () => null),
      saveDraft: vi.fn(async () => draft),
      images: { generateImages },
    };
    render(<EditPanel api={api as never} loadDetail={async () => ({ skuList: [], sites: [], images: [], productId: 'p1', title: 'T', description: 'D', category: '猫', netProfit: null, stock: null, sourcePrice: null, mainImage: null, brand: null, model: null, siteAndPriceMap: {} } as never)} product={{ id: 'p1', title: 'Metrónomo' } as Product} />);
    fireEvent.click(await screen.findByText('生成 AI 草稿'));
    await waitFor(() => expect(generateImages).toHaveBeenCalledWith('p1'));
    // 切到 AI 编辑详情:布局镜像妙手,是「产品图片」区而非单独的「图片生成」块。
    fireEvent.click(await screen.findByText('AI 编辑详情'));
    expect(await screen.findByText('产品图片')).toBeTruthy();
    expect(screen.queryByText('图片生成')).toBeNull();
  });

  it('has a 重新生成图片 button that regenerates images only and refreshes the draft', async () => {
    const generateImages = vi.fn(async () => ({
      version: 1, productId: 'p1',
      mainImages: [{ imageId: 'main-1-202608290000', kind: 'main', skuKey: ';a;', localPath: '/x/main-1.png', plannedPath: 'mercado/p1/main-1-202608290000.png', sourceRefImages: [], prompt: 'p', attempts: 1, status: 'ok' as const, createdAt: 'x' }],
      detailImages: [], plan: [], status: 'done' as const, createdAt: 'x',
    }));
    const draftState = {
      version: 1, createdAt: '2026-08-29T00:00:00.000Z',
      title: { value: 'T', source: 'ai' as const, confidence: 0.9 },
      description: { value: 'D', source: 'ai' as const, confidence: 0.9 },
      brand: { value: 'Generic', source: 'fixed' as const, confidence: 1 },
      model: { value: 'M', source: 'ai' as const, confidence: 0.6 },
      sites: [], siteAndPriceMap: {}, mainImage: null, images: [], skus: [],
    };
    const draft = vi.fn(async () => draftState);
    const api = {
      generate: vi.fn(async () => draftState),
      draft,
      saveDraft: vi.fn(async (_id: string, value: unknown) => value),
      images: { generateImages },
    };
    render(<EditPanel api={api as never} loadDetail={async () => ({ skuList: [], sites: [], images: [], productId: 'p1', title: 'T', description: 'D', category: '猫', netProfit: null, stock: null, sourcePrice: null, mainImage: null, brand: null, model: null, siteAndPriceMap: {} } as never)} product={{ id: 'p1', title: 'Metrónomo' } as Product} />);

    // 草稿已存在 → 出现 AI 编辑详情页签。
    fireEvent.click(await screen.findByText('AI 编辑详情'));

    fireEvent.click(screen.getByText('重新生成图片'));
    await waitFor(() => expect(generateImages).toHaveBeenCalledWith('p1'));
    expect(api.generate).not.toHaveBeenCalled();
  });
});
