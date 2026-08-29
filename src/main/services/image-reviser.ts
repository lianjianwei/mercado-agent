import { imageReviewSchema, type ImageReview } from '../../shared/image-schemas';
import type { TextModelProvider } from '../../domain/providers';

export function shouldRegenerate(review: ImageReview): boolean {
  return !review.ok;
}

export type ReviewContext = { title: string; description: string; kind: 'main' | 'detail' };
export type ReviewInput = { imageUrl: string; context: ReviewContext };

const PROMPT = `你是一名电商质检员。检查这张商品图的真实性与质量。对照商品标题/描述判断。
只输出 valid JSON（{"ok":bool,"issues":[...]}）。issues 仅在 ok=false 时列出具体问题，
如：产品与标题/参考图不符、出现logo或无关文字、比例怪异、多指/残肢、背景非纯白(主图)、
凭空出现参考图中没有的部件。`;

export class ImageReviser {
  constructor(private readonly text: () => TextModelProvider) {}

  async review(input: ReviewInput): Promise<ImageReview> {
    const payload = await this.text().generate({
      prompt: `${PROMPT}\n标题：${input.context.title}\n描述：${input.context.description}\n图片角色：${input.context.kind === 'main' ? '主图' : '详情图'}`,
      imageUrls: [input.imageUrl],
    }, new AbortController().signal);
    const parsed = imageReviewSchema.safeParse(payload);
    return parsed.success ? parsed.data : { ok: false, issues: ['自检结果无法解析，按需重生成'] };
  }
}
