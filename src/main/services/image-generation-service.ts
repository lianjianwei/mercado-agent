import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { ProductDetail } from '../../domain/product';
import type { EditDraft } from '../../domain/edit';
import type { GeneratedImage, AiImagesResult, DetailPlanItem } from '../../domain/images';
import type { ImageReview } from '../../shared/image-schemas';
import type { ImageGenerationRequest, ImageModelProvider, ImageResult, TextModelProvider } from '../../domain/providers';
import { ImagePlanner, DETAIL_LANGUAGE_LABEL, resolveDetailImageLanguage, type DetailImageLanguage } from './image-planner';
import { ImageReviser, shouldRegenerate } from './image-reviser';

// 一张图完整的生成规格:请求(prompt + 参考图)、命名、归属与定位信息。
type ImageSpec = {
  request: ImageGenerationRequest;
  kind: 'main' | 'detail';
  skuKey?: string;
  detail?: GeneratedImage['detail'];
  productId: string;
  title: string;
  description: string;
  // 可读文件名(不含扩展名):主图 main-{序号},详情图 detail-{N}。
  name: string;
  // 进度日志标签,如「SKU 1 主图」「详情图 1/4(尺寸图)」。
  label: string;
};

export type ImageGenerationDeps = {
  readDetail: (productId: string) => ProductDetail | null;
  readDraft: (productId: string) => EditDraft | null;
  imageProvider: () => ImageModelProvider;
  textProvider: () => TextModelProvider;
  appendImages: (productId: string, result: AiImagesResult) => void;
  imagesDir: string;
  // 生图过程中的进度回调,由渲染层 log 面板展示(主进程直播进度 + 耗时)。
  onProgress?: (line: string) => void;
  // 生成后的发布步骤:压缩 + 上传七牛,给每张图补 publicUrl。缺省不做(测试/未配置)。
  publish?: (productId: string, images: GeneratedImage[]) => Promise<GeneratedImage[]>;
  // 发布后把公网 URL 写回 AI 草稿的产品图片字段。缺省不写(测试/未配置)。
  writeDraftImages?: (productId: string, mainImages: GeneratedImage[], detailImages: GeneratedImage[]) => void;
  // 读取已落盘的 aiImages 快照(已生成的图,未上传)。缺省返回 null(测试)。
  readImages?: (productId: string) => AiImagesResult | null;
  now?: () => string;
};

export function buildMainImagePrompt(input: { title: string; description: string; category: string; quantity?: string | null }): string {
  // 多件装(如 10/20/50/100 个一次性碗筷、发箍):主图不要逐个整齐排开,
  // 建议堆叠/错落/局部重叠摆放,做出层次,体现「数量多」即可,不必精确画出件数。
  const quantityRule = input.quantity
    ? `\n该产品为多件装（约 ${input.quantity}）。若是样式完全相同的物品（一次性用品、同款发箍等），请用堆叠/错落/局部重叠的摆放方式，做出层次感，体现数量多即可，不必精确画出 ${input.quantity} 件；若是几种不同物品的组合装，则按组合内容呈现。`
    : '';
  return `以参考图为准生成一张美客多主图：白底，只展示产品本身，无 logo、无文字，
不得虚构参考图中不存在的部件，产品外观/配色/结构保持一致。产品「${input.title}」。
类目：${input.category || '未知'}。描述：${input.description}${quantityRule}`;
}

// 从标题/描述里识别「多件装数量」。匹配 数字 + 计数单位(个/件/支/…),如
// 「10个装」「20件套」「100支」;数量 < 10 视为少量,不触发堆叠处理。
const QUANTITY_UNIT = '个|件|支|根|片|只|张|条|套|包|瓶|对|双|块|袋|盒|罐|颗|枚|粒|卷|组';
const QUANTITY_RE = new RegExp(`(\\d+)\\s*(${QUANTITY_UNIT})\\s*(?:装|入|件套|支装|只装)?`);

