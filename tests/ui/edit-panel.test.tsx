// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EditDraft } from '../../src/domain/edit';
import type { Product, ProductDetail } from '../../src/domain/product';
import type { EditApi } from '../../src/shared/ipc-contract';
import { EditPanel } from '../../src/ui/features/editor/EditPanel';

afterEach(cleanup);

const product: Product = {
  id: 'product-1',
  state: 'notPublished',
  title: 'Stainless Coffee Grinder',
  itemNumber: 'MLB-1001',
  thumbnailUrl: 'https://images.example.com/grinder.jpg',
  category: '厨房用具',
  netProfit: '52.40',
  stock: '86',
  sites: ['BR', 'MX'],
  sourcePrice: '18.9',
  localPublishState: 'notPublished',
  localPublishedAt: null,
  lastSyncedAt: '2026-08-27T01:00:00.000Z',
  createdAt: '2026-08-27T01:00:00.000Z',
  updatedAt: '2026-08-27T01:00:00.000Z',
};

const detail: ProductDetail = {
  productId: 'product-1',
  title: 'Stainless Coffee Grinder',
  description: '一体式陶瓷磨芯，粗细可调。',
  itemNumber: 'MLB-1001',
  category: '厨房用具',
  sites: ['BR', 'MX'],
  stock: '86',
  netProfit: '52.40',
  sourcePrice: '18.9',
  mainImage: 'https://images.example.com/grinder.jpg',
  images: ['https://images.example.com/grinder.jpg'],
  brand: 'Hario',
  model: 'CM-100',
  skuList: [
    {
      skuKey: ';white;',
      name: '白色',
      imageUrl: 'https://images.example.com/grinder.jpg',
      stock: '50',
      sourcePrice: '16.9',
      netProfit: null,
      length: '20',
      width: '10',
      height: '8',
      dimensionUnit: 'cm',
      weight: '0.5',
      weightUnit: 'kg',
      siteAndPriceMap: {},
      siteAndListingTypeInfoMap: {},
      imageUrls: ['https://images.example.com/grinder.jpg'],
    },
  ],
  siteAndPriceMap: {},
};

function draft(): EditDraft {
  return {
    version: 1,
    createdAt: '2026-08-28T01:00:00.000Z',
    title: { value: 'Molinillo de café', source: 'ai', confidence: 0.95 },
    description: { value: 'Muele café en grano.', source: 'ai', confidence: 0.88 },
    brand: { value: 'Generic', source: 'fixed', confidence: 1 },
    model: { value: 'CM-100', source: 'ai', confidence: 0.6 },
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
    ],
  };
}

function renderPanel(overrides: {
  existing?: EditDraft | null;
  generated?: EditDraft;
} = {}) {
  const { existing = null, generated = draft() } = overrides;
  const api: EditApi = {
    generate: vi.fn(async () => generated),
    draft: vi.fn(async () => existing),
    saveDraft: vi.fn(async (_id, incoming) => incoming),
  };
  const loadDetail = vi.fn(async () => detail);
  render(<EditPanel api={api} loadDetail={loadDetail} product={product} />);
  return { api, loadDetail };
}

