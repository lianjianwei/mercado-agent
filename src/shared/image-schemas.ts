import { z } from 'zod';

export const imagePlanKindSchema = z.enum(['尺寸图', '功能图', '场景图', '包装清单', '安装步骤', '使用流程图', '收纳尺寸对比']);

// 模型输出的规划不保证有 id,也不保证没有额外 key。
// 用 z.object(剥离未知 key)+ id 可选,避免「模型按提示省略 id 就解析失败」。
// id 由 ImagePlanner 在解析后补齐(见 image-planner.ts)。
export const detailPlanItemSchema = z.object({
  id: z.string().optional(),
  kind: imagePlanKindSchema,
  subject: z.string(),
  textEs: z.string(),
  textPt: z.string(),
  hasPerson: z.boolean(),
  referenceNote: z.string(),
});

export const detailPlanSchema = z.object({ plans: z.array(detailPlanItemSchema) });
export type DetailPlan = z.infer<typeof detailPlanSchema>;

export const imageReviewSchema = z.strictObject({
  ok: z.boolean(),
  issues: z.array(z.string()),
});
export type ImageReview = z.infer<typeof imageReviewSchema>;

export const generatedImageSchema = z.strictObject({
  imageId: z.string().min(1),
  kind: z.enum(['main', 'detail']),
  skuKey: z.string().optional(),
  detail: z.strictObject({ slug: z.string(), title: z.string(), hasPerson: z.boolean() }).optional(),
  localPath: z.string(),
  plannedPath: z.string(),
  sourceRefImages: z.array(z.string()),
  prompt: z.string(),
  attempts: z.number().int().min(1),
  review: imageReviewSchema.optional(),
  status: z.enum(['ok', 'retried', 'failed']),
  createdAt: z.string(),
});

export const aiImagesSnapshotSchema = z.strictObject({
  version: z.number().int().positive(),
  productId: z.string().min(1),
  mainImages: z.array(generatedImageSchema),
  detailImages: z.array(generatedImageSchema),
  plan: z.array(detailPlanItemSchema),
  status: z.enum(['done', 'partial', 'failed']),
  createdAt: z.string(),
});
export type AiImagesSnapshot = z.infer<typeof aiImagesSnapshotSchema>;
