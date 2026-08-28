import type { TextModelProvider } from '../../domain/providers';
import {
  aiInfringementDecisionSchema,
  type InfringementDecision,
} from '../../shared/infringement-schema';
import { ModelStructuredOutputError } from '../providers/openai-compatible-text-provider';
import { riskFingerprint, type RiskRelevantProduct } from './fingerprint';
import {
  evaluateLocalRules,
  type LocalRuleHit,
} from './local-rules';
import { isRestrictedBrand } from './restricted-brands';
import type { RiskLevel } from './risk-types';

const RULE_TO_KIND: Record<string, InfringementDecision['kind']> = {
  'brand-owner-high': 'brand_owner',
  'sensitive-category-high': 'brand_owner',
  'counterfeit-language': 'brand_owner',
};

export class InfringementEngine {
  constructor(private readonly provider: TextModelProvider) {}

  async analyze(
    product: RiskRelevantProduct,
    signal: AbortSignal,
  ): Promise<InfringementDecision> {
    const fingerprint = riskFingerprint(product);
    const local = evaluateLocalRules(product);

    if (local.effectiveLevel === 'high') {
      const kind = this.kindFromRules(local.hits);
      return {
        level: 'high',
        kind,
        fingerprint,
        imagesIncluded: product.imageUrls.length > 0,
        rules: local.hits,
        summary: this.summaryFromRules(local.hits),
        evidence: local.hits.map((hit) => ({
          source: 'text' as const,
          quote: hit.rule,
          explanation: hit.reason,
        })),
        ai: null,
      };
    }

    const aiDecision = await this.runAi(product, signal);

    return {
      level: aiDecision.level,
      kind: aiDecision.kind,
      fingerprint,
      imagesIncluded: product.imageUrls.length > 0,
      rules: local.hits,
      summary: aiDecision.summary,
      evidence: aiDecision.evidence,
      ai: {
        summary: aiDecision.summary,
        evidence: aiDecision.evidence,
        imageEvidence: aiDecision.imageEvidence,
      },
    };
  }

  private async runAi(
    product: RiskRelevantProduct,
    signal: AbortSignal,
  ): Promise<{
    level: RiskLevel;
    kind: InfringementDecision['kind'];
    summary: string;
    evidence: InfringementDecision['evidence'];
    imageEvidence: string[];
  }> {
    const prompt = this.buildPrompt(product);
    const raw = await this.provider.generate(
      { prompt, imageUrls: product.imageUrls },
      signal,
    );
    const parsed = aiInfringementDecisionSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ModelStructuredOutputError('模型结构化输出不符合侵权检测 schema。');
    }
    return parsed.data;
  }

  private buildPrompt(product: RiskRelevantProduct): string {
    const local = evaluateLocalRules(product);
    return [
      '你是美客多平台的侵权风险审核员。判断以下商品的侵权风险等级，只输出 JSON。',
      '',
      '风险等级：none（无）/ low（低）/ medium（中）/ high（高）。',
      '先判断商品是品牌本体（brand_owner）、第三方兼容配件（compatible_accessory）、无品牌（unbranded）还是不确定（unknown）。',
      '高风险仅当满足其一：①品牌为受限品牌列表中的世界知名品牌（如 Disney、Xiaomi、Boss、Fender、大疆 DJI 等）本体或仿冒品；②仿冒/复刻知名品牌商品；③仿冒受保护设计或误导包装。',
      '图片明显可见商品自有商标/Logo，但品牌不在受限列表且非世界知名：应判 low（低风险），不得判 none——有明显商标标识本身构成品牌主张。',
      '图片无明显商标/Logo，或商品无品牌信息：判 none（无风险）。',
      'listing 品牌为 Generic/通用 不改变上述判断；型号与图片品牌一致不构成侵权证据。',
      '兼容配件若仅用品牌名说明适用对象、品牌为真实制造商或 Generic、图片无伪造 Logo，不因品牌词判高风险。',
      '描述中的固定字段（如"有可授权的自有品牌"）与授权无关，不得据此提高风险。',
      '',
      '商品信息：',
      `标题：${product.title ?? ''}`,
      `描述：${product.description ?? ''}`,
      `品牌：${product.brand ?? ''}`,
      `受限品牌列表命中：${isRestrictedBrand(product.brand ?? '') ? '是' : '否'}`,
      `类目：${product.category ?? ''}`,
      `SKU 名称：${product.skuName ?? ''}`,
      product.attributes && Object.keys(product.attributes).length > 0
        ? `属性：${JSON.stringify(product.attributes)}`
        : '',
      local.hits.length > 0
        ? `本地规则命中（供参考，不得静默降级确定的本体高风险）：${local.hits.map((hit) => hit.rule).join('、')}`
        : '',
      '',
      '输出 JSON 结构：{"level":"...","kind":"...","summary":"一句结论","evidence":[{"source":"image|text","quote":"依据片段","explanation":"说明"}],"imageEvidence":["图片证据描述"]}',
      'evidence 至少 1 条。',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private kindFromRules(hits: LocalRuleHit[]): InfringementDecision['kind'] {
    for (const hit of hits) {
      const kind = RULE_TO_KIND[hit.rule];
      if (kind) return kind;
    }
    return 'unknown';
  }

  private summaryFromRules(hits: LocalRuleHit[]): string {
    return hits.map((hit) => hit.reason).join('；');
  }
}
