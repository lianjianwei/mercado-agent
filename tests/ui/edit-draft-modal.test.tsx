// @vitest-environment jsdom

import { useState } from 'react';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EditDraft } from '../../src/domain/edit';
import type { Product, ProductDetail } from '../../src/domain/product';
import type { EditApi } from '../../src/shared/ipc-contract';
import { EditDraftModal } from '../../src/ui/features/editor/EditDraftModal';

afterEach(cleanup);

const product = { id: 'p1', title: 'Metrónomo' } as Product;

const detail: ProductDetail = {
  productId: 'p1',
  title: 'Metrónomo',
  description: 'Afinador',
  itemNumber: null,
  category: null,
  sites: [],
  stock: null,
  netProfit: null,
  sourcePrice: null,
  mainImage: null,
  images: [],
  brand: null,
  model: null,
  skuList: [
    {
      skuKey: ';a;',
      name: '白色',
      imageUrl: 'https://img.test/a.jpg',
      imageUrls: ['https://img.test/a.jpg'],
      stock: null,
      sourcePrice: null,
      netProfit: null,
      length: null,
      width: null,
      height: null,
      dimensionUnit: null,
      weight: null,
      weightUnit: null,
      siteAndPriceMap: {},
      siteAndListingTypeInfoMap: {},
    },
  ],
  siteAndPriceMap: {},
};

const draft: EditDraft = {
  version: 1,
  createdAt: '2026-08-29T00:00:00.000Z',
  title: { value: 'T', source: 'ai', confidence: 1 },
  description: { value: 'D', source: 'ai', confidence: 1 },
  brand: { value: 'Generic', source: 'fixed', confidence: 1 },
  model: { value: 'M', source: 'ai', confidence: 1 },
  sites: [],
  siteAndPriceMap: {},
  skus: [],
};

function api(): EditApi {
  return {
    generate: vi.fn(async () => draft),
    draft: vi.fn(async () => null),
    saveDraft: vi.fn(async (_id, value) => value),
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

function Harness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <EditDraftModal
      product={product}
      api={api()}
      loadDetail={vi.fn(async () => detail)}
      onClose={() => {
        setOpen(false);
        onClose();
      }}
    />
  );
}

describe('EditDraftModal AI edit log', () => {
  it('shows the AI edit log lines streamed via onEditLog', async () => {
    let emit: ((line: string) => void) | undefined;
    const editApi: EditApi = {
      ...api(),
      onEditLog: (listener) => {
        emit = listener;
        return () => undefined;
      },
    };
    render(
      <EditDraftModal
        api={editApi}
        loadDetail={vi.fn(async () => detail)}
        onClose={() => undefined}
        product={product}
      />,
    );
    await screen.findByText('SKU 信息');

    // 尚无日志行时不显示。
    expect(screen.queryByLabelText('AI 编辑日志')).toBeNull();

    // 主进程推流首行 → 日志区出现,并停在固定高度滚动区里。
    emit!('正在生成标题、描述、SKU 尺寸与重量…');
    expect(await screen.findByLabelText('AI 编辑日志')).toBeTruthy();
    expect(await screen.findByText('正在生成标题、描述、SKU 尺寸与重量…')).toBeTruthy();

    emit!('标题、描述、SKU 尺寸与重量生成完成（耗时 30.2s）。');
    expect(await screen.findByText(/生成完成（耗时 30.2s）。/)).toBeTruthy();
  });
});

describe('EditDraftModal escape-key handling', () => {
  it('closes only the lightbox on Esc when it is open, then closes the modal on the next Esc', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    // 等待妙手详情(含 SKU 图片)异步渲染完成。
    await screen.findByText('SKU 信息');
    const thumb = document.querySelector('.image-zoom-button img') as HTMLElement;
    fireEvent.click(thumb);

    // 图片灯箱打开。
    expect(screen.getByRole('dialog', { name: '图片预览' })).toBeTruthy();

    // 第一次 Esc:仅关灯箱,AI 编辑弹窗保持打开。
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '图片预览' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'AI 编辑' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    // 第二次 Esc:关掉 AI 编辑弹窗。
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'AI 编辑' })).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
