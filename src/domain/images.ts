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
