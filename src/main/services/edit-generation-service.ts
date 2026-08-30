import type {
  ProductRepository,
  ProductSnapshotRepository,
} from '../../domain/product';
import {
  DIMENSION_UNIT,
  WEIGHT_UNIT,
  type EditDraft,
  type EditField,
  type PackageEditField,
  type SkuEditField,
} from '../../domain/edit';
import {
  aiEditOutputSchema,
  type AiEditOutput,
} from '../../shared/edit-output-schema';
import type { CollectBoxDetailDto } from '../../shared/miaoshou-schemas';
import type { TextModelProvider } from '../../domain/providers';
import type { NetProfitCalculator } from './net-profit-calculator';
import { ModelStructuredOutputError } from '../providers/openai-compatible-text-provider';
import { selectModelImages } from '../risk/risk-relevant-mapper';

// AI edit draft generation.
//
// Reads the latest Miaoshou detail snapshot for a product, asks the model to
// produce edited title/description/brand/model and per-SKU name + package
// dimensions + billing weight, validates the structured response, and returns
// an EditDraft. The draft is NOT written to Miaoshou; persisting it as an
// aiDraft snapshot is the caller's job.
//
// SKU selection: SKUs whose original stock is missing or ≤1 are dropped from
// the draft entirely. Remaining SKUs get stock set to '2'. Each SKU's package
// dimensions/weight are estimated by the model from the SKU's own images, the
// description, and the original (possibly wrong) dimensions/weight. Source
// price is kept as-is from the original data.

export type EditGenerationServiceOptions = {
  now?: () => string;
  netProfit?: Pick<NetProfitCalculator, 'computeForDraft'>;
  // 生成过程中的进度回调,由渲染层 log 面板展示(主进程直播进度 + 耗时)。
  onProgress?: (line: string) => void;
};

// Brand is always Generic — it is never AI-generated. A missing/empty model
// falls back to the same fixed value instead of staying blank.
const GENERIC_FIELD: EditField = { value: 'Generic', source: 'fixed', confidence: 1 };

// A SKU that survived the stock filter, with its original data ready for the
// prompt and its image urls selected for the model.
type DraftSku = {
  skuKey: string;
  originalName: string | null;
  sourcePrice: string | null;
  originalLength: string | null;
  originalWidth: string | null;
  originalHeight: string | null;
  originalWeight: string | null;
  imageUrls: string[];
};

export class EditGenerationService {
  private readonly now: () => string;
  private readonly netProfit?: Pick<NetProfitCalculator, 'computeForDraft'>;
  private readonly onProgress: (line: string) => void;

  constructor(
    private readonly products: Pick<ProductRepository, 'getById'>,
    private readonly snapshots: Pick<ProductSnapshotRepository, 'listForProduct'>,
    private readonly providerFactory: () => TextModelProvider,
    options: EditGenerationServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.netProfit = options.netProfit;
    this.onProgress = options.onProgress ?? (() => undefined);
  }