describe('EditPanel', () => {
  it('shows the Miaoshou detail with a generate button when there is no draft', async () => {
    const { api } = renderPanel();
    // Miaoshou detail is available immediately, even without an AI draft.
    expect(await screen.findByText('Hario')).toBeTruthy();
    expect(screen.getByRole('button', { name: '生成 AI 草稿' })).toBeTruthy();
    expect(api.generate).not.toHaveBeenCalled();
    // No AI draft tab when there is no draft.
    expect(screen.queryByRole('tab', { name: 'AI 编辑详情' })).toBeNull();
  });

  it('shows the product-level global net profit in the Miaoshou view', async () => {
    renderPanel();
    // 妙手产品级 netProfit 每个产品都有,应显示为全球净收益。
    expect(await screen.findByText('全球净收益')).toBeTruthy();
    expect(screen.getByText('$52.40 USD')).toBeTruthy();
  });

  it('shows every SKU with name, stock, source price, dimensions and weight in the Miaoshou view', async () => {
    renderPanel();

    expect(await screen.findByText('SKU 信息')).toBeTruthy();
    // 名称既出现在 SKU 卡里,也出现在「产品图片」区块的图集标签中。
    expect(screen.getAllByText('白色').length).toBeGreaterThanOrEqual(1); // original SKU name
    expect(screen.getByText('50')).toBeTruthy(); // stock
    expect(screen.getByText('16.9')).toBeTruthy(); // source price
    expect(screen.getByText('20 cm')).toBeTruthy();
    expect(screen.getByText('10 cm')).toBeTruthy();
    expect(screen.getByText('8 cm')).toBeTruthy();
    expect(screen.getByText('0.5 kg')).toBeTruthy();
  });

  it('generates a draft and shows editable fields with source badges', async () => {
    const user = userEvent.setup();
    const { api } = renderPanel();
    await user.click(await screen.findByRole('button', { name: '生成 AI 草稿' }));

    expect(api.generate).toHaveBeenCalledWith('product-1');
    await user.click(await screen.findByRole('tab', { name: 'AI 编辑详情' }));
    const titleInput = await screen.findByLabelText('标题');
    expect((titleInput as HTMLInputElement).value).toBe('Molinillo de café');
    expect(screen.getByText('AI 生成 · 95%')).toBeTruthy();
    // Some fields (stock) are fixed at 100%.
    expect(screen.getAllByText('AI 生成 · 100%').length).toBeGreaterThanOrEqual(1);
    // Brand is a fixed value, not an editable input, and shows its own badge.
    expect(screen.getByText('固定值 · 100%')).toBeTruthy();
    expect(screen.getByText('Generic')).toBeTruthy();
  });

  it('switches between the Miaoshou detail and the AI draft views', async () => {
    const user = userEvent.setup();
    renderPanel({ existing: draft() });

    // The Miaoshou detail is the default view.
    expect(await screen.findByText('Hario')).toBeTruthy();
    expect(screen.getByText('CM-100')).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: 'AI 编辑详情' }));
    expect(await screen.findByLabelText('标题')).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: '妙手详情' }));
    expect(await screen.findByText('Hario')).toBeTruthy();
  });

  it('marks a manually edited field as 人工修改', async () => {
    const user = userEvent.setup();
    renderPanel({ existing: draft() });

    await user.click(await screen.findByRole('tab', { name: 'AI 编辑详情' }));
    const titleInput = await screen.findByLabelText('标题');
    await user.clear(titleInput);
    await user.type(titleInput, 'Molinillo editado');
    await user.click(screen.getByRole('button', { name: '保存草稿' }));

    expect(await screen.findByText('人工修改 · 100%')).toBeTruthy();
  });

  it('saves the edited draft through the api', async () => {
    const user = userEvent.setup();
    const { api } = renderPanel({ existing: draft() });

    await user.click(await screen.findByRole('tab', { name: 'AI 编辑详情' }));
    const titleInput = await screen.findByLabelText('标题');
    await user.clear(titleInput);
    await user.type(titleInput, 'Nuevo título');
    await user.click(screen.getByRole('button', { name: '保存草稿' }));

    expect(api.saveDraft).toHaveBeenCalledTimes(1);
    expect(api.saveDraft).toHaveBeenCalledWith(
      'product-1',
      expect.objectContaining({
        title: { value: 'Nuevo título', source: 'user', confidence: 1 },
      }),
    );
  });

  it('shows SKU translations, stock, source price, and package fields in the draft view', async () => {
    const user = userEvent.setup();
    renderPanel({ existing: draft() });

    await user.click(await screen.findByRole('tab', { name: 'AI 编辑详情' }));
    const whiteSku = (await screen.findByLabelText('SKU 名称')) as HTMLInputElement;
    expect(whiteSku.value).toBe('Blanco');
    expect((screen.getByLabelText('货源价') as HTMLInputElement).value).toBe('66');
    expect((screen.getByLabelText('库存') as HTMLInputElement).value).toBe('2');
    expect((screen.getByLabelText('长度') as HTMLInputElement).value).toBe('20');
    expect((screen.getByLabelText('重量') as HTMLInputElement).value).toBe('500');
    // Units are fixed constants, shown inside the field labels (cm/g).
  });

  it('shows an error when the api rejects', async () => {
    const api: EditApi = {
      generate: vi.fn(async () => {
        throw new Error('模型服务不可用');
      }),
      draft: vi.fn(async () => null),
      saveDraft: vi.fn(async (_id, incoming) => incoming),
    };
    const user = userEvent.setup();
    render(<EditPanel api={api} loadDetail={vi.fn(async () => detail)} product={product} />);

    await user.click(await screen.findByRole('button', { name: '生成 AI 草稿' }));
    expect(await screen.findByText('模型服务不可用')).toBeTruthy();
  });
});
