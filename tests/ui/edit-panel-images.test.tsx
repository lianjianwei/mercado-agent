// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditPanel } from '../../src/ui/features/editor/EditPanel';
import type { Product } from '../../src/domain/product';

afterEach(cleanup);

describe('EditPanel image generation', () => {
  it('chains image generation after the draft generate action and renders progress', async () => {
    const generateImages = vi.fn(async () => ({ version: 1, productId: 'p1',
      mainImages: [{ imageId: 'i1', kind: 'main', skuKey: ';a;', localPath: '/x/i1.png', plannedPath: 'mercado/p1/i1.png', sourceRefImages: [], prompt: 'p', attempts: 1, status: 'ok' as const, createdAt: 'x' }],
      detailImages: [], plan: [], status: 'done' as const, createdAt: 'x' }));
    const draft = {
      version: 1, createdAt: '2026-08-29T00:00:00.000Z',
      title: { value: 'T', source: 'ai' as const, confidence: 0.9 },
      description: { value: 'D', source: 'ai' as const, confidence: 0.9 },
      brand: { value: 'Generic', source: 'fixed' as const, confidence: 1 },
      model: { value: 'M', source: 'ai' as const, confidence: 0.6 },
      sites: [], siteAndPriceMap: {}, skus: [],
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
    // 进度区在 AI 编辑详情页签;草稿生成后切到该页签查看。
    fireEvent.click(await screen.findByText('AI 编辑详情'));
    expect(await screen.findByText(/图片生成/)).toBeTruthy();
  });
});
