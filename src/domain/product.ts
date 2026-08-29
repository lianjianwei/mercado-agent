export type MiaoshouProductState =
  | 'notPublished'
  | 'timingPublish'
  | 'published'
  | 'missing';

export type RemoteMiaoshouProductState = Exclude<
  MiaoshouProductState,
  'missing'
>;

// A local marker the app owns: this app submitted a publish for the product
// through the Miaoshou endpoint. It is independent of the remote lifecycle
// (state) and is only ever set by the local publish flow.
export type LocalPublishState =
  | 'notPublished'
  | 'localPublished'
  | 'localFailed';

export type RemoteProductIdentity = {
  id: string;
  state: RemoteMiaoshouProductState;
  title?: string;
  itemNumber?: string;
  thumbnailUrl?: string;
  category?: string | null;
  netProfit?: string | null;
  stock?: string | null;
  sites?: string[] | null;
  sourcePrice?: string | null;
  syncedAt: string;
};

export type Product = {
  id: string;
  state: MiaoshouProductState;
  title: string | null;
  itemNumber: string | null;
  thumbnailUrl: string | null;
  category: string | null;
  netProfit: string | null;
  stock: string | null;
  sites: string[];
  sourcePrice: string | null;
  localPublishState: LocalPublishState;
  localPublishedAt: string | null;
  lastSyncedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ProductPageQuery = {
  state?: MiaoshouProductState;
  localPublishState?: LocalPublishState;
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
  setLocalPublishState(
    id: string,
    state: LocalPublishState,
    at: string | null,
  ): void;
  page(query: ProductPageQuery): ProductPage;
  getById(id: string): Product;
  delete(id: string): void;
  clearAll(): void;
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
  durationMs: number;
};

export type SyncOneResult =
  | { status: 'synced'; product: Product }
  | { status: 'deleted' };

export type ProductDetailSku = {
  skuKey: string;
  name: string | null;
  imageUrl: string | null;
  stock: string | null;
  sourcePrice: string | null;
  netProfit: string | null;
  // Package dimensions and weight come from the Miaoshou skuMap. They may be
  // empty or wrong on the source, so the AI edit flow treats them as hints
  // rather than ground truth when estimating package size and billing weight.
  length: string | null;
  width: string | null;
  height: string | null;
  dimensionUnit: string | null;
  weight: string | null;
  weightUnit: string | null;
  // 站点净收益/产品类型(对齐 skuMap[key].siteAndPriceMap /
  // siteAndListingTypeInfoMap),与妙手/AI 草稿结构一致,供站点净收益表展示。
  siteAndPriceMap: Record<string, string>;
  siteAndListingTypeInfoMap: Record<string, { listingType: string }>;
  // 该 SKU 的完整主图列表(妙手 skuMap[key].imgUrls);imageUrl 为 imageUrls[0]。
  imageUrls: string[];
};

export type ProductDetail = {
  productId: string;
  title: string | null;
  description: string | null;
  itemNumber: string | null;
  category: string | null;
  sites: string[];
  stock: string | null;
  netProfit: string | null;
  sourcePrice: string | null;
  mainImage: string | null;
  images: string[];
  skuList: ProductDetailSku[];
  // Brand and model come from the detail attributes; they are the counterpart
  // the AI edit draft generates (brand fixed to Generic, model inferred).
  brand: string | null;
  model: string | null;
  // 产品级全球净收益(对齐 siteCollectItemInfo.siteAndPriceMap)。妙手原本的值,
  // 可能为空;AI 草稿则始终用计算器写入的值。
  siteAndPriceMap: Record<string, string>;
};
