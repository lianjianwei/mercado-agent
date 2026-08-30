import { detailPlanSchema } from '../../shared/image-schemas';
import type { DetailPlanItem } from '../../domain/images';
import type { TextModelProvider } from '../../domain/providers';

export class ImagePlanError extends Error {
  constructor(message = '模型返回的详情图规划无法解析。') {
    super(message);
    this.name = 'ImagePlanError';
  }
}

const SYSTEM_PROMPT = `你是一名资深跨境电商美工与运营。根据商品的标题、描述、类目与参考图，
为美客多详情页规划 4-6 张详情图。每张图输出一件具体要做的事。
约束：
- 数量 4-6 张；只输出 valid JSON（{"plans":[...]}）。
- kind 只能是：尺寸图/功能图/场景图/包装清单/安装步骤/使用流程图/收纳尺寸对比。
- subject 说明这张图具体呈现什么；textEs/textPt 为图上文本(西语/葡语)，放不下只保留西语。
- hasPerson 是否需要人物(服饰/发饰/包/场景图优先，人物用拉美裔)。
- referenceNote 说明依据哪张参考图。
- 参考图中没有安装/使用流程的，不要生成安装步骤/使用流程图；不得虚构参考图中没有的内容。`;

export type PlanInput = { title: string; description: string; category: string; referenceImageUrls: string[] };

export class ImagePlanner {
  constructor(private readonly text: () => TextModelProvider) {}

  async plan(input: PlanInput): Promise<DetailPlanItem[]> {
    const payload = await this.text().generate({
      prompt: `${SYSTEM_PROMPT}\n\n标题：${input.title}\n描述：${input.description}\n类目：${input.category||'未知'}\n参考图：\n${input.referenceImageUrls.map((u,i)=>`${i+1}. ${u}`).join('\n')}`,
      imageUrls: input.referenceImageUrls.slice(0, 4),
    }, new AbortController().signal);
    const parsed = detailPlanSchema.safeParse(payload);
    if (!parsed.success) throw new ImagePlanError();
    // 模型通常不输出 id(提示里也没要求),解析后按序号补齐,保证详情图记录有稳定 slug。
    return parsed.data.plans.map((item, index) => ({ id: item.id ?? `detail-${index + 1}`, ...item })).slice(0, 6);
  }
}
