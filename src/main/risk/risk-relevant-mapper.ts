import type { RiskRelevantProduct } from './fingerprint';
import type { CollectBoxDetailDto } from '../../shared/miaoshou-schemas';

function flattenAttributes(
  attributes: Array<{ name?: string; values?: Array<{ name?: string }> }> | undefined,
): Record<string, string | null> {
  if (!attributes) return {};
  const result: Record<string, string | null> = {};
  for (const attribute of attributes) {
    const name = attribute.name;
    if (!name) continue;
    const values = attribute.values
      ?.map((value) => value.name)
      .filter((value): value is string => Boolean(value))
      .join(' ');
    result[name] = values ?? null;
  }
  return result;
}

export function riskRelevantProductFromDetail(
  detail: CollectBoxDetailDto,
): RiskRelevantProduct {
  const info = detail.siteCollectItemInfo;
  const brandAttribute =
    info.attributes?.find(
      (attribute) =>
        attribute.name?.toLowerCase().includes('brand')
        || attribute.name?.toLowerCase().includes('marca'),
    );
  return {
    title: info.title ?? null,
    description: info.notes ?? info.notesFull ?? null,
    brand: brandAttribute?.values?.[0]?.name ?? null,
    category: info.cid ? String(info.cid) : null,
    attributes: flattenAttributes(info.attributes),
    skuName: info.firstSkuKey ?? null,
    imageUrls: info.sourceImgUrls ?? [],
  };
}
