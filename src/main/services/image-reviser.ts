import { imageReviewSchema, type ImageReview } from '../../shared/image-schemas';
import type { TextModelProvider } from '../../domain/providers';

export function shouldRegenerate(review: ImageReview): boolean {
  return !review.ok;
}

export type ReviewContext = { title: string; description: string; kind: 'main' | 'detail' };
export type ReviewInput = { imageUrl: string; context: ReviewContext; referenceImageUrls?: string[] };

const PROMPT = `你是一名电商质检员。检查这张商品图的真实性与质量。对照商品标题/描述与参考图判断。
输入里会同时给出「生成图」和「参考图」，请把两者对比后判断。
只输出 valid JSON（{"ok":bool,"issues":[...]}）。issues 仅在 ok=false 时列出具体问题，
如：产品与标题/参考图不符、出现logo或无关文字、比例怪异、多指/残肢、背景非纯白(主图)、
凭空出现参考图中没有的部件、参考图里可数结构的数量（槽位/格数/孔数/片数/层数等）
与生成图不一致（增加或减少都判不合格）。`;

export class ImageReviser {
  constructor(private readonly text: () => TextModelProvider) {}

  async review(input: ReviewInput): Promise<ImageReview> {
    // 把参考图一并喂给视觉模型,让自检能真正「对照参考图」而不是只看标题/描述。
    // 参考图取前若干张,避免一次塞太多导致模型抓不住重点。
    const imageUrls = [input.imageUrl, ...(input.referenceImageUrls ?? []).slice(0, 3)];
    const payload = await this.text().generate({
      prompt: `${PROMPT}\n标题：${input.context.title}\n描述：${input.context.description}\n图片角色：${input.context.kind === 'main' ? '主图' : '详情图'}`,
      imageUrls,
    }, new AbortController().signal);
    const parsed = imageReviewSchema.safeParse(payload);
    return parsed.success ? parsed.data : { ok: false, issues: ['自检结果无法解析，按需重生成'] };
  }
}
