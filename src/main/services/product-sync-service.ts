import type {
  MiaoshouGateway,
} from '../gateways/miaoshou/miaoshou-gateway';
import { MiaoshouApiError } from '../gateways/miaoshou/errors';
import type {
  CollectBoxDetailDto,
  CollectBoxListItemDto,
} from '../../shared/miaoshou-schemas';
import type {
  MiaoshouProductState,
  ProductRepository,
  ProductSnapshotRepository,
  RemoteMiaoshouProductState,
  TransactionRunner,
  ProductSyncFailure,
  ProductSyncSummary,
  SyncOneResult,
} from '../../domain/product';

export type SyncFailure = ProductSyncFailure;
export type SyncSummary = ProductSyncSummary;

export type ProductSyncServiceOptions = {
  now?: () => string;
  pageSize?: number;
};

const DEFAULT_PAGE_SIZE = 20;

type ListColumnFallback = {
  category: string | null;
  stock: string | null;
  sites: string[] | null;
  sourcePrice: string | null;
};

// Detail responses carry list-only columns that a list response may omit:
// the category breadcrumb, the first SKU's stock and source price, and the
// publish sites. Extract them so the workbench always has values even when
// the list API leaves the fields empty. Site codes arrive as "BR(Up)" and are
// stripped to the bare "BR" the list API (and the UI) uses.
function listColumnsFromDetail(detail: CollectBoxDetailDto): ListColumnFallback {
  const info = detail.siteCollectItemInfo;
  const cateList = Array.isArray(info.cateList)
    ? info.cateList.filter((segment): segment is string => typeof segment === 'string')
    : [];
  const category = cateList.length > 0 ? cateList.join(' / ') : null;

  const skuMap = info.skuMap ?? {};
  const preferred = info.firstSkuKey ? skuMap[info.firstSkuKey] : undefined;
  const firstSku = preferred ?? Object.values(skuMap)[0] as
    | { stock?: unknown; originPrice?: unknown }
    | undefined;
  const stock =
    firstSku?.stock === undefined || firstSku?.stock === null
      ? null
      : String(firstSku.stock);
  const sourcePrice =
    firstSku?.originPrice === undefined || firstSku?.originPrice === null
      ? null
      : String(firstSku.originPrice);

  const sites = Array.isArray(info.sites) && info.sites.length > 0
    ? info.sites.map((site) => site.replace(/\s*\([^)]*\)$/, ''))
    : null;

  return { category, stock, sites, sourcePrice };
}

export class ProductSyncCancelledError extends Error {
  constructor() {
    super('同步已取消');
    this.name = 'ProductSyncCancelledError';
  }
}

export class ProductSyncService {
  private readonly now: () => string;
  private readonly pageSize: number;

  constructor(
    private readonly gateway: MiaoshouGateway,
    private readonly products: ProductRepository,
    private readonly snapshots: ProductSnapshotRepository,
    options: ProductSyncServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  }

  async syncDefault(signal?: AbortSignal): Promise<SyncSummary> {
    // Query every lifecycle state so a product that was published (or timed)
    // on Miaoshou since the last sync is picked up with its real state instead
    // of staying stuck in notPublished.
    const summary = this.emptySummary();
    const seen = new Set<string>();
    for (const state of ['notPublished', 'timingPublish', 'published'] as const) {
      await this.syncStatus(state, summary, seen, signal);
    }
    return summary;
  }

  async syncOne(productId: string, signal?: AbortSignal): Promise<SyncOneResult> {
    this.throwIfCancelled(signal);
    try {
      const detail = await this.gateway.getCollectBoxDetail(productId, signal);
      this.throwIfCancelled(signal);
      const current = this.products.getById(productId);
      const state = await this.locateState(productId, current.state, signal);
      const syncedAt = this.now();
      const transactionRunner = this.products as ProductRepository & TransactionRunner;
      const fallback = listColumnsFromDetail(detail);
      const updated = transactionRunner.transaction(() => {
        const product = this.products.upsertRemoteIdentity({
          id: productId,
          state,
          title: detail.siteCollectItemInfo.title ?? undefined,
          itemNumber: detail.siteCollectItemInfo.itemNum ?? undefined,
          thumbnailUrl: this.thumbnailOf(detail),
          // A detail response has no list fields; extract them from the detail
          // and fall back to the repository COALESCE to keep existing values.
          category: fallback.category,
          netProfit: null,
          stock: fallback.stock,
          sites: fallback.sites,
          sourcePrice: fallback.sourcePrice,
          syncedAt,
        });
        this.snapshots.append({
          id: `${productId}:${syncedAt}`,
          productId,
          kind: 'miaoshou',
          capturedAt: syncedAt,
          payload: detail,
        });
        return product;
      });
      return { status: 'synced', product: updated };
    } catch (error) {
      if (error instanceof MiaoshouApiError) {
        // The detail endpoint answered with a business error for this id;
        // treat it as the product no longer existing in Miaoshou.
        const transactionRunner = this.products as ProductRepository & TransactionRunner;
        transactionRunner.transaction(() => {
          this.products.delete(productId);
        });
        return { status: 'deleted' };
      }
      throw error;
    }
  }

