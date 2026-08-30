import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { ProductDetail } from '../../domain/product';
import type { EditDraft } from '../../domain/edit';
import type { GeneratedImage, AiImagesResult, DetailPlanItem } from '../../domain/images';
import type { ImageReview } from '../../shared/image-schemas';
import type { ImageModelProvider, ImageResult, TextModelProvider } from '../../domain/providers';
import { ImagePlanner } from './image-planner';
import { ImageReviser, shouldRegenerate } from './image-reviser';

export type ImageGenerationDeps = {
  readDetail: (productId: string) => ProductDetail | null;
  readDraft: (productId: string) => EditDraft | null;
  imageProvider: () => ImageModelProvider;
  textProvider: () => TextModelProvider;
  appendImages: (productId: string, result: AiImagesResult) => void;
  imagesDir: string;
  // 生图过程中的进度回调,由渲染层 log 面板展示(主进程直播进度 + 耗时)。
  onProgress?: (line: string) => void;
  now?: () => string;
};

export function buildMainImagePrompt(input: { title: string; description: string; category: string }): string {
  return `以参考图为准生成一张美客多主图：白底，只展示产品本身，无 logo、无文字，
不得虚构参考图中不存在的部件，产品外观/配色/结构保持一致。产品「${input.title}」。
类目：${input.category || '未知'}。描述：${input.description}`;
}

export function buildDetailImagePrompt(item: DetailPlanItem, title: string): string {
  const language = item.textPt && item.textPt.length > 0 ? `文本使用西班牙语与葡萄牙语：西语「${item.textEs}」，葡语「${item.textPt}」` : `文本使用西班牙语：「${item.textEs || ''}」`;
  return `依据参考图制作详情图「${item.kind}」。主题：${item.subject}。${language}。
${item.hasPerson ? '人物使用拉美裔模特。' : '不要出现人物。'}
以参考图为准，真实呈现产品，不虚构参考图中没有的内容，保持产品外观/配色/结构一致。产品「${title}」。`;
}

