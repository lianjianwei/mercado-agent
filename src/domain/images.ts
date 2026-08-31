export type ImagePlanKind =
  | '尺寸图' | '功能图' | '场景图' | '包装清单' | '安装步骤' | '使用流程图' | '收纳尺寸对比';

export type DetailPlanItem = {
  id: string;
  kind: ImagePlanKind;
  subject: string;
  textEs: string;
  textPt: string;
  hasPerson: boolean;
  referenceNote: string;
};

export type ImageReview = { ok: boolean; issues: string[] };

export type GeneratedImage = {
  imageId: string;
  kind: 'main' | 'detail';
  skuKey?: string;
  detail?: { slug: string; title: string; hasPerson: boolean };
  localPath: string;
  plannedPath: string;
  // 上传七牛后的公网 URL;未上传(缺失凭证/失败)时为空。
  publicUrl?: string;
  sourceRefImages: string[];
  prompt: string;
  attempts: number;
  review?: ImageReview;
  status: 'ok' | 'retried' | 'failed';
  createdAt: string;
};

export type AiImagesResult = {
  version: number;
  productId: string;
  mainImages: GeneratedImage[];
  detailImages: GeneratedImage[];
  plan: DetailPlanItem[];
  status: 'done' | 'partial' | 'failed';
  createdAt: string;
};

// 重生成选中图片的请求:imageId 是生成的图标识(如 main-1-202608311030),hint 是
// 用户给该图追加的改进方向,会接到该图提示词后面。
export type ImageRegenerateTarget = {
  imageId: string;
  hint?: string;
};
