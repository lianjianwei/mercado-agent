import type {
  ProductRepository,
  ProductSnapshotRepository,
} from '../../domain/product';
import type {
  EditDraft,
  EditField,
  PackageEditField,
  SkuEditField,
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
// produce edited title/description/brand/model/SKU names and package
// dimensions + billing weight, validates the structured response, and returns
// an EditDraft. The draft is NOT written to Miaoshou; persisting it as an
// aiDraft snapshot is the caller's job.

export type EditGenerationServiceOptions = {
  now?: () => string;
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
    const info = detail.siteCollectItemInfo;
    const provider = this.providerFactory();
    const prompt = this.buildPrompt(detail);
    const raw = await provider.generate(
      { prompt, imageUrls: this.modelImages(detail) },
      signal ?? new AbortController().signal,
    );
    const parsed = aiEditOutputSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ModelStructuredOutputError('模型结构化输出不符合编辑草稿 schema。');
    }
    return this.toDraft(detail, parsed.data);
  }

  private latestDetail(productId: string): CollectBoxDetailDto {
    const snapshots = this.snapshots.listForProduct(productId);
    const latest = snapshots[snapshots.length - 1];
    if (!latest) {
      throw new Error('该商品尚无同步快照，无法生成编辑草稿。请先同步商品。');
    }
    return latest.payload as CollectBoxDetailDto;
  }

  private modelImages(detail: CollectBoxDetailDto): string[] {
    const info = detail.siteCollectItemInfo;
    const urls: string[] = [];
    for (const sku of Object.values(info.skuMap ?? {})) {
      if (!Array.isArray(sku?.imgUrls)) continue;
      for (const url of sku.imgUrls) {
        if (typeof url === 'string') urls.push(url);
      }
    }
    return selectModelImages(urls);
  }

  private buildPrompt(detail: CollectBoxDetailDto): string {
    const info = detail.siteCollectItemInfo;
    const skuLines = Object.entries(info.skuMap ?? {}).map(([skuKey, sku]) => {
      const name = this.skuName(sku);
      return [
        `- skuKey ${skuKey}`,
        name ? `  原名称：${name}` : '  原名称：未提供',
        `  原尺寸：${[
          sku?.length ? `长${sku.length}` : null,
          sku?.width ? `宽${sku.width}` : null,
          sku?.height ? `高${sku.height}` : null,
        ].filter(Boolean).join(' ') || '未提供'}${sku?.lengthWidthHeightUnit ? ` ${sku.lengthWidthHeightUnit}` : ''}`,
        `  原重量：${sku?.weight ? `${sku.weight} ${sku.weightUnit ?? ''}`.trim() : '未提供'}`,
      ].join('\n');
    });

    return [
      '你是美客多（Mercado Libre）商品编辑助手。根据商品信息，为采集箱商品生成优化后的西语（商品主标题）编辑草稿。',
      '只输出 JSON，不要输出其他文字。',
      '',
      '规则：',
      '- 主标题使用西班牙语，控制在 60 个字符以内（含空格）。',
      '- 描述使用西班牙语，1-3 句话，说明材质、功能和使用场景。',
      '- 品牌固定为 Generic。',
      '- 型号：如果原信息已有明确型号则沿用；否则从标题或描述中挑选最合适的简短型号填入。',
      '- 每个 SKU 的 name 翻译成西班牙语。',
      '- 包裹尺寸和计费重量：参考原尺寸/重量（可能为空或错误），并结合商品图片里的信息校验/预估。每个字段给 0-1 置信度；明显从图片可确认的高置信度，否则低。',
      '- 单位：尺寸用 cm，重量用 kg。',
      '',
      '商品信息：',
      `标题：${info.title ?? '未提供'}`,
      `描述：${info.notes ?? info.notesFull ?? '未提供'}`,
      `品牌属性：${this.brandValue(info) ?? '未提供'}`,
      `型号属性：${this.modelValue(info) ?? '未提供'}`,
      `SKU 列表：\n${skuLines.join('\n') || '无 SKU'}`,
      '',
      '输出 JSON 结构：',
      JSON.stringify({
        title: { value: '西语主标题（≤60字符）', confidence: 0.9 },
        description: { value: '西语描述', confidence: 0.9 },
        brand: { value: 'Generic', confidence: 1 },
        model: { value: '型号', confidence: 0.6 },
        skus: [{ skuKey: 'SKU原始key', name: { value: '西语SKU名', confidence: 0.9 } }],
        package: {
          length: { value: '20', confidence: 0.7 },
          width: { value: '15', confidence: 0.7 },
          height: { value: '12', confidence: 0.7 },
          dimensionUnit: { value: 'cm', confidence: 0.99 },
          weight: { value: '0.9', confidence: 0.8 },
          weightUnit: { value: 'kg', confidence: 0.99 },
        },
      }, null, 2),
      'skus 数组必须与上面列出的 SKU 一一对应，skuKey 必须原样返回。',
      '未提供或无法确认的字段，confidence 给低值，value 给合理默认或原值。',
    ].join('\n');
  }

  private toDraft(
    detail: CollectBoxDetailDto,
    output: AiEditOutput,
  ): EditDraft {
    const info = detail.siteCollectItemInfo;
    const skuMap = info.skuMap ?? {};
    const skus: SkuEditField[] = output.skus.map((sku) => ({
      skuKey: sku.skuKey,
      name: {
        value: sku.name.value,
        source: 'ai',
        confidence: sku.name.confidence,
      },
    }));

    const packageField: PackageEditField = {
      length: this.aiField(output.package.length),
      width: this.aiField(output.package.width),
      height: this.aiField(output.package.height),
      dimensionUnit: this.aiField(output.package.dimensionUnit),
      weight: this.aiField(output.package.weight),
      weightUnit: this.aiField(output.package.weightUnit),
    };

    return {
      version: 1,
      createdAt: this.now(),
      title: this.aiField(output.title),
      description: this.aiField(output.description),
      brand: this.aiField(output.brand),
      model: this.aiField(output.model),
      skus,
      package: packageField,
    };
  }

  private aiField(field: AiEditOutput['title']): EditField {
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
