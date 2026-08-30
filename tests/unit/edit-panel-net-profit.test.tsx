// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditPanel } from '../../src/ui/features/editor/EditPanel';
import type { EditDraft } from '../../src/domain/edit';
import type { Product, ProductDetail } from '../../src/domain/product';
import type { EditApi } from '../../src/shared/ipc-contract';

afterEach(cleanup);

const draft: EditDraft = {
  version: 1,
  createdAt: '2026-08-29T00:00:00.000Z',
  title: { value: 'Título', source: 'ai', confidence: 0.9 },
  description: { value: 'Descripción', source: 'ai', confidence: 0.9 },
  brand: { value: 'Generic', source: 'fixed', confidence: 1 },
  model: { value: 'M', source: 'ai', confidence: 0.6 },
  sites: ['MX(Up)', 'AR(Up)'],
  siteAndPriceMap: { 'MX(Up)': '11.5', 'AR(Up)': '11.5' },
  skus: [
    {
      skuKey: ';a;',
      name: { value: 'Blanco', source: 'ai', confidence: 0.9 },
      stock: { value: '2', source: 'ai', confidence: 1 },
      sourcePrice: { value: '20', source: 'remote', confidence: 1 },
      package: {
        length: { value: '20', source: 'ai', confidence: 0.7 },
        width: { value: '10', source: 'ai', confidence: 0.7 },
        height: { value: '8', source: 'ai', confidence: 0.7 },
        dimensionUnit: 'cm',
        weight: { value: '500', source: 'ai', confidence: 0.8 },
        weightUnit: 'g',
      },
      siteAndPriceMap: { 'MX(Up)': '9', 'AR(Up)': '11.5' },
      siteAndListingTypeInfoMap: {
        MX: { listingType: 'gold_pro' },
        AR: { listingType: 'gold_special' },
      },
      siteNetProfitDetail: {
        MX: {
          siteKey: 'MX(Up)',
          siteCode: 'MX',
          currency: 'MXN',
          sourcePriceCny: 20,
          packingCostCny: 2.5,
          weightG: 500,
          lengthCm: 20,
          widthCm: 10,
          heightCm: 8,
          billableKg: 0.5,
          isVolumeWeight: false,
          targetMargin: 20,
          marginMode: 'price',
          listingType: 'gold_pro',
          commissionPct: 20,
          fxCny: 7.18,
          fxLocal: 17.35,
          siteThreshold: 299,
          isHigh: true,
          tier: { minKg: 0.5, maxKg: 0.6, highPriceUsd: 7.16, lowPriceUsd: 4.71 },
          shippingUsd: 7.16,
          priceUsd: 17.95,
          netProfitUsd: 9,
        },
        AR: {
          siteKey: 'AR(Up)',
          siteCode: 'AR',
          currency: 'ARS',
          sourcePriceCny: 20,
          packingCostCny: 2.5,
          weightG: 500,
          lengthCm: 20,
          widthCm: 10,
          heightCm: 8,
          billableKg: 0.5,
          isVolumeWeight: false,
          targetMargin: 20,
          marginMode: 'price',
          listingType: 'gold_special',
          commissionPct: 12,
          fxCny: 7.18,
          fxLocal: 1450,
          siteThreshold: 33000,
          isHigh: false,
          tier: { minKg: 0.5, maxKg: 0.6, highPriceUsd: 14.4, lowPriceUsd: 5.95 },
          shippingUsd: 5.95,
          priceUsd: 19.94,
          netProfitUsd: 11.5,
        },
      },
    },
  ],
};

function api(): EditApi {
  return {
    draft: vi.fn(async () => draft),
    generate: vi.fn(async () => draft),
    saveDraft: vi.fn(async (_id, value) => value),
    saveToMiaoshou: vi.fn(async (_id: string) => ({ detailId: _id })),
    onEditLog: () => () => undefined,
    images: {
      generateImages: vi.fn(async () => ({
        version: 1,
        productId: 'p1',
        mainImages: [],
        detailImages: [],
        plan: [],
        status: 'done' as const,
        createdAt: 'x',
      })),
      getImages: vi.fn(async () => null),
      uploadImages: vi.fn(async () => ({
        version: 1,
        productId: 'p1',
        mainImages: [],
        detailImages: [],
        plan: [],
        status: 'done' as const,
        createdAt: 'x',
      })),
    },
  };
}

const product = { id: 'p1', title: 'Metrónomo' } as Product;