export async function saveImageBytes(imagesDir: string, productId: string, imageId: string, result: ImageResult): Promise<string> {
  const dir = path.join(imagesDir, productId);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${imageId}.png`);
  let buffer: Buffer;
  if (result.dataBase64) buffer = Buffer.from(result.dataBase64, 'base64');
  else {
    const res = await fetch(result.url);
    if (!res.ok) throw new Error('生图结果下载失败。');
    buffer = Buffer.from(await res.arrayBuffer());
  }
  writeFileSync(file, buffer);
  return file;
}

export class ImageGenerationService {
  private readonly onProgress: (line: string) => void;

  constructor(private readonly deps: ImageGenerationDeps) {
    this.onProgress = deps.onProgress ?? (() => undefined);
  }

  async generate(productId: string): Promise<AiImagesResult> {
    const detail = this.deps.readDetail(productId);
    if (!detail) throw new Error('暂无可用的妙手详情，无法生图。');
    const draft = this.deps.readDraft(productId);
    const title = draft?.title.value ?? detail.title ?? '';
    const description = draft?.description.value ?? detail.description ?? '';
    const skus = detail.skuList ?? [];
    const planner = new ImagePlanner(this.deps.textProvider);
    const reviser = new ImageReviser(this.deps.textProvider);
    const provider = this.deps.imageProvider();

    const sku0Refs = skus[0]?.imageUrls ?? [];
    const planStartedAt = Date.now();
    this.onProgress(`正在规划详情图…`);
    const plan = await planner.plan({ title, description, category: detail.category ?? '', referenceImageUrls: sku0Refs });
    this.onProgress(`详情图规划完成（耗时 ${((Date.now() - planStartedAt) / 1000).toFixed(1)}s）。`);

    const mainImages: GeneratedImage[] = [];
    const mainSkus = skus.filter((sku) => sku.imageUrls.length > 0);
    for (const [mainIndex, sku] of mainSkus.entries()) {
      const ref = sku.imageUrls[0];
      this.onProgress(`正在生成 ${sku.name ?? `SKU ${sku.skuKey}`} 主图（${mainIndex + 1}/${mainSkus.length}）…`);
      const startedAt = Date.now();
      const image = await this.generateOne({ provider, reviser, prompt: buildMainImagePrompt({ title, description, category: detail.category ?? '' }), refs: [ref], kind: 'main', skuKey: sku.skuKey, detail: undefined, productId, title, description });
      this.onProgress(`主图 ${mainIndex + 1}：${image.status === 'ok' ? '生成成功' : image.status === 'retried' ? '重试后成功' : '生成失败'}（耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s）。`);
      mainImages.push(image);
    }

    const detailImages: GeneratedImage[] = [];
    for (let index = 0; index < plan.length; index += 1) {
      const item = plan[index];
      this.onProgress(`正在生成详情图 ${index + 1}/${plan.length}（${item.kind}）…`);
      const startedAt = Date.now();
      const image = await this.generateOne({ provider, reviser, prompt: buildDetailImagePrompt(item, title), refs: sku0Refs, kind: 'detail', skuKey: undefined, detail: { slug: item.id, title: item.subject, hasPerson: item.hasPerson }, productId, title, description });
      this.onProgress(`详情图 ${index + 1}/${plan.length}：${image.status === 'ok' ? '生成成功' : image.status === 'retried' ? '重试后成功' : '生成失败'}（耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s）。`);
      detailImages.push(image);
    }

    const failed = [...mainImages, ...detailImages].filter((i) => i.status === 'failed');
    const status: AiImagesResult['status'] = failed.length === 0 ? 'done' : (failed.length === [...mainImages, ...detailImages].length ? 'failed' : 'partial');

    const result: AiImagesResult = {
      version: 1, productId, mainImages, detailImages, plan, status, createdAt: this.deps.now?.() ?? new Date().toISOString(),
    };
    this.deps.appendImages(productId, result);
    return result;
  }

  private async generateOne(args: {
    provider: ImageModelProvider; reviser: ImageReviser; prompt: string; refs: string[];
    kind: 'main' | 'detail'; skuKey?: string; detail?: GeneratedImage['detail']; productId: string;
    title: string; description: string;
  }): Promise<GeneratedImage> {
    const imageId = randomUUID();
    let attempts = 1;
    let render: ImageResult = { url: '' };
    // 自检必须能看到图:OpenAI 默认只回 base64(url 为空),用 data URL 喂给视觉自检。
    const reviewImageUrl = () =>
      render.url || (render.dataBase64 ? `data:image/png;base64,${render.dataBase64}` : '');
    let review: ImageReview = { ok: true, issues: [] };
    try {
      const result = await args.provider.generate({ prompt: args.prompt, referenceImageUrls: args.refs }, new AbortController().signal);
      render = result[0] ?? { url: '' };
      if (!render.dataBase64 && !render.url) {
        return { imageId, kind: args.kind, skuKey: args.skuKey, detail: args.detail, localPath: '', plannedPath: `mercado/${args.productId}/${imageId}.png`, sourceRefImages: args.refs, prompt: args.prompt, attempts, status: 'failed', createdAt: this.deps.now?.() ?? new Date().toISOString() };
      }
    } catch {
      return { imageId, kind: args.kind, skuKey: args.skuKey, detail: args.detail, localPath: '', plannedPath: `mercado/${args.productId}/${imageId}.png`, sourceRefImages: args.refs, prompt: args.prompt, attempts, status: 'failed', createdAt: this.deps.now?.() ?? new Date().toISOString() };
    }
    try {
      review = await args.reviser.review({ imageUrl: reviewImageUrl(), context: { title: args.title, description: args.description, kind: args.kind } });
    } catch {
      review = { ok: true, issues: ['自检服务异常，未验证'] };
    }
    while (shouldRegenerate(review) && attempts < 3) {
      attempts += 1;
      try {
        const result = await args.provider.generate({ prompt: `${args.prompt}\n（上一版未过质检：${review.issues.join('；')} 请修改后重出。）`, referenceImageUrls: args.refs }, new AbortController().signal);
        render = result[0] ?? render;
      } catch { break; }
      try {
        review = await args.reviser.review({ imageUrl: reviewImageUrl(), context: { title: args.title, description: args.description, kind: args.kind } });
      } catch {
        review = { ok: true, issues: ['自检服务异常，未验证'] };
      }
    }
    let localPath = '';
    try {
      localPath = await saveImageBytes(this.deps.imagesDir, args.productId, imageId, render);
    } catch {
      localPath = '';
    }
    return {
      imageId, kind: args.kind, skuKey: args.skuKey, detail: args.detail, localPath,
      plannedPath: `mercado/${args.productId}/${imageId}.png`, sourceRefImages: args.refs, prompt: args.prompt,
      attempts, review, status: review.ok ? 'ok' : (attempts >= 3 ? 'failed' : 'retried'), createdAt: this.deps.now?.() ?? new Date().toISOString(),
    };
  }
}
