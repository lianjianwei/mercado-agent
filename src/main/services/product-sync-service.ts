import type {
  MiaoshouGateway,
} from '../gateways/miaoshou/miaoshou-gateway';
import {
  MiaoshouApiError,
  MiaoshouRateLimitError,
  MiaoshouUnavailableError,
} from '../gateways/miaoshou/errors';
import type {
  CollectBoxDetailDto,
  CollectBoxListItemDto,
} from '../../shared/miaoshou-schemas';
import type {
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

export type ProductSyncProgress = (line: string) => void;

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

  async syncDefault(
    signal?: AbortSignal,
    onProgress?: ProductSyncProgress,
  ): Promise<SyncSummary> {
    // A full sync only reconciles the notPublished list: this is the working
    // set the workbench acts on. timingPublish and published are read-only
    // history that the app no longer tracks as sync targets.
    const startedAt = performance.now();
    const summary = this.emptySummary();
    const seen = new Set<string>();
    onProgress?.('开始同步，仅拉取未发布商品…');
    try {
      await this.syncStatus('notPublished', summary, seen, signal, onProgress);
    } catch (error) {
      if (signal?.aborted) throw new ProductSyncCancelledError();
      onProgress?.(`同步中断：${this.safeMessage(error)}`);
    }
    summary.durationMs = Math.max(0, Math.round(performance.now() - startedAt));
    onProgress?.(
      `同步完成：发现 ${summary.discovered}，成功 ${summary.succeeded}，失败 ${summary.failed}，耗时 ${formatDuration(summary.durationMs)}。`,
    );
    return summary;
  }

  async syncOne(productId: string, signal?: AbortSignal): Promise<SyncOneResult> {
    this.throwIfCancelled(signal);
    try {
      const detail = await this.gateway.getCollectBoxDetail(productId, signal);
      this.throwIfCancelled(signal);
      const current = this.products.getById(productId);
      const state = current.state === 'missing' ? 'notPublished' : current.state;
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

  private async syncStatus(
    state: RemoteMiaoshouProductState,
    summary: SyncSummary,
    seen: Set<string>,
    signal?: AbortSignal,
    onProgress?: ProductSyncProgress,
  ): Promise<void> {
    let pageNo = 1;
    while (true) {
      this.throwIfCancelled(signal);
      onProgress?.(`正在请求未发布商品第 ${pageNo} 页…`);
      const page = await this.gateway.listCollectBox(
        { pageNo, pageSize: this.pageSize, filter: { status: state } },
        signal,
      );
      onProgress?.(
        `第 ${pageNo} 页完成：${page.items.length} 条。`,
      );
      for (const item of page.items) {
        if (seen.has(item.collectBoxDetailId)) continue;
        seen.add(item.collectBoxDetailId);
        summary.discovered += 1;
        await this.syncItem(item, state, summary, signal, onProgress);
      }
      if (!page.hasMore) break;
      pageNo += 1;
    }
  }

  private async syncItem(
    item: CollectBoxListItemDto,
    state: RemoteMiaoshouProductState,
    summary: SyncSummary,
    signal?: AbortSignal,
    onProgress?: ProductSyncProgress,
  ): Promise<void> {
    this.throwIfCancelled(signal);
    const label = item.title || item.collectBoxDetailId;
    onProgress?.(`正在同步商品 ${item.collectBoxDetailId}（${label}）…`);
    try {
      const detail = await this.fetchDetailWithRetry(
        item.collectBoxDetailId,
        signal,
        onProgress,
      );
      this.throwIfCancelled(signal);
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
      onProgress?.(`商品 ${item.collectBoxDetailId} 同步成功。`);
    } catch (error) {
      if (signal?.aborted) throw new ProductSyncCancelledError();
      summary.failed += 1;
      summary.failures.push({
        id: item.collectBoxDetailId,
        message: this.safeMessage(error),
      });
      onProgress?.(`商品 ${item.collectBoxDetailId} 同步失败：${this.safeMessage(error)}。`);
    }
  }

  // Transient gateway failures (rate limit, temporary unavailability) are worth
  // one retry; business errors and cancellation pass through. Timeout and
  // network errors during a list page abort the whole sync rather than guessing.
  private async fetchDetailWithRetry(
    detailId: string,
    signal?: AbortSignal,
    onProgress?: ProductSyncProgress,
  ): Promise<CollectBoxDetailDto> {
    try {
      return await this.gateway.getCollectBoxDetail(detailId, signal);
    } catch (error) {
      if (
        error instanceof MiaoshouRateLimitError
        || error instanceof MiaoshouUnavailableError
      ) {
        onProgress?.(`商品 ${detailId} 请求受限/服务不可用，正在重试…`);
        return await this.gateway.getCollectBoxDetail(detailId, signal);
      }
      throw error;
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
    return {
      discovered: 0,
      succeeded: 0,
      failed: 0,
      missing: 0,
      failures: [],
      durationMs: 0,
    };
  }

  private throwIfCancelled(signal?: AbortSignal): void {
    if (signal?.aborted) throw new ProductSyncCancelledError();
  }

  private safeMessage(error: unknown): string {
    return error instanceof Error ? error.message : '同步失败';
  }
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder > 0 ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分`;
}