function detail(): ProductDetail {
  return {
    productId: 'p1',
    title: 'Metrónomo',
    description: 'Afinador',
    itemNumber: null,
    category: null,
    sites: ['MX(Up)', 'AR(Up)'],
    stock: null,
    netProfit: null,
    sourcePrice: null,
    mainImage: null,
    images: [],
    skuList: [],
    brand: null,
    model: null,
    siteAndPriceMap: {},
  };
}

describe('EditPanel net profit display', () => {
  it('shows the global net profit and per-site type + net profit on each SKU card', async () => {
    render(<EditPanel api={api()} loadDetail={async () => detail()} product={product} />);

    // 草稿存在 → 出现「AI 编辑详情」页签
    fireEvent.click(await screen.findByText('AI 编辑详情'));

    // 全球净收益:数值框(AI 编辑里可编辑)+ 币种框并排。
    const globalSection = screen.getByText('全球净收益').closest('section')!;
    expect((within(globalSection).getByLabelText('全球净收益') as HTMLInputElement).value).toBe('11.5');
    expect(within(globalSection).getByText('USD')).toBeTruthy();
    // 站点净收益矩阵:列 = 站点(墨西哥/阿根廷),单元格 = 可编辑净收益 + 产品类型下拉。
    const siteSection = screen.getByText('站点净收益 (USD)').closest('section')!;
    expect(within(siteSection).getByText('墨西哥')).toBeTruthy();
    expect(within(siteSection).getByText('阿根廷')).toBeTruthy();
    expect((within(siteSection).getByLabelText('Blanco MX 净收益') as HTMLInputElement).value).toBe('9');
    expect((within(siteSection).getByLabelText('Blanco MX 产品类型') as HTMLSelectElement).value).toBe('gold_pro');
    expect((within(siteSection).getByLabelText('Blanco AR 净收益') as HTMLInputElement).value).toBe('11.5');
    expect((within(siteSection).getByLabelText('Blanco AR 产品类型') as HTMLSelectElement).value).toBe('gold_special');
  });

  it('lets the user edit net profit, product type and global net profit', async () => {
    const saveDraft = vi.fn(async (_id: string, value: EditDraft) => value);
    render(<EditPanel api={{ ...api(), saveDraft }} loadDetail={async () => detail()} product={product} />);

    fireEvent.click(await screen.findByText('AI 编辑详情'));

    fireEvent.change(screen.getByLabelText('Blanco MX 净收益'), { target: { value: '22.5' } });
    fireEvent.change(screen.getByLabelText('Blanco MX 产品类型'), { target: { value: 'gold_special' } });
    fireEvent.change(screen.getByLabelText('全球净收益'), { target: { value: '33.3' } });

    fireEvent.click(screen.getByText('保存草稿'));
    await vi.waitFor(() => expect(saveDraft).toHaveBeenCalled());
    const sentDraft = saveDraft.mock.calls[0][1] as EditDraft;
    expect(sentDraft.skus[0].siteAndPriceMap['MX(Up)']).toBe('22.5');
    expect(sentDraft.skus[0].siteNetProfitOverrides?.MX.netProfit).toBe('22.5');
    expect(sentDraft.skus[0].siteAndListingTypeInfoMap.MX.listingType).toBe('gold_special');
    expect(sentDraft.globalNetProfitOverride).toBe('33.3');
    expect(sentDraft.siteAndPriceMap).toEqual({ 'MX(Up)': '33.3', 'AR(Up)': '33.3' });
  });

  it('opens the compact breakdown popover from a cell with detail and shows the tier/shipping', async () => {
    render(<EditPanel api={api()} loadDetail={async () => detail()} product={product} />);

    fireEvent.click(await screen.findByText('AI 编辑详情'));
    const siteSection = screen.getByText('站点净收益 (USD)').closest('section')!;

    // 每个有明细的单元格都有「计算详情」入口(MX / AR 两列)。
    const buttons = within(siteSection).getAllByText('计算详情');
    expect(buttons.length).toBeGreaterThan(0);
    fireEvent.click(buttons[0]);

    // 浮层弹出,展示命中阶梯与运费等只读明细。
    const popover = await screen.findByRole('dialog', { name: /净收益计算详情/ });
    expect(within(popover).getByText('墨西哥')).toBeTruthy();
    expect(within(popover).getByText('命中阶梯')).toBeTruthy();
    expect(within(popover).getByText(/0.5–0.6 kg/)).toBeTruthy();
    expect(within(popover).getByText('7.16 USD(高价档)')).toBeTruthy();
    expect(within(popover).getByText('净收益')).toBeTruthy();
    expect(within(popover).getByText('9 USD')).toBeTruthy();
  });
});
