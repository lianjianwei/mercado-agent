import type { RiskRelevantProduct } from './fingerprint';
import type { CollectBoxDetailDto } from '../../shared/miaoshou-schemas';

// Vision models download each image server-side; an unreachable or non-HTTPS
// URL makes the whole request fail with a 400. Cap the image batch and drop
// tracking/code images so a large collect-box detail cannot break analysis.
const MAX_MODEL_IMAGES = 5;

function isDownloadableImage(url: string): boolean {
  return /^https:\/\//i.test(url);
}

function isTrackingImage(url: string): boolean {
  // Codes/short QR-ish endpoints (e.g. ma.m.1688.com touch code images) are
  // often blocked or tiny tracking tiles; the vision API cannot download them.
  return /\/code\?|sCode/i.test(url);
}

function selectModelImages(urls: string[] | undefined): string[] {
  if (!urls) return [];
  return urls
    .filter((url) => isDownloadableImage(url) && !isTrackingImage(url))
    .slice(0, MAX_MODEL_IMAGES);
}

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
    imageUrls: selectModelImages(info.sourceImgUrls),
  };
}
