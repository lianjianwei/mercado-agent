import type { RiskLevel } from './risk-types';
import { isRestrictedBrand } from './restricted-brands';
import type { RiskRelevantProduct } from './fingerprint';

export type LocalRulesInput = RiskRelevantProduct & {
  explicitProductKind?: 'product' | 'accessory';
};

export type LocalRuleHit = {
  rule: string;
  level: RiskLevel;
  reason: string;
};

export type LocalRulesResult = {
  hits: LocalRuleHit[];
  effectiveLevel: RiskLevel;
  needsAiReview: boolean;
  aiContext: string;
};

// Words that indicate the item is a third-party compatible accessory rather
// than the brand owner's product. Chinese and English, covering the文档
// (适用于 / 兼容) and the design spec (compatible with / for).
const COMPATIBLE_PATTERNS =
  /适用于|兼容|compatible\s+with|\bfor\b|\bfor\s+use\s+with\b|\bfits\b|\bdesigned\s+for\b|\bcompat\b/i;

// Language that implies counterfeiting / replica. 同款 / 一模一样 are common
// in normal descriptions (e.g. "XX 同款手机壳"), so they are deliberately
// excluded — they are not reliable counterfeit signals.
const COUNTERFEIT_PATTERNS =
  /仿品|复刻|高仿|山寨|knock\s*off|replica|fake|copy|imitation|仿冒/i;

// Categories most commonly affected by brand protection actions per the
// official note (Technology, Fashion & Beauty, Skin Care).
const SENSITIVE_CATEGORY_PATTERNS =
  /fashion|beauty|clothing|apparel|skin|cosmetic|美妆|服饰|服装|护肤|科技|电子/i;

function accessorySignal(input: LocalRulesInput): boolean {
  if (input.explicitProductKind === 'accessory') return true;
  if (input.explicitProductKind === 'product') return false;
  const isGenericBrand = /generic|无品牌/i.test(input.brand ?? '');
  const mentionsCompatibility = COMPATIBLE_PATTERNS.test(input.title ?? '');
  const brandNotRestricted = !isRestrictedBrand(input.brand);
  return isGenericBrand && brandNotRestricted && mentionsCompatibility;
}

export function evaluateLocalRules(input: LocalRulesInput): LocalRulesResult {
  const hits: LocalRuleHit[] = [];
  const brand = input.brand ?? '';
  const brandIsRestricted = isRestrictedBrand(brand);
  const isAccessory = accessorySignal(input);
  const hasCounterfeit = COUNTERFEIT_PATTERNS.test(`${input.title} ${input.description ?? ''}`);
  const sensitiveCategory = SENSITIVE_CATEGORY_PATTERNS.test(input.category ?? '');

  if (brandIsRestricted && !isAccessory) {
    hits.push({
      rule: 'brand-owner-high',
      level: 'high',
      reason: `受限品牌 ${brand} 本体商品默认高风险。`,
    });
  }

  if (hasCounterfeit) {
    hits.push({
      rule: 'counterfeit-language',
      level: 'high',
      reason: '标题或描述含仿冒/复刻等表述，建议人工复核。',
    });
  }

  if (brandIsRestricted && sensitiveCategory && !isAccessory) {
    hits.push({
      rule: 'sensitive-category-high',
      level: 'high',
      reason: '受限品牌命中敏感类目（时尚/美妆/服饰/护肤/电子）。',
    });
  }

  const highHit = hits.some((hit) => hit.level === 'high');
  const effectiveLevel: RiskLevel = highHit ? 'high' : 'none';
  const needsAiReview =
    brandIsRestricted || hasCounterfeit || isAccessory || !brandIsRestricted;

  const aiContext = [
    `品牌：${brand || '未提供'}`,
    `类目：${input.category || '未提供'}`,
    `标题：${input.title || ''}`,
    isAccessory ? '判定：疑似第三方兼容配件' : brandIsRestricted ? '判定：疑似品牌本体' : '判定：未命中受限品牌',
    hits.length > 0 ? `本地规则命中：${hits.map((hit) => hit.rule).join('、')}` : '本地规则无命中',
  ].join('\n');

  return { hits, effectiveLevel, needsAiReview, aiContext };
}
