// AI edit draft domain model.
//
// A draft is the second of two snapshots a product can carry: the `miaoshou`
// snapshot mirrors what Miaoshou has, and the `aiDraft` snapshot mirrors what
// the AI edit produced. They diverge after an AI edit and would converge again
// once the draft is saved back to Miaoshou (a later sub-phase). The draft is
// stored in the shared product_snapshots table under kind `aiDraft`.

// Where a field's current value came from. `fixed` marks values the app sets
// deterministically (e.g. the brand is always Generic, and a missing model
// falls back to Generic) — not remote, not AI.
export type EditFieldSource = 'remote' | 'ai' | 'user' | 'fixed';

// A single draft field. `source` records where the current value came from:
// remote (unchanged from the original), ai (generated), or user (edited after
// generation). `confidence` is the AI's 0-1 confidence for generated values.
export type EditField = {
  value: string;
  source: EditFieldSource;
  confidence: number;
};

// Package dimensions (length × width × height, fixed cm) and billing weight
// (fixed g). Values may come from the AI reading the original Miaoshou data
// and the product images, so they are hints, not ground truth. Units are
// fixed constants, not model-output fields.
export const DIMENSION_UNIT = 'cm';
export const WEIGHT_UNIT = 'g';

export type PackageEditField = {
  length: EditField;
  width: EditField;
  height: EditField;
  dimensionUnit: typeof DIMENSION_UNIT;
  weight: EditField;
  weightUnit: typeof WEIGHT_UNIT;
};

// Each SKU carries its own name, stock, source price, and package dimensions
// + weight. Products are single- or multi-SKU; in both cases the draft holds
// one SkuEditField per SKU so the shape is uniform.
export type SkuSiteAndPriceMap = Record<string, string>;
export type SkuSiteAndListingTypeInfoMap = Record<string, { listingType: string }>;

export type SkuEditField = {
  skuKey: string;
  name: EditField;
  stock: EditField;
  sourcePrice: EditField;
  package: PackageEditField;
  // 新增(对齐妙手 skuMap[key].siteAndPriceMap / siteAndListingTypeInfoMap)。
  // Task 8 会把它们变成必填并在生成/保存时写入。
  siteAndPriceMap?: SkuSiteAndPriceMap;
  siteAndListingTypeInfoMap?: SkuSiteAndListingTypeInfoMap;
};

export type EditDraft = {
  version: number;
  createdAt: string;
  title: EditField;
  description: EditField;
  brand: EditField;
  model: EditField;
  // 新增:发布站点(原始键,如 'MX(Up)')与产品级全球净收益(对齐
  // siteCollectItemInfo.siteAndPriceMap)。
  sites?: string[];
  siteAndPriceMap?: Record<string, string>;
  skus: SkuEditField[];
};

export interface EditDraftRepository {
  readDraft(productId: string): EditDraft | null;
  saveDraft(productId: string, draft: EditDraft): void;
}
