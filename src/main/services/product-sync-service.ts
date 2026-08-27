import type {
  MiaoshouGateway,
} from '../gateways/miaoshou/miaoshou-gateway';
import type { CollectBoxListItemDto } from '../../shared/miaoshou-schemas';
import type {
  ProductRepository,
  ProductSnapshotRepository,
  RemoteMiaoshouProductState,
  TransactionRunner,
  ProductSyncFailure,
  ProductSyncSummary,
} from '../../domain/product';

export type SyncFailure = ProductSyncFailure;
export type SyncSummary = ProductSyncSummary;

export type ProductSyncServiceOptions = {
  now?: () => string;
  pageSize?: number;
};

const DEFAULT_PAGE_SIZE = 100;

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
    return this.syncStatus('notPublished', signal);
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
    signal?: AbortSignal,
  ): Promise<SyncSummary> {
    const summary = this.emptySummary();
    const seen = new Set<string>();
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
    return summary;
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
      transactionRunner.transaction(() => {
        this.products.upsertRemoteIdentity({
          id: item.collectBoxDetailId,
          state,
          title: item.title,
          itemNumber: item.itemNum,
          thumbnailUrl: item.thumbnail,
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
