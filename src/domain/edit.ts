// AI edit draft domain model.
//
// A draft is the second of two snapshots a product can carry: the `miaoshou`
// snapshot mirrors what Miaoshou has, and the `aiDraft` snapshot mirrors what
// the AI edit produced. They diverge after an AI edit and would converge again
// once the draft is saved back to Miaoshou (a later sub-phase). The draft is
// stored in the shared product_snapshots table under kind `aiDraft`.

import type { NetProfitBreakdown } from './net-profit';

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

// 用户手动覆盖某站点的净收益/产品类型(按裸站点码索引,如 'MX')。规则计算在
// 产出后应用这些覆盖:有覆盖的站点用覆盖值,其余沿用计算值。「生成时按规则走,
// 我编辑了按我编辑的」由此实现——编辑只标记覆盖,不直接改计算值。
export type SiteNetProfitOverride = {
  netProfit?: string | null;
  listingType?: string | null;
};

export type SkuEditField = {
  skuKey: string;
  name: EditField;
  stock: EditField;
  sourcePrice: EditField;
  package: PackageEditField;
  // 对齐妙手 skuMap[key].imgUrls:该 SKU 的主图列表与首图。AI 生成的图上传后写回,
  // 妙手原本的图保留在妙手快照中,不在此处。旧草稿可能缺失,故可选。
  imageUrl?: string | null;
  imageUrls?: string[];
  // 对齐妙手 skuMap[key].siteAndPriceMap / siteAndListingTypeInfoMap。由
  // NetProfitCalculator 在生成/保存时写入,始终必填。
  siteAndPriceMap: SkuSiteAndPriceMap;
  siteAndListingTypeInfoMap: SkuSiteAndListingTypeInfoMap;
  // 每个站点的净收益计算明细(按裸站点码索引),供「查看计算详情」浮层展示。
  // 由 NetProfitCalculator 在生成/保存时写入;旧草稿可能缺失,视为无明细。
  siteNetProfitDetail?: Record<string, NetProfitBreakdown>;
  // 用户手动覆盖的净收益/产品类型(按裸站点码索引)。计算器每次重算时优先采用,
  // 其余站点仍按规则计算。旧草稿可能缺失。
  siteNetProfitOverrides?: Record<string, SiteNetProfitOverride>;
};

export type EditDraft = {
  version: number;
  createdAt: string;
  title: EditField;
  description: EditField;
  brand: EditField;
  model: EditField;
  // 发布站点(原始键,如 'MX(Up)'),只有计算器写入时才有意义,保持可选。
  sites?: string[];
  // 产品级全球净收益(对齐 siteCollectItemInfo.siteAndPriceMap),由
  // NetProfitCalculator 写入,始终必填。
  siteAndPriceMap: Record<string, string>;
  // 对齐妙手 product 级 mainImage/images:AI 生成的图上传后写回,作为「产品图片」。
  // 旧草稿可能缺失,故可选。
  mainImage?: string | null;
  images?: string[];
  // 产品级全球净收益覆盖:非空时规则计算用此值(所有站点同一值)。旧草稿可能缺失。
  globalNetProfitOverride?: string | null;
  skus: SkuEditField[];
};

export interface EditDraftRepository {
  readDraft(productId: string): EditDraft | null;
  saveDraft(productId: string, draft: EditDraft): void;
}
