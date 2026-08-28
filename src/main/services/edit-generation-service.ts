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
};

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

  constructor(
    private readonly products: Pick<ProductRepository, 'getById'>,
    private readonly snapshots: Pick<ProductSnapshotRepository, 'listForProduct'>,
    private readonly providerFactory: () => TextModelProvider,
    options: EditGenerationServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async generate(
    productId: string,
    signal?: AbortSignal,
  ): Promise<EditDraft> {
    const detail = this.latestDetail(productId);
    const skus = this.selectSkus(detail);
    const provider = this.providerFactory();
    const prompt = this.buildPrompt(detail, skus);
    const raw = await provider.generate(
      { prompt, imageUrls: skus.flatMap((sku) => sku.imageUrls) },
      signal ?? new AbortController().signal,
    );
    const parsed = aiEditOutputSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ModelStructuredOutputError('模型结构化输出不符合编辑草稿 schema。');
    }
    return this.toDraft(detail, parsed.data, skus);
  }

  private latestDetail(productId: string): CollectBoxDetailDto {
    const snapshots = this.snapshots.listForProduct(productId);
    const latest = snapshots[snapshots.length - 1];
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
    const skuLines = skus.map((sku) => {
      const indexes = sku.imageUrls.map((_, index) => imageCursor + index);
      imageCursor += sku.imageUrls.length;
      return [
        `- skuKey ${sku.skuKey}`,
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
      '- 禁止：New/Hot/原装/包邮 之类无效填充词；不得重复词；不得保留中文；不得编造品牌。',
      '',
      '描述规则：',
      '- 用西语写，3-6 句话，读起来像本地卖家写的产品描述。',
      '- 尽量覆盖：①商品内容（总共卖哪些东西）；②可选规格（SKU/颜色等有哪些选项）；③尺寸（如有，用 cm）；④适用场景；⑤如果是配件，说明适用于什么产品的哪些型号。',
      '- 信息不全时不编造，有就写、没有就跳过对应点。',
      '',
      'SKU 名称规则：',
      '- 每个 SKU 的原规格名翻译成西语（如原为颜色，用拉美常用的颜色词）。',
      '- 保留型号前缀（如 MT-32、JM-90），只翻译后面的规格部分。',
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
        brand: { value: 'Generic', confidence: 1 },
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
      'skus 数组必须与上面列出的 SKU 一一对应，skuKey 必须原样返回。',
      '未提供或无法确认的字段，confidence 给低值，value 给合理默认或原值。',
    ].join('\n');
  }

  private toDraft(
    detail: CollectBoxDetailDto,
    output: AiEditOutput,
    skus: DraftSku[],
  ): EditDraft {
    const byKey = new Map(skus.map((sku) => [sku.skuKey, sku]));
    // The stock filter in selectSkus decides which SKUs survive; only keep the
    // model output for those surviving SKUs (the model echoes all SKUs given).
    const skuFields: SkuEditField[] = output.skus
      .filter((sku) => byKey.has(sku.skuKey))
      .map((sku) => {
        const original = byKey.get(sku.skuKey)!;
        return {
          skuKey: sku.skuKey,
          name: this.aiField(sku.name),
          // Stock rule: every surviving SKU gets '2'.
          stock: { value: '2', source: 'ai', confidence: 1 },
          // Source price is kept as-is from the original data.
          sourcePrice: {
            value: original.sourcePrice ?? '',
            source: original.sourcePrice ? 'remote' : 'ai',
            confidence: original.sourcePrice ? 1 : 0,
          },
          package: this.skuPackage(sku.package),
        };
      });

    return {
      version: 1,
      createdAt: this.now(),
      title: this.aiField(output.title),
      description: this.aiField(output.description),
      brand: this.aiField(output.brand),
      model: this.aiField(output.model),
      skus: skuFields,
    };
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