export function detectQuantity(...texts: string[]): string | null {
  for (const text of texts) {
    const match = QUANTITY_RE.exec(text ?? '');
    if (!match) continue;
    const count = Number(match[1]);
    if (count >= 10) return `${count} ${match[2]}`;
  }
  return null;
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

    // 多件装数量(如 10/20/50/100 个):命中时主图用堆叠呈现,详情图说明数量+包装内容。
    const quantity = detectQuantity(title, description);
    if (quantity) this.onProgress(`多件装约 ${quantity}:主图采用堆叠呈现,不逐件摆齐。`);

    // 详情图文字语言由商品发布的站点决定(站点含 MX/AR→西语;只有 BR→葡语)。
    const language = resolveDetailImageLanguage(detail.sites ?? draft?.sites ?? []);
    this.onProgress(`详情图文字语言：${DETAIL_LANGUAGE_LABEL[language]}`);
    const sku0Refs = skus[0]?.imageUrls ?? [];
    const planStartedAt = Date.now();
    this.onProgress(`正在规划详情图…`);
    const plan = await planner.plan({ title, description, category: detail.category ?? '', referenceImageUrls: sku0Refs, language, quantity });
    this.onProgress(`详情图规划完成（耗时 ${((Date.now() - planStartedAt) / 1000).toFixed(1)}s）。`);

    // 收集全部图的生成规格(主图 + 详情图),便于 codex 一次批量产出。
    // 每张携带:请求(prompt + 参考图)、命名、归属(main/detail)、SKU序号或详情序号。
    const specs: ImageSpec[] = [];
    for (const [skuIndex, sku] of skus.entries()) {
      const ref = sku.imageUrls[0];
      if (!ref) continue;
      specs.push({
        request: { prompt: buildMainImagePrompt({ title, description, category: detail.category ?? '', quantity }), referenceImageUrls: [ref] },
        kind: 'main', skuKey: sku.skuKey, detail: undefined, productId, title, description,
        name: imageFileName('main', skuIndex + 1),
        label: `SKU ${skuIndex + 1} 主图`,
      });
    }
    for (let index = 0; index < plan.length; index += 1) {
      const item = plan[index];
      specs.push({
        request: { prompt: buildDetailImagePrompt(item, title, language), referenceImageUrls: sku0Refs },
        kind: 'detail', skuKey: undefined, detail: { slug: item.id, title: item.subject, hasPerson: item.hasPerson },
        productId, title, description,
        name: imageFileName('detail', index + 1),
        label: `详情图 ${index + 1}/${plan.length}（${item.kind}）`,
      });
    }

    const mainImages: GeneratedImage[] = [];
    const detailImages: GeneratedImage[] = [];

    if (typeof provider.generateBatch === 'function') {
      // codex 路径:一次批量产全部;某张自检不过只补跑那几张。
      this.onProgress(`正在用 codex 一次性生成全部 ${specs.length} 张图（参考图只下载一次）…`);
      const batch = await provider.generateBatch(specs.map((spec) => spec.request), new AbortController().signal);
      for (let index = 0; index < specs.length; index += 1) {
        const spec = specs[index];
        const startedAt = Date.now();
        const image = await this.generateOne(provider, reviser, spec, { initial: batch[index] });
        this.onProgress(`完成 ${spec.label}：${image.status === 'ok' ? '生成成功' : image.status === 'retried' ? '补跑后成功' : '生成失败'}（耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s）。`);
        (spec.kind === 'main' ? mainImages : detailImages).push(image);
      }
    } else {
      for (const spec of specs) {
        this.onProgress(`正在生成 ${spec.label}…`);
        const startedAt = Date.now();
        const image = await this.generateOne(provider, reviser, spec);
        this.onProgress(`完成 ${spec.label}：${image.status === 'ok' ? '生成成功' : image.status === 'retried' ? '补跑后成功' : '生成失败'}（耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s）。`);
        (spec.kind === 'main' ? mainImages : detailImages).push(image);
      }
    }

    // 生成完毕后,若配置了发布步骤(压缩+上传七牛),则自动执行并写回公网 URL。
    let finalMain = mainImages;
    let finalDetail = detailImages;
    if (this.deps.publish) {
      this.onProgress(`正在压缩并上传到七牛…`);
      try {
        const published = await this.deps.publish(productId, [...mainImages, ...detailImages]);
        finalMain = published.filter((image) => image.kind === 'main');
        finalDetail = published.filter((image) => image.kind === 'detail');
        const urls = published.filter((image) => image.publicUrl);
        this.onProgress(`已上传 ${urls.length}/${published.length} 张图到七牛。`);
      } catch (error) {
        // 上传失败不阻断返回:保留本地图,publicUrl 缺省为空,由渲染层回退本地路径展示。
        this.onProgress(`上传七牛失败：${error instanceof Error ? error.message : '未知错误'}（保留本地图片）`);
      }
    }

    const failed = [...finalMain, ...finalDetail].filter((i) => i.status === 'failed');
    const status: AiImagesResult['status'] = failed.length === 0 ? 'done' : (failed.length === [...finalMain, ...finalDetail].length ? 'failed' : 'partial');

    const result: AiImagesResult = {
      version: 1, productId, mainImages: finalMain, detailImages: finalDetail, plan, status, createdAt: this.deps.now?.() ?? new Date().toISOString(),
    };
    this.deps.appendImages(productId, result);
    // 把公网 URL 写回 AI 草稿的产品图片字段,供 AI 编辑详情「产品图片」展示。
    this.deps.writeDraftImages?.(productId, finalMain, finalDetail);
    return result;
  }

  // 读取已落盘的 aiImages 快照(已生成的图,不重新生成)。
  getImages(productId: string): AiImagesResult | null {
    return this.deps.readImages?.(productId) ?? null;
  }

  // 把「已生成的图」直接压缩 + 上传七牛,不重新生成;拿到公网 URL 写回 AI 产品图片。
  async publishExisting(productId: string): Promise<AiImagesResult> {
    const existing = this.deps.readImages?.(productId);
    if (!existing) throw new Error('暂无已生成的图片,请先生成。');
    let finalMain = existing.mainImages;
    let finalDetail = existing.detailImages;
    if (this.deps.publish) {
      this.onProgress(`正在压缩并上传到七牛…`);
      try {
        const published = await this.deps.publish(productId, [...existing.mainImages, ...existing.detailImages]);
        finalMain = published.filter((image) => image.kind === 'main');
        finalDetail = published.filter((image) => image.kind === 'detail');
        this.onProgress(`已上传 ${published.filter((image) => image.publicUrl).length}/${published.length} 张图到七牛。`);
      } catch (error) {
        this.onProgress(`上传七牛失败：${error instanceof Error ? error.message : '未知错误'}（保留本地图片）`);
      }
    }
    // 落库时间戳用当前时间,避免与最初生成那份 aiImages 撞 time,导致读回挑错。
    const result: AiImagesResult = {
      ...existing,
      mainImages: finalMain,
      detailImages: finalDetail,
      createdAt: this.deps.now?.() ?? new Date().toISOString(),
    };
    this.deps.appendImages(productId, result);
    this.deps.writeDraftImages?.(productId, finalMain, finalDetail);
    return result;
  }

  private async generateOne(
    provider: ImageModelProvider,
    reviser: ImageReviser,
    spec: ImageSpec,
    opts: { initial?: ImageResult } = {},
  ): Promise<GeneratedImage> {
    const imageId = spec.name;
    const refs = spec.request.referenceImageUrls ?? [];
    const request = spec.request;
    let attempts = 1;
    let render: ImageResult = { url: '' };
    // 自检必须能看到图:OpenAI 默认只回 base64(url 为空),用 data URL 喂给视觉自检。
    const reviewImageUrl = () =>
      render.url || (render.dataBase64 ? `data:image/png;base64,${render.dataBase64}` : '');
    const failedImage = (attempts: number): GeneratedImage => ({
      imageId, kind: spec.kind, skuKey: spec.skuKey, detail: spec.detail, localPath: '',
      plannedPath: `mercado/${spec.productId}/${imageId}.png`, sourceRefImages: refs, prompt: request.prompt,
      attempts, status: 'failed', createdAt: this.deps.now?.() ?? new Date().toISOString(),
    });
    let review: ImageReview = { ok: true, issues: [] };

    // 首张:批量产物(opts.initial)有数据就直接用,省一次渲染;否则单独渲染一次。
    if (opts.initial && (opts.initial.dataBase64 || opts.initial.url)) {
      render = opts.initial;
    } else {
      try {
        const result = await provider.generate({ prompt: request.prompt, referenceImageUrls: refs }, new AbortController().signal);
        render = result[0] ?? { url: '' };
        if (!render.dataBase64 && !render.url) return failedImage(1);
      } catch {
        return failedImage(1);
      }
    }
    try {
      review = await reviser.review({ imageUrl: reviewImageUrl(), context: { title: spec.title, description: spec.description, kind: spec.kind } });
    } catch {
      review = { ok: true, issues: ['自检服务异常，未验证'] };
    }
    // 自检不过:只补跑当前这张(单独再渲染一次),最多补到 3 次。
    while (shouldRegenerate(review) && attempts < 3) {
      attempts += 1;
      try {
        const result = await provider.generate({ prompt: `${request.prompt}\n（上一版未过质检：${review.issues.join('；')} 请修改后重出。）`, referenceImageUrls: refs }, new AbortController().signal);
        render = result[0] ?? render;
      } catch { break; }
      try {
        review = await reviser.review({ imageUrl: reviewImageUrl(), context: { title: spec.title, description: spec.description, kind: spec.kind } });
      } catch {
        review = { ok: true, issues: ['自检服务异常，未验证'] };
      }
    }
    let localPath = '';
    try {
      localPath = await saveImageBytes(this.deps.imagesDir, spec.productId, imageId, render);
    } catch {
      localPath = '';
    }
    return {
      imageId, kind: spec.kind, skuKey: spec.skuKey, detail: spec.detail, localPath,
      plannedPath: `mercado/${spec.productId}/${imageId}.png`, sourceRefImages: refs, prompt: request.prompt,
      attempts, review, status: review.ok ? 'ok' : (attempts >= 3 ? 'failed' : 'retried'), createdAt: this.deps.now?.() ?? new Date().toISOString(),
    };
  }
}
