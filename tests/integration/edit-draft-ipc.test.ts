import { describe, expect, it, vi } from 'vitest';

import {
  readLatestDraft,
  registerEditHandlers,
} from '../../src/main/ipc/edit-handlers';
import { IPC_CHANNELS, type IpcListener } from '../../src/shared/ipc-contract';
import type { EditDraft } from '../../src/domain/edit';
import type { NetProfitBreakdown } from '../../src/domain/net-profit';

// A pass-through calculator: these handler tests exercise draft persistence,
// not net-profit math, so recompute just echoes the draft back.
const identityCalculator = { computeForDraft: vi.fn((draft: EditDraft) => draft) };

function makeDraft(version: number): EditDraft {
  return {
    version,
    createdAt: '2026-08-28T01:00:00.000Z',
    title: { value: 'Titulo', source: 'ai', confidence: 0.9 },
    description: { value: 'Descripción', source: 'ai', confidence: 0.8 },
    brand: { value: 'Generic', source: 'fixed', confidence: 1 },
    model: { value: 'CM-100', source: 'ai', confidence: 0.6 },
    sites: [],
    siteAndPriceMap: {},
    mainImage: null,
    images: [],
    skus: [
      {
        skuKey: ';white;',
        name: { value: 'Blanco', source: 'ai', confidence: 0.9 },
        stock: { value: '2', source: 'ai', confidence: 1 },
        sourcePrice: { value: '66', source: 'remote', confidence: 1 },
        imageUrl: null,
        imageUrls: [],
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

type Snapshot = {
  id: string;
  productId: string;
  kind: 'miaoshou' | 'aiDraft';
  capturedAt: string;
  payload: unknown;
};

function fakeSnapshots(initial: Snapshot[] = []) {
  const store: Snapshot[] = [...initial];
  return {
    listForProduct: vi.fn((productId: string) =>
      store.filter((snapshot) => snapshot.productId === productId),
    ),
    append: vi.fn((snapshot: Snapshot) => {
      store.push(snapshot);
    }),
    store,
  };
}

describe('edit draft IPC', () => {
  it('generates a draft, persists it as an aiDraft snapshot, and returns it', async () => {
    const handlers = new Map<string, IpcListener>();
    const snapshots = fakeSnapshots();
    const service = {
      generate: vi.fn().mockResolvedValue(makeDraft(1)),
    };
    registerEditHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      { snapshots, service, netProfit: identityCalculator },
    );

    await expect(
      handlers.get(IPC_CHANNELS.editGenerate)?.({}, { productId: '90001' }),
    ).resolves.toEqual({ ok: true, data: makeDraft(1) });

    expect(service.generate).toHaveBeenCalledWith('90001');
    expect(snapshots.append).toHaveBeenCalledTimes(1);
    expect(snapshots.append).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: '90001',
        kind: 'aiDraft',
        payload: makeDraft(1),
      }),
    );
  });

  it('returns null when no draft exists', async () => {
    const handlers = new Map<string, IpcListener>();
    const snapshots = fakeSnapshots();
    registerEditHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      { snapshots, service: { generate: vi.fn() }, netProfit: identityCalculator },
    );

    await expect(
      handlers.get(IPC_CHANNELS.editDraft)?.({}, { productId: '90001' }),
    ).resolves.toEqual({ ok: true, data: null });
  });

  it('returns the latest aiDraft snapshot when present', async () => {
    const handlers = new Map<string, IpcListener>();
    const draft = makeDraft(1);
    const snapshots = fakeSnapshots([
      {
        id: 'a1',
        productId: '90001',
        kind: 'aiDraft',
        capturedAt: draft.createdAt,
        payload: draft,
      },
      {
        id: 'm1',
        productId: '90001',
        kind: 'miaoshou',
        capturedAt: '2026-08-28T00:00:00.000Z',
        payload: { siteCollectItemInfo: { collectBoxDetailId: '90001' } },
      },
    ]);
    registerEditHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      { snapshots, service: { generate: vi.fn() }, netProfit: identityCalculator },
    );

    await expect(
      handlers.get(IPC_CHANNELS.editDraft)?.({}, { productId: '90001' }),
    ).resolves.toEqual({ ok: true, data: draft });
  });

  it('saves a draft, bumping the version above any previous draft', async () => {
    const handlers = new Map<string, IpcListener>();
    const existing = makeDraft(3);
    const snapshots = fakeSnapshots([
      {
        id: 'a1',
        productId: '90001',
        kind: 'aiDraft',
        capturedAt: existing.createdAt,
        payload: existing,
      },
    ]);
    registerEditHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      { snapshots, service: { generate: vi.fn() }, netProfit: identityCalculator },
    );

    const edited = makeDraft(3);
    edited.title = { value: 'Titulo editado', source: 'user', confidence: 1 };
    const result = await handlers.get(IPC_CHANNELS.editSaveDraft)?.(
      {},
      { productId: '90001', draft: edited },
    );

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({ version: 4, title: edited.title }),
    });
    expect(snapshots.append).toHaveBeenCalledTimes(1);
  });

  it('validates a malformed save payload', async () => {
    const handlers = new Map<string, IpcListener>();
    const snapshots = fakeSnapshots();
    registerEditHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      { snapshots, service: { generate: vi.fn() }, netProfit: identityCalculator },
    );

    await expect(
      handlers.get(IPC_CHANNELS.editSaveDraft)?.({}, { productId: '90001', draft: { bad: true } }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(snapshots.append).not.toHaveBeenCalled();
  });

  it('readLatestDraft normalizes legacy unit fields from drafts saved before units became fixed constants', () => {
    // Drafts saved before the cm/g change stored the units as
    // { value, source, confidence } objects. Reading one must coerce the units
    // to the current string-literal shape so the panel does not crash when it
    // renders a SKU package unit.
    const legacy = makeDraft(1);
    legacy.skus[0].package = {
      ...legacy.skus[0].package,
      dimensionUnit: { value: 'cm', source: 'ai', confidence: 0.99 },
      weightUnit: { value: 'kg', source: 'ai', confidence: 0.99 },
    } as unknown as EditDraft['skus'][number]['package'];
    const snapshots = fakeSnapshots([
      {
        id: 'a1',
        productId: '90001',
        kind: 'aiDraft',
        capturedAt: '2026-08-28T01:00:00.000Z',
        payload: legacy,
      },
    ]);

    const draft = readLatestDraft(snapshots, '90001');
    expect(draft).not.toBeNull();
    expect(draft!.skus[0].package.dimensionUnit).toBe('cm');
    expect(draft!.skus[0].package.weightUnit).toBe('g');
    // Other fields are untouched.
    expect(draft!.skus[0].package.length).toEqual({ value: '20', source: 'ai', confidence: 0.7 });
  });

  it('readLatestDraft fills stock/sourcePrice/package on legacy SKUs that only had a name', () => {
    // Drafts saved before the multi-SKU model stored SKUs as
    // { skuKey, name } only. Reading one must backfill stock/sourcePrice/
    // package so the panel never renders sku.stock.value or
    // sku.package.length.value on undefined.
    const legacy = makeDraft(1);
    legacy.skus = [{ skuKey: ';white;', name: { value: 'Blanco', source: 'ai', confidence: 0.9 } }] as never;
    const snapshots = fakeSnapshots([
      {
        id: 'a1',
        productId: '90001',
        kind: 'aiDraft',
        capturedAt: '2026-08-28T01:00:00.000Z',
        payload: legacy,
      },
    ]);

    const draft = readLatestDraft(snapshots, '90001');
    expect(draft).not.toBeNull();
    expect(draft!.skus[0].stock).toEqual({ value: '', source: 'ai', confidence: 0 });
    expect(draft!.skus[0].sourcePrice).toEqual({ value: '', source: 'ai', confidence: 0 });
    expect(draft!.skus[0].package.length).toEqual({ value: '', source: 'ai', confidence: 0 });
    expect(draft!.skus[0].package.dimensionUnit).toBe('cm');
    expect(draft!.skus[0].package.weightUnit).toBe('g');
  });

  it('readLatestDraft forces the brand to the fixed Generic value', () => {
    // Drafts saved before the brand became a fixed constant carried
    // source 'ai'; reading one must relabel it as 'fixed' so the panel shows
    // 固定值 instead of an AI-generated badge.
    const legacy = makeDraft(1);
    legacy.brand = { value: 'Generic', source: 'ai', confidence: 1 };
    const snapshots = fakeSnapshots([
      {
        id: 'a1',
        productId: '90001',
        kind: 'aiDraft',
        capturedAt: '2026-08-28T01:00:00.000Z',
        payload: legacy,
      },
    ]);

    const draft = readLatestDraft(snapshots, '90001');
    expect(draft).not.toBeNull();
    expect(draft!.brand).toEqual({ value: 'Generic', source: 'fixed', confidence: 1 });
  });

  it('backfills siteNetProfitDetail on read when an old draft lacks it', async () => {
    // Drafts saved before the calc-detail feature carry no siteNetProfitDetail;
    // reading one must recompute so the 计算详情 popup always has data.
    const handlers = new Map<string, IpcListener>();
    const draft = makeDraft(1);
    const snapshots = fakeSnapshots([
      {
        id: 'a1',
        productId: '90001',
        kind: 'aiDraft',
        capturedAt: draft.createdAt,
        payload: draft,
      },
    ]);
    const calc = {
      computeForDraft: vi.fn((value: EditDraft) => ({
        ...value,
        skus: value.skus.map((sku) => ({
          ...sku,
          siteNetProfitDetail: { MX: {} as unknown as NetProfitBreakdown },
        })),
      })),
    };
    registerEditHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      { snapshots, service: { generate: vi.fn() }, netProfit: calc },
    );

    await handlers.get(IPC_CHANNELS.editDraft)?.({}, { productId: '90001' });

    expect(calc.computeForDraft).toHaveBeenCalledTimes(1);
  });

  it('does not recompute on read when the draft already carries detail', async () => {
    const handlers = new Map<string, IpcListener>();
    const draft = makeDraft(1);
    // A draft that already has a breakdown must NOT be recomputed on read —
    // its displayed net profit and detail are already consistent.
    draft.skus[0].siteNetProfitDetail = {
      MX: {} as unknown as NetProfitBreakdown,
    };
    const snapshots = fakeSnapshots([
      {
        id: 'a1',
        productId: '90001',
        kind: 'aiDraft',
        capturedAt: draft.createdAt,
        payload: draft,
      },
    ]);
    const calc = { computeForDraft: vi.fn((value: EditDraft) => value) };
    registerEditHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      { snapshots, service: { generate: vi.fn() }, netProfit: calc },
    );

    const result = await handlers.get(IPC_CHANNELS.editDraft)?.({}, { productId: '90001' });

    expect(calc.computeForDraft).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, data: draft });
  });

  it('readLatestDraft ignores miaoshou snapshots and returns the newest aiDraft', () => {
    const snapshots = fakeSnapshots([
      {
        id: 'm1',
        productId: '90001',
        kind: 'miaoshou',
        capturedAt: '2026-08-28T00:00:00.000Z',
        payload: { siteCollectItemInfo: { collectBoxDetailId: '90001' } },
      },
      {
        id: 'a1',
        productId: '90001',
        kind: 'aiDraft',
        capturedAt: '2026-08-28T01:00:00.000Z',
        payload: makeDraft(1),
      },
      {
        id: 'a2',
        productId: '90001',
        kind: 'aiDraft',
        capturedAt: '2026-08-28T02:00:00.000Z',
        payload: makeDraft(2),
      },
    ]);

    const draft = readLatestDraft(snapshots, '90001');
    expect(draft).not.toBeNull();
    expect(draft!.version).toBe(2);
  });
});