  async reconcileTracked(
    productIds: string[],
    signal?: AbortSignal,
  ): Promise<SyncSummary> {
    const tracked = new Set(productIds);
    const summary = this.emptySummary();
    const found = new Set<string>();

    for (const state of ['timingPublish', 'published'] as const) {
      let pageNo = 1;
      while (true) {
        this.throwIfCancelled(signal);
        const page = await this.gateway.listCollectBox(
          { pageNo, pageSize: this.pageSize, filter: { status: state } },
          signal,
        );
        for (const item of page.items) {
          if (!tracked.has(item.collectBoxDetailId) || found.has(item.collectBoxDetailId)) continue;
          found.add(item.collectBoxDetailId);
          summary.discovered += 1;
          await this.syncItem(item, state, summary, signal);
        }
        if (!page.hasMore) break;
        pageNo += 1;
      }
    }

    for (const id of tracked) {
      if (found.has(id)) continue;
      this.throwIfCancelled(signal);
      try {
        this.products.transition(id, 'missing', this.now());
        summary.missing += 1;
      } catch (error) {
        summary.failures.push({ id, message: this.safeMessage(error) });
        summary.failed += 1;
      }
    }
    return summary;
  }

  private async syncStatus(
    state: RemoteMiaoshouProductState,
    summary: SyncSummary,
    seen: Set<string>,
    signal?: AbortSignal,
  ): Promise<void> {
    let pageNo = 1;
    while (true) {
      this.throwIfCancelled(signal);
      const page = await this.gateway.listCollectBox(
        { pageNo, pageSize: this.pageSize, filter: { status: state } },
        signal,
      );
      for (const item of page.items) {
        if (seen.has(item.collectBoxDetailId)) continue;
        seen.add(item.collectBoxDetailId);
        summary.discovered += 1;
        await this.syncItem(item, state, summary, signal);
      }
      if (!page.hasMore) break;
      pageNo += 1;
    }
  }

  // The detail API does not report lifecycle state, so a single-product sync
  // confirms the real state by checking which lifecycle list contains the id.
  // List queries may fail (network, rate limit): treat them as inconclusive and
  // keep the current state rather than guessing.
  private async locateState(
    productId: string,
    current: MiaoshouProductState,
    signal?: AbortSignal,
  ): Promise<RemoteMiaoshouProductState> {
    if (current === 'missing') return 'notPublished';
    try {
      for (const state of ['published', 'timingPublish'] as const) {
        const page = await this.gateway.listCollectBox(
          { pageNo: 1, pageSize: this.pageSize, filter: { status: state } },
          signal,
        );
        if (page.items.some((item) => item.collectBoxDetailId === productId)) {
          return state;
        }
      }
    } catch {
      if (signal?.aborted) throw new ProductSyncCancelledError();
      // Inconclusive; keep whatever the current state was.
    }
    return current;
  }

  private async syncItem(
    item: CollectBoxListItemDto,
    state: RemoteMiaoshouProductState,
    summary: SyncSummary,
    signal?: AbortSignal,
  ): Promise<void> {
    this.throwIfCancelled(signal);
    try {
      const detail = await this.gateway.getCollectBoxDetail(item.collectBoxDetailId, signal);
      const syncedAt = this.now();
      const transactionRunner = this.products as ProductRepository & TransactionRunner;
      const fallback = listColumnsFromDetail(detail);
      transactionRunner.transaction(() => {
        this.products.upsertRemoteIdentity({
          id: item.collectBoxDetailId,
          state,
          title: item.title,
          itemNumber: item.itemNum,
          thumbnailUrl: item.thumbnail,
          category: item.breadcrumb ?? fallback.category,
          netProfit: item.globalPrice === undefined ? null : String(item.globalPrice),
          stock: item.stock === undefined ? fallback.stock : String(item.stock),
          sites: item.sites.length > 0 ? item.sites : fallback.sites,
          sourcePrice: item.price === undefined ? fallback.sourcePrice : String(item.price),
          syncedAt,
        });
        this.snapshots.append({
          id: `${item.collectBoxDetailId}:${syncedAt}`,
          productId: item.collectBoxDetailId,
          kind: 'miaoshou',
          capturedAt: syncedAt,
          payload: detail,
        });
      });
      summary.succeeded += 1;
    } catch (error) {
      if (signal?.aborted) throw new ProductSyncCancelledError();
      summary.failed += 1;
      summary.failures.push({
        id: item.collectBoxDetailId,
        message: this.safeMessage(error),
      });
    }
  }

  private thumbnailOf(detail: CollectBoxDetailDto): string | undefined {
    const info = detail.siteCollectItemInfo;
    for (const sku of Object.values(info.skuMap ?? {})) {
      if (!Array.isArray(sku?.imgUrls)) continue;
      for (const url of sku.imgUrls) {
        if (typeof url === 'string' && /^https:\/\//i.test(url)) return url;
      }
    }
    return undefined;
  }

  private emptySummary(): SyncSummary {
    return { discovered: 0, succeeded: 0, failed: 0, missing: 0, failures: [] };
  }

  private throwIfCancelled(signal?: AbortSignal): void {
    if (signal?.aborted) throw new ProductSyncCancelledError();
  }

  private safeMessage(error: unknown): string {
    return error instanceof Error ? error.message : '同步失败';
  }
}
