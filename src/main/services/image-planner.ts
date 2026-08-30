import { normalizeSiteKey } from '../../domain/net-profit';
import { detailPlanSchema } from '../../shared/image-schemas';
import type { DetailPlanItem } from '../../domain/images';
import type { TextModelProvider } from '../../domain/providers';

export class ImagePlanError extends Error {
  constructor(message = '模型返回的详情图规划无法解析。') {
    super(message);
    this.name = 'ImagePlanError';
  }
}

// 详情图文字只用一种语言:由商品发布的站点决定,而非模型逐张自行选择,
// 避免一张图里出现西语+葡语混排。es=西语，pt=葡语。
export type DetailImageLanguage = 'es' | 'pt';

export const DETAIL_LANGUAGE_LABEL: Record<DetailImageLanguage, string> = {
  es: '西班牙语',
  pt: '葡萄牙语',
};

const SPANISH_SITE_CODES = new Set(['MX', 'AR']);

// 站点包含墨西哥/阿根廷(西语)→西语;站点只有巴西→葡语;无站点或未知→默认西语。
export function resolveDetailImageLanguage(sites: string[]): DetailImageLanguage {
  const codes = (sites ?? []).map((site) => normalizeSiteKey(site)).filter((code) => code.length > 0);
  if (codes.some((code) => SPANISH_SITE_CODES.has(code))) return 'es';
  if (codes.length > 0 && codes.every((code) => code === 'BR')) return 'pt';
  return 'es';
}

function systemPrompt(language: DetailImageLanguage): string {
  const label = DETAIL_LANGUAGE_LABEL[language];
  // textEs 存西语文字、textPt 存葡语文字;本次只让模型填目标语言那个字段,另一个留空字符串。
  const textField = language === 'es' ? 'textEs 填西语文字，textPt 留空字符串' : 'textPt 填葡语文字，textEs 留空字符串';
  return `你是一名资深跨境电商美工与运营。根据商品的标题、描述、类目与参考图，
为美客多详情页规划 4 张详情图。每张图输出一件具体要做的事。
约束：
- 数量固定 4 张；只输出 valid JSON（{"plans":[...]}）。
- kind 只能是：尺寸图/功能图/场景图/包装清单/安装步骤/使用流程图/收纳尺寸对比。
- subject 说明这张图具体呈现什么。
- 图上文字只用 ${label}，不要出现其他语言；${textField}。
- hasPerson 是否需要人物(服饰/发饰/包/场景图优先，人物用拉美裔)。
- referenceNote 说明依据哪张参考图。
- 参考图中没有安装/使用流程的，不要生成安装步骤/使用流程图；不得虚构参考图中没有的内容。`;
}

export type PlanInput = {
  title: string;
  description: string;
  category: string;
  referenceImageUrls: string[];
  // 详情图文字语言,由商品站点决定;缺省按西语。
  language?: DetailImageLanguage;
};

export class ImagePlanner {
  constructor(private readonly text: () => TextModelProvider) {}

  async plan(input: PlanInput): Promise<DetailPlanItem[]> {
    const language = input.language ?? 'es';
    const payload = await this.text().generate({
      prompt: `${systemPrompt(language)}\n\n标题：${input.title}\n描述：${input.description}\n类目：${input.category||'未知'}\n参考图：\n${input.referenceImageUrls.map((u,i)=>`${i+1}. ${u}`).join('\n')}`,
      imageUrls: input.referenceImageUrls.slice(0, 4),
    }, new AbortController().signal);
    const parsed = detailPlanSchema.safeParse(payload);
    if (!parsed.success) throw new ImagePlanError();
    // 模型通常不输出 id(提示里也没要求),解析后按序号补齐,保证详情图记录有稳定 slug。
    return parsed.data.plans.map((item, index) => ({ id: item.id ?? `detail-${index + 1}`, ...item })).slice(0, 4);
  }
}
