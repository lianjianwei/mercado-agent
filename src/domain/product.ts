export type MiaoshouProductState =
  | 'notPublished'
  | 'timingPublish'
  | 'published'
  | 'missing';

export type RemoteMiaoshouProductState = Exclude<
  MiaoshouProductState,
  'missing'
>;

export type RemoteProductIdentity = {
  id: string;
  state: RemoteMiaoshouProductState;
  title?: string;
  itemNumber?: string;
  thumbnailUrl?: string;
  syncedAt: string;
};

export type Product = {
  id: string;
  state: MiaoshouProductState;
  title: string | null;
  itemNumber: string | null;
  thumbnailUrl: string | null;
  lastSyncedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ProductPageQuery = {
  state?: MiaoshouProductState;
  offset: number;
  limit: number;
};

export type ProductPage = {
  items: Product[];
  offset: number;
  limit: number;
  total: number;
};

export interface ProductRepository {
  upsertRemoteIdentity(product: RemoteProductIdentity): Product;
  transition(id: string, state: MiaoshouProductState, at: string): void;
  page(query: ProductPageQuery): ProductPage;
  getById(id: string): Product;
  delete(id: string): void;
}

export type ProductSnapshotKind =
  | 'miaoshou'
  | 'aiDraft'
  | 'saved'
  | 'published';

export type ProductSnapshot = {
  id: string;
  productId: string;
  kind: ProductSnapshotKind;
  capturedAt: string;
  payload: unknown;
};

export type ProductSnapshotInput = ProductSnapshot;

export interface ProductSnapshotRepository {
  append(snapshot: ProductSnapshotInput): void;
  listForProduct(productId: string): ProductSnapshot[];
}

export interface TransactionRunner {
  transaction<T>(operation: () => T): T;
}

export type ProductSyncFailure = { id: string; message: string };

export type ProductSyncSummary = {
  discovered: number;
  succeeded: number;
  failed: number;
  missing: number;
  failures: ProductSyncFailure[];
};

export type SyncOneResult =
  | { status: 'synced'; product: Product }
  | { status: 'deleted' };
