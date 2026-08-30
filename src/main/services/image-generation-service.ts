import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { ProductDetail } from '../../domain/product';
import type { EditDraft } from '../../domain/edit';
import type { GeneratedImage, AiImagesResult, DetailPlanItem } from '../../domain/images';
import type { ImageReview } from '../../shared/image-schemas';
import type { ImageModelProvider, ImageResult, TextModelProvider } from '../../domain/providers';
import { ImagePlanner, DETAIL_LANGUAGE_LABEL, resolveDetailImageLanguage, type DetailImageLanguage } from './image-planner';
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

export function buildDetailImagePrompt(item: DetailPlanItem, title: string, language: DetailImageLanguage = 'es'): string {
  const label = DETAIL_LANGUAGE_LABEL[language];
  const text = (language === 'pt' ? item.textPt : item.textEs) || '';
  const languageInstruction = text
    ? `图上文字只使用${label}：「${text}」`
    : `图上文字只使用${label}。`;
  return `依据参考图制作详情图「${item.kind}」。主题：${item.subject}。${languageInstruction}。
${item.hasPerson ? '人物使用拉美裔模特。' : '不要出现人物。'}
以参考图为准，真实呈现产品，不虚构参考图中没有的内容，保持产品外观/配色/结构一致。产品「${title}」。`;
}

// 图片文件名规则:主图按 SKU 序号命名(main-{序号}.png),详情图按序号命名
// (detail-1.png … detail-4.png,详情图所有 SKU 共用,不带 SKU 信息)。
// index 从 1 开始。
export function imageFileName(kind: 'main' | 'detail', index: number): string {
  return `${kind}-${index}`;
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

    // 详情图文字语言由商品发布的站点决定(站点含 MX/AR→西语;只有 BR→葡语)。
    const language = resolveDetailImageLanguage(detail.sites ?? draft?.sites ?? []);
    this.onProgress(`详情图文字语言：${DETAIL_LANGUAGE_LABEL[language]}`);
    const sku0Refs = skus[0]?.imageUrls ?? [];
    const planStartedAt = Date.now();
    this.onProgress(`正在规划详情图…`);
    const plan = await planner.plan({ title, description, category: detail.category ?? '', referenceImageUrls: sku0Refs, language });
    this.onProgress(`详情图规划完成（耗时 ${((Date.now() - planStartedAt) / 1000).toFixed(1)}s）。`);

    const mainImages: GeneratedImage[] = [];
    const mainSkus = skus.filter((sku) => sku.imageUrls.length > 0);
    let mainCount = 0;
    for (const [skuIndex, sku] of skus.entries()) {
      const ref = sku.imageUrls[0];
      if (!ref) continue;
      mainCount += 1;
      // SKU 序号取该 SKU 在商品 SKU 列表里的位置,和编辑详情里「SKU 1/2/3」对齐。
      this.onProgress(`正在生成 SKU ${skuIndex + 1} 主图（第 ${mainCount}/${mainSkus.length} 张）…`);
      const startedAt = Date.now();
      const image = await this.generateOne({ provider, reviser, prompt: buildMainImagePrompt({ title, description, category: detail.category ?? '' }), refs: [ref], kind: 'main', skuKey: sku.skuKey, detail: undefined, productId, title, description, name: imageFileName('main', skuIndex + 1) });
      this.onProgress(`主图 ${mainCount}：${image.status === 'ok' ? '生成成功' : image.status === 'retried' ? '重试后成功' : '生成失败'}（耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s）。`);
      mainImages.push(image);
    }

    const detailImages: GeneratedImage[] = [];
    for (let index = 0; index < plan.length; index += 1) {
      const item = plan[index];
      this.onProgress(`正在生成详情图 ${index + 1}/${plan.length}（${item.kind}）…`);
      const startedAt = Date.now();
      const image = await this.generateOne({ provider, reviser, prompt: buildDetailImagePrompt(item, title, language), refs: sku0Refs, kind: 'detail', skuKey: undefined, detail: { slug: item.id, title: item.subject, hasPerson: item.hasPerson }, productId, title, description, name: imageFileName('detail', index + 1) });
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
    // 可读的文件名(不含扩展名):主图 main-{sku},详情图 detail-{N}。
    name: string;
  }): Promise<GeneratedImage> {
    const imageId = args.name;
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