  async generate(
    productId: string,
    signal?: AbortSignal,
  ): Promise<EditDraft> {
    const detail = this.latestDetail(productId);
    const skus = this.selectSkus(detail);
    const provider = this.providerFactory();
    const prompt = this.buildPrompt(detail, skus);
    this.onProgress(`正在生成标题、描述、SKU 尺寸与重量…`);
    let raw: unknown;
    try {
      const startedAt = Date.now();
      raw = await provider.generate(
        { prompt, imageUrls: skus.flatMap((sku) => sku.imageUrls) },
        signal ?? new AbortController().signal,
      );
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      this.onProgress(`标题、描述、SKU 尺寸与重量生成完成（耗时 ${seconds}s）。`);
    } catch (error) {
      this.onProgress(`标题、描述、SKU 尺寸与重量生成失败。`);
      throw error;
    }
    const parsed = aiEditOutputSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ModelStructuredOutputError('模型结构化输出不符合编辑草稿 schema。');
    }
    const draft = this.toDraft(detail, parsed.data, skus);
    const withSites = { ...draft, sites: detail.siteCollectItemInfo.sites ?? [] };
    // 重新生成文本时,保留上一份草稿的图片与净收益输入(只刷新标题/描述/型号/SKU名),
    // 否则已生成并上传的图片会被清空,界面回退成妙手原图。
    const merged = this.mergePreserved(this.latestDraft(productId), withSites);
    return this.netProfit ? this.netProfit.computeForDraft(merged) : merged;
  }

  // 上一份 AI 草稿(用于文本重生成时保留图片与净收益输入);无则返回 null。
  private latestDraft(productId: string): EditDraft | null {
    const drafts = this.snapshots
      .listForProduct(productId)
      .filter((snapshot) => snapshot.kind === 'aiDraft');
    const last = drafts[drafts.length - 1];
    return last ? (last.payload as EditDraft) : null;
  }

  // 文本重生成只应刷新标题/描述/型号/SKU名 等文本字段;其余(图片、货源价、库存、
  // 包装、净收益覆盖、发布站点)保留旧值,避免把用户已生成的图片和净收益清掉。
  private mergePreserved(prev: EditDraft | null, fresh: EditDraft): EditDraft {
    if (!prev) return fresh;
    const prevSkuByKey = new Map(prev.skus.map((sku) => [sku.skuKey, sku]));
    const skus = fresh.skus.map((sku) => {
      const old = prevSkuByKey.get(sku.skuKey);
      if (!old) return sku;
      return {
        ...sku,
        stock: old.stock ?? sku.stock,
        sourcePrice: old.sourcePrice ?? sku.sourcePrice,
        package: old.package ?? sku.package,
        imageUrl: old.imageUrl ?? null,
        imageUrls: old.imageUrls ?? [],
        siteNetProfitOverrides: old.siteNetProfitOverrides ?? {},
      };
    });
    return {
      ...fresh,
      sites: prev.sites ?? fresh.sites,
      mainImage: prev.mainImage ?? null,
      images: prev.images ?? [],
      globalNetProfitOverride: prev.globalNetProfitOverride ?? null,
      skus,
    };
  }

  private latestDetail(productId: string): CollectBoxDetailDto {
    const snapshots = this.snapshots.listForProduct(productId);
    // Only the miaoshou snapshot carries the detail response. A previous
    // generate appends an aiDraft snapshot (an EditDraft payload) that is the
    // newest row but has no siteCollectItemInfo — reading it would crash on
    // skuMap access when the user clicks regenerate.
    const latest = [...snapshots]
      .reverse()
      .find((snapshot) => snapshot.kind === 'miaoshou');
    if (!latest) {
      throw new Error('该商品尚无同步快照，无法生成编辑草稿。请先同步商品。');
    }
    return latest.payload as CollectBoxDetailDto;
  }

  // Drop SKUs whose original stock is missing or ≤1, and keep the rest for the
  // prompt. Stock handling for survivors is applied in toDraft ('2').
  private selectSkus(detail: CollectBoxDetailDto): DraftSku[] {
    const info = detail.siteCollectItemInfo;
    const result: DraftSku[] = [];
    for (const [skuKey, sku] of Object.entries(info.skuMap ?? {})) {
      const stock = Number(sku?.stock);
      // Missing/NaN stock or ≤1 → drop the SKU.
      if (!Number.isFinite(stock) || stock <= 1) continue;
      result.push({
        skuKey,
        originalName: this.skuName(sku),
        sourcePrice: this.stringValue(sku?.originPrice),
        originalLength: this.stringValue(sku?.length),
        originalWidth: this.stringValue(sku?.width),
        originalHeight: this.stringValue(sku?.height),
        originalWeight: this.stringValue(sku?.weight),
        imageUrls: this.skuImages(sku),
      });
    }
    return result;
  }

  private skuImages(sku: Record<string, unknown>): string[] {
    const urls: string[] = [];
    if (!Array.isArray(sku?.imgUrls)) return urls;
    for (const url of sku.imgUrls) {
      if (typeof url === 'string') urls.push(url);
    }
    return selectModelImages(urls);
  }

  private buildPrompt(
    detail: CollectBoxDetailDto,
    skus: DraftSku[],
  ): string {
    const info = detail.siteCollectItemInfo;
    // Each SKU lists which image indexes belong to it so the model can match
    // a SKU's pictures to its dimensions/weight estimate.
    let imageCursor = 0;
    // Each SKU is numbered (SKU 1, SKU 2…) so the model can reference it by a
    // stable label; the raw skuKey may be an opaque hash like ;633b93b4; that
    // the model would otherwise garble when echoing it back.
    const skuLines = skus.map((sku, index) => {
      const skuNo = index + 1;
      const indexes = sku.imageUrls.map((_, imageIndex) => imageCursor + imageIndex);
      imageCursor += sku.imageUrls.length;
      return [
        `- SKU ${skuNo}：skuKey ${sku.skuKey}`,
        sku.originalName ? `  原规格名：${sku.originalName}` : '  原规格名：未提供',
        sku.sourcePrice !== null ? `  货源价：${sku.sourcePrice}` : '  货源价：未提供',
        `  原尺寸：${[
          sku.originalLength ? `长${sku.originalLength}` : null,
          sku.originalWidth ? `宽${sku.originalWidth}` : null,
          sku.originalHeight ? `高${sku.originalHeight}` : null,
        ].filter(Boolean).join(' ') || '未提供'}`,
        `  原重量：${sku.originalWeight ?? '未提供'}`,
        indexes.length > 0
          ? `  对应图片序号：${indexes.join(', ')}（请看这些图评估该 SKU 的尺寸和重量）`
          : '  对应图片：无',
      ].join('\n');
    });

    return [
      '你是美客多（Mercado Libre）商品编辑助手。根据商品信息，为采集箱商品生成优化后的西语（商品主标题）编辑草稿。',
      '只输出 JSON，不要输出其他文字。',
      '',
      '本土化要求（标题和描述都适用）：',
      '- 用拉美买家真正会搜索的西语/葡语自然表达，而不是把原标题/描述逐字直译成中文再翻过来。',
      '- 用本地市场习惯的词和说法（例如卖点表达、常见修饰词），读起来像本地卖家写的，不是翻译腔。',
      '- 不得保留中文，不得出现生硬直译；数值、型号、品牌名除外。',
      '',
      '面向买家（重要，标题和描述都适用）：',
      '- 你是美客多上卖成品现货的普通卖家，只卖成品，不是工厂、批发商、跨境供应商。目标读者是美客多的终端消费者（个人买家），不是商家。',
      '- 只谈成品本身：颜色、数量、材质、尺寸、适用场景、卖点。语气像本地零售卖家，不吹工厂背景、不提供任何定制/批发/代理服务。',
      '- 原数据里常见的这些 B2B/工厂信息一律丢弃，不要写进标题或描述：批发、跨境、工厂、产地、是否专利、是否进口、加工定制、打样、起订量、招商、代理、一件代发、加印 logo、logo 定制、IP 授权、商标授权、类目定制、按需求定制等。',
      '- 不要出现西语的 定制/批发/工厂 表述：personalización / personalizado / bajo pedido / a medida / por mayor / mayorista / fábrica / logo（当作“可加 logo”的卖点）/ licencia / patente / importado / custom 等，一律不出现。',
      '',
      '标题规则（最重要，决定买家能否搜到你）：',
      '- 公式：核心品类词 + 关键特征/规格（含数量、容量、参数数字）+ 品牌/型号（如有）+ 适用对象 + 颜色（如有）。',
      '- 结构参考这些拉美高销量标题的写法（学习结构，不要逐字照抄；下面示例有的超过 60 字符，你的输出必须 ≤60）：',
      '  ① Metronomo Mecánico Analógico Pendulo Universal Classic Abs',
      '  ② Interfaz De Mezcla De Audio Para Mesa De Mezclas Tenlamp G10',
      '  ③ 100 Bolsas Transparentes De 500 Ml Para Bebidas Y Pajitas',
      '  ④ Juego 6 Luces Bici 2000lm Recargable Ipx6 6 Modos Emergencia Lawan Ab02 Negro',
      '  ⑤ Funda Para Galaxy Tab A11 Plus 2025 Soporte Correa + Mica',
      '- 特征用实词堆叠（材质如 ABS/Neopreno/Plástico、规格如 500 Ml/2 Canales/14x2.50、参数如 2000lm/15 Banda），用空格或逗号分隔，不用完整句子。',
      '- 数字尽量带上：数量（100、2、Juego 6、Pack de 30）、容量、尺寸、亮度/功率等参数。',
      '- 品牌和型号原样保留（Tenlamp G10、Pioneer ddj-flx4、Lawan Ab02、LIEFINE）。',
      '- 适用对象用 para + 机型/品类（Para Galaxy Tab S11、Para Moto Eléctrica、Para Mesa De Mezclas）。',
      '- 颜色放末尾（Negro、Color Negro）。',
      '- 核心品类词用买家会搜的西语词，优先参考原标题里的品类/用途。',
      '- 总长度必须 ≤60 个字符（含空格）。超长时删次要特征，保留核心品类词和最能吸引点击的特征；宁可精简，不要堆满。',
      '- 禁止：New/Hot/原装/包邮 之类无效填充词；不得重复词；不得保留中文；不得编造品牌；不得出现任何 定制/批发/工厂/跨境/加印logo/商标授权/专利 等 B2B 词。',
      '',
      '描述规则（用西语，结构清晰、分段、不要挤成一段）：',
      '- 用 \\n 换行分段；列表项用「•」或「-」开头，一行一项。',
      '- 第 1 段：一句话点明产品是什么 + 核心卖点。',
      '- 第 2 段「可选规格」：多 SKU 时逐项列出颜色/款式（如 Blanco、Negro、Azul），一行一个；单 SKU 可直接写规格/容量。',
      '- 第 3 段「尺寸/重量」（如有）：列尺寸（cm）、容量、净含量等，可列表。',
      '- 第 4 段「适用/兼容」：适用场景；若是配件，说明适配哪些机型/品类。',
      '- 末尾可加一句「材质」「包装」等（如有）。',
      '- 只面向消费者：讲成品怎么用、什么规格、能给买家带来什么，像本地零售描述，不向商家推销。',
      '- 绝不写工厂/批发/定制内容，例如以下这类一句都不能出现：「personalización de logo disponible bajo pedido」「venta por mayor」「mayorista」「fábrica」「personalizado/a medida/bajo pedido」「patente/licencia/importado」「se fabrican a pedido」「logo personalizado」；原信息里若有，直接丢弃不写。',
      '- 信息不全时不编造；没有对应内容就跳过那段，不要留空段。',
      '- 只输出一个字符串，段落 / 列表之间用 \\n 隔开（JSON 字符串里的换行写成 \\n 转义，不要输出裸换行）。',
      '',
      '描述示例（结构参考，内容可不同，只面向消费者、不通篇工厂口吻）：',
      '"Vela aromática de soja Lavanda 120g de la marca X\\n\\n• Aroma: lavanda francesa\\n• Peso: 120 g\\n• Material: cera de soja 100%\\n\\nAdecuado para aromatizar salas, dormitorios y regalos."',
      '',
      'SKU 名称规则：',
      '- 每个 SKU 的原规格名翻译成西语（如原为颜色，用拉美常用的颜色词）。',
      '- 保留型号前缀（如 MT-32、JM-90），只翻译后面的规格部分。',
      '- skus 数组必须与上面 SKU 1、SKU 2… 列表顺序一致、数量相同；skuKey 必须原样复制（即使是 ;633b93b4; 这样的原始 key 也不能改写成其他内容）。',
      '',
      '每个 SKU 的包裹尺寸和计费重量规则（必须逐 SKU 独立评估）：',
      '- 每个 SKU 参考：该 SKU 的图片（见「对应图片序号」）+ 商品描述 + 原尺寸/重量。',
      '- 原尺寸/重量可能为空或错误（商家随便填的），不要盲信；结合该 SKU 图片和描述里提到的尺寸/重量来校验、修正或预估。',
      '- 不同 SKU 的尺寸/重量可能不同，逐个独立判断。',
      '- 图片里若标了尺寸/重量，以图片为准；描述里提到也参考。',
      '- 每个字段给 0-1 置信度：能从图片/描述确认的高置信度，纯猜测的低置信度。',
      '- 单位固定：尺寸用 cm，重量用 g。你只输出数值，不要输出单位。',
      '',
      '商品信息：',
      `标题：${info.title ?? '未提供'}`,
      `描述：${info.notes ?? info.notesFull ?? '未提供'}`,
      `品牌属性：${this.brandValue(info) ?? '未提供'}`,
      `型号属性：${this.modelValue(info) ?? '未提供'}`,
      `SKU 列表（图片序号从 0 开始，全局编号）：\n${skuLines.join('\n') || '无 SKU'}`,
      '',
      '输出 JSON 结构：',
      JSON.stringify({
        title: { value: '西语主标题（≤60字符）', confidence: 0.9 },
        description: { value: '西语描述', confidence: 0.9 },
        model: { value: '型号', confidence: 0.6 },
        skus: [{
          skuKey: 'SKU原始key',
          name: { value: '西语SKU名', confidence: 0.9 },
          package: {
            length: { value: '20', confidence: 0.7 },
            width: { value: '15', confidence: 0.7 },
            height: { value: '12', confidence: 0.7 },
            weight: { value: '900', confidence: 0.8 },
          },
        }],
      }, null, 2),
      '品牌固定为 Generic，不要输出品牌字段。',
      '型号属性缺失或无法确认时，model 的 value 输出空字符串。',
      '未提供或无法确认的字段，confidence 给低值，value 给合理默认或原值。',
    ].join('\n');
  }

  private toDraft(
    detail: CollectBoxDetailDto,
    output: AiEditOutput,
    skus: DraftSku[],
  ): EditDraft {
    // The surviving SKUs are the source of truth: every one of them gets a
    // draft entry, and the model output is matched back to them (exact key,
    // then order) instead of the other way around. Opaque skuKeys like
    // ;633b93b4; are often garbled by the model; matching by order keeps the
    // SKU from being dropped, and a missing match falls back to the original
    // data rather than disappearing.
    const matched = this.matchSkus(output.skus, skus);
    const skuFields: SkuEditField[] = skus.map((original, index) => {
      const modelSku = matched[index];
      return {
        skuKey: original.skuKey,
        name: modelSku
          ? this.aiField(modelSku.name)
          : this.originalField(original.originalName),
        // Stock rule: every surviving SKU gets '2'.
        stock: { value: '2', source: 'ai', confidence: 1 },
        // Source price is kept as-is from the original data.
        sourcePrice: original.sourcePrice
          ? { value: original.sourcePrice, source: 'remote', confidence: 1 }
          : { value: '', source: 'ai', confidence: 0 },
        package: modelSku
          ? this.skuPackage(modelSku.package)
          : this.originalPackage(original),
        // 生成阶段尚无上传后的图片,SKU 图片字段先留空;上传后由 publish 写回。
        imageUrl: null,
        imageUrls: [],
        // Net-profit maps are filled by NetProfitCalculator after generation;
        // until then they are empty so the draft shape is always complete.
        siteAndPriceMap: {},
        siteAndListingTypeInfoMap: {},
      };
    });

    return {
      version: 1,
      createdAt: this.now(),
      title: this.aiField(output.title),
      description: this.aiField(output.description),
      // Brand is fixed to Generic regardless of what the model might have
      // said; it is never AI-generated.
      brand: GENERIC_FIELD,
      // A missing/empty model falls back to Generic instead of staying blank.
      model: output.model.value.trim() ? this.aiField(output.model) : GENERIC_FIELD,
      // Publish sites are attached from the miaoshou detail in generate();
      // the product-level global net-profit map is filled by the calculator.
      sites: [],
      siteAndPriceMap: {},
      // 图片先留空,上传后由 publish 写回「产品图片」。
      mainImage: null,
      images: [],
      skus: skuFields,
    };
  }

  // Align the model's SKU output with the surviving SKUs 1:1. Exact skuKey
  // matches win; remaining entries fall back to the model output in order
  // (the model usually keeps the prompt's SKU order even when it rewrites an
  // opaque key). Returns undefined for a SKU the model produced no entry for.
  private matchSkus(
    modelSkus: AiEditOutput['skus'],
    skus: DraftSku[],
  ): (AiEditOutput['skus'][number] | undefined)[] {
    const used = new Set<number>();
    const byKey = new Map(modelSkus.map((sku, index) => [sku.skuKey, index]));
    return skus.map((original, index) => {
      const exact = byKey.get(original.skuKey);
      if (exact !== undefined && !used.has(exact)) {
        used.add(exact);
        return modelSkus[exact];
      }
      const candidates = [...modelSkus.keys()];
      const next = candidates.find((candidate) => !used.has(candidate) && candidate >= index)
        ?? candidates.find((candidate) => !used.has(candidate));
      if (next === undefined) return undefined;
      used.add(next);
      return modelSkus[next];
    });
  }

  private skuPackage(
    packageOutput: AiEditOutput['skus'][number]['package'],
  ): PackageEditField {
    return {
      length: this.aiField(packageOutput.length),
      width: this.aiField(packageOutput.width),
      height: this.aiField(packageOutput.height),
      // Units are fixed constants, not model-output fields.
      dimensionUnit: DIMENSION_UNIT,
      weight: this.aiField(packageOutput.weight),
      weightUnit: WEIGHT_UNIT,
    };
  }

  private aiField(field: { value: string; confidence: number }): EditField {
    return {
      value: field.value,
      source: 'ai',
      confidence: field.confidence,
    };
  }

  // The original value carried over unchanged when the model produced no entry
  // for a SKU. Missing originals become an empty field rather than a crash.
  private originalField(value: string | null): EditField {
    if (value === null || value === '') {
      return { value: '', source: 'ai', confidence: 0 };
    }
    return { value, source: 'remote', confidence: 1 };
  }

  private originalPackage(original: DraftSku): PackageEditField {
    const dimension = (value: string | null): EditField =>
      value === null || value === ''
        ? { value: '', source: 'ai', confidence: 0 }
        : { value, source: 'remote', confidence: 1 };
    return {
      length: dimension(original.originalLength),
      width: dimension(original.originalWidth),
      height: dimension(original.originalHeight),
      // Units are fixed constants, not model-output fields.
      dimensionUnit: DIMENSION_UNIT,
      weight: dimension(original.originalWeight),
      weightUnit: WEIGHT_UNIT,
    };
  }

  private skuName(sku: Record<string, unknown>): string | null {
    if (typeof sku?.itemNum === 'string' && sku.itemNum.length > 0) {
      return sku.itemNum;
    }
    return null;
  }

  private stringValue(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null;
    return String(value);
  }

  private brandValue(info: CollectBoxDetailDto['siteCollectItemInfo']): string | null {
    return this.attributeValue(info, ['brand', 'marca', '品牌']);
  }

  private modelValue(info: CollectBoxDetailDto['siteCollectItemInfo']): string | null {
    return this.attributeValue(info, ['model', 'modelo', '型号']);
  }

  private attributeValue(
    info: CollectBoxDetailDto['siteCollectItemInfo'],
    names: string[],
  ): string | null {
    const attribute = info.attributes?.find((candidate) => {
      const name = candidate.name?.toLowerCase() ?? '';
      return names.some((wanted) => name.includes(wanted));
    });
    return attribute?.values?.[0]?.name ?? null;
  }
}
