import { z } from 'zod';
import type { NetProfitBreakdown } from '../domain/net-profit';

// Structured output schema for the AI edit generation prompt.
//
// The model returns one object with the edited fields and a per-field
// confidence. Values that should stay unchanged are returned verbatim with
// low confidence. The strict schemas reject any unexpected or malformed shape
// so a bad model response never overwrites an existing draft.

const generatedFieldSchema = z.strictObject({
  value: z.string().trim(),
  confidence: z.number().min(0).max(1),
});

export const generatedTitleSchema = generatedFieldSchema.extend({
  value: z.string().trim().min(1).max(60),
});

// Package dimensions + weight are estimated per SKU, so the model outputs
// them inside each sku entry. Units are fixed (cm/g); the model returns bare
// numbers only.
const aiSkuPackageSchema = z.strictObject({
  length: generatedFieldSchema,
  width: generatedFieldSchema,
  height: generatedFieldSchema,
  weight: generatedFieldSchema,
});

export const aiSkuEditSchema = z.strictObject({
  skuKey: z.string().min(1),
  name: generatedFieldSchema,
  package: aiSkuPackageSchema,
});

export const aiEditOutputSchema = z.strictObject({
  title: generatedTitleSchema,
  description: generatedFieldSchema,
  model: generatedFieldSchema,
  skus: z.array(aiSkuEditSchema),
});

export type AiEditOutput = z.infer<typeof aiEditOutputSchema>;

// Runtime validation for a full EditDraft as exchanged over IPC. The AI
// output schema above covers the model response only; a draft also carries a
// per-field source ('remote' | 'ai' | 'user') and an overall version.
const draftFieldSchema = z.strictObject({
  value: z.string(),
  source: z.enum(['remote', 'ai', 'user', 'fixed']),
  confidence: z.number().min(0).max(1),
});

export const editDraftSchema = z.strictObject({
  version: z.number().int().positive(),
  createdAt: z.string(),
  title: draftFieldSchema,
  description: draftFieldSchema,
  brand: draftFieldSchema,
  model: draftFieldSchema,
  // 发布站点(原始键,如 'MX(Up)')与产品级全球净收益(对齐妙手顶层 siteAndPriceMap)。
  sites: z.array(z.string()).default([]),
  siteAndPriceMap: z.record(z.string(), z.string()).default({}),
  // 产品图片(镜像妙手 product 级):旧草稿可能缺失,默认空。
  mainImage: z.string().nullish().default(null),
  images: z.array(z.string()).default([]),
  skus: z.array(
    z.strictObject({
      skuKey: z.string().min(1),
      name: draftFieldSchema,
      stock: draftFieldSchema,
      sourcePrice: draftFieldSchema,
      package: z.strictObject({
        length: draftFieldSchema,
        width: draftFieldSchema,
        height: draftFieldSchema,
        dimensionUnit: z.literal('cm'),
        weight: draftFieldSchema,
        weightUnit: z.literal('g'),
      }),
      // 该 SKU 的主图列表与首图(镜像妙手 skuMap[key].imgUrls);旧草稿默认空。
      imageUrl: z.string().nullish().default(null),
      imageUrls: z.array(z.string()).default([]),
      // 对齐妙手 skuMap[key].siteAndPriceMap / siteAndListingTypeInfoMap。
      siteAndPriceMap: z.record(z.string(), z.string()).default({}),
      siteAndListingTypeInfoMap: z
        .record(z.string(), z.strictObject({ listingType: z.string() }))
        .default({}),
      // 每个站点的净收益计算明细(按裸站点码索引)。由计算器写入;旧草稿可能缺失,
      // 故可选。此值仅用于展示且始终由本机引擎产出,故只校验是对象,不逐字段严格校验。
      siteNetProfitDetail: z
        .record(
          z.string(),
          z.custom<NetProfitBreakdown>((value) => typeof value === 'object' && value !== null),
        )
        .optional(),
      // 用户手动覆盖的净收益/产品类型(按裸站点码索引)。旧草稿可能缺失,默认空表;
      // 若缺省,规则计算不覆盖任何站点。
      siteNetProfitOverrides: z
        .record(
          z.string(),
          z.strictObject({
            netProfit: z.string().nullish(),
            listingType: z.string().nullish(),
          }),
        )
        .optional(),
    }),
  ),
  // 产品级全球净收益覆盖:非空时规则计算用此值。旧草稿可能缺失,默认 null。
  globalNetProfitOverride: z.string().nullish().default(null),
});
