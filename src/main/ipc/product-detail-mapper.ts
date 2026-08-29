import { normalizeSiteKey } from '../../domain/net-profit';
import type { Product, ProductDetail, ProductDetailSku } from '../../domain/product';
import type { CollectBoxDetailDto } from '../../shared/miaoshou-schemas';

// Build the renderer-facing product detail view from the latest snapshot. The
// snapshot payload is the full Miaoshou detail response; list-only fields that
// live on the products row (category, net profit, stock, sites, source price)
// are taken from the product itself, not the detail.

function stringValue(value: unknown): string | null {
  return value === undefined || value === null ? null : String(value);
}

// 妙手 skuMap[key].siteAndPriceMap 的值可能是数字或字符串,统一转成字符串
// (与草稿 siteAndPriceMap 的字符串格式一致),缺失/异常时返回空对象。
function recordToStrings(record: unknown): Record<string, string> {
  if (!record || typeof record !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
    if (value !== undefined && value !== null) out[key] = String(value);
  }
  return out;
}

// 妙手 skuMap[key].siteAndListingTypeInfoMap 值是 { listingType } 对象;透传
// 成同结构,仅保留有 listingType 字符串的项。
function listingTypeMap(
  record: unknown,
): Record<string, { listingType: string }> {
  if (!record || typeof record !== 'object') return {};
  const out: Record<string, { listingType: string }> = {};
  for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
    if (value && typeof value === 'object') {
      const listingType = (value as { listingType?: unknown }).listingType;
      if (typeof listingType === 'string' && listingType) {
        out[key] = { listingType };
      }
    }
  }
  return out;
}

// Site codes arrive from the detail API as "BR(Up)"; strip the parenthesized
// suffix so they match the bare codes the list API and the workbench use.
function normalizeSites(sites: string[] | undefined): string[] {
  return (sites ?? []).map((site) => site.replace(/\s*\([^)]*\)$/, ''));
}

// 妙手把「产品类型」放在产品级 siteAndListingTypeList([{ site, listingType }]),
// 不在每个 SKU 上。映射成 裸站点码 → listingType 的字典,供站点净收益表取「类型」。
function listingTypeBySite(
  list: { site?: string; listingType?: string }[] | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of list ?? []) {
    if (item?.site && item.listingType) {
      out[normalizeSiteKey(item.site)] = item.listingType;
    }
  }
  return out;
}

function collectImages(
  info: CollectBoxDetailDto['siteCollectItemInfo'],
): string[] {
  const seen = new Set<string>();
  const images: string[] = [];
  for (const sku of Object.values(info.skuMap ?? {})) {
    if (!Array.isArray(sku?.imgUrls)) continue;
    for (const url of sku.imgUrls) {
      if (typeof url !== 'string' || seen.has(url)) continue;
      seen.add(url);
      images.push(url);
    }
  }
  return images;
}

function skuDisplayName(
  skuKey: string,
  info: CollectBoxDetailDto['siteCollectItemInfo'],
): string | null {
  const segments = skuKey.split(';').filter((segment) => segment.length > 0);
  if (segments.length === 0) return null;
  const parts: string[] = [];
  for (const segment of segments) {
    const wanted = `;${segment};`;
    let matched: string | undefined;
    for (const attribute of info.saleAttributes ?? []) {
      const value = attribute.values?.find(
        (candidate) => String(candidate.skuKey) === wanted,
      );
      if (value?.name) {
        matched = value.name;
        break;
      }
    }
    if (matched) parts.push(matched);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function productDetailFromSources(
  product: Product,
  latest: CollectBoxDetailDto | undefined,
): ProductDetail {
  const info = latest?.siteCollectItemInfo;
  const images = info ? collectImages(info) : [];
  const skuList: ProductDetailSku[] = info
    ? Object.entries(info.skuMap ?? {}).map(([key, sku]) => {
        const imageUrls = Array.isArray(sku?.imgUrls)
          ? sku.imgUrls.filter((url: unknown): url is string => typeof url === 'string')
          : [];
        return {
          skuKey: key,
          name:
            skuDisplayName(key, info)
            ?? stringValue(sku?.itemNum)
            ?? null,
          imageUrl: imageUrls.length > 0 ? imageUrls[0] : null,
          stock: stringValue(sku?.stock),
          sourcePrice: stringValue(sku?.originPrice),
          netProfit: null,
          length: stringValue(sku?.length),
          width: stringValue(sku?.width),
          height: stringValue(sku?.height),
          dimensionUnit: stringValue(sku?.lengthWidthHeightUnit),
          weight: stringValue(sku?.weight),
          weightUnit: stringValue(sku?.weightUnit),
          siteAndPriceMap: recordToStrings(sku?.siteAndPriceMap),
          siteAndListingTypeInfoMap: listingTypeMap(sku?.siteAndListingTypeInfoMap),
          imageUrls,
        };
      })
    : [];

  const detailSites = info?.sites && info.sites.length > 0
    ? normalizeSites(info.sites)
    : product.sites;

  return {
    productId: product.id,
    title: info?.title ?? product.title,
    description: info?.notes ?? info?.notesFull ?? null,
    itemNumber: info?.itemNum ?? product.itemNumber,
    category: product.category,
    sites: detailSites,
    stock: product.stock,
    netProfit: product.netProfit,
    sourcePrice: product.sourcePrice,
    mainImage: product.thumbnailUrl ?? images[0] ?? null,
    images,
    skuList,
    brand: brandOf(info),
    model: modelOf(info),
    siteAndPriceMap: info?.siteAndPriceMap
      ? recordToStrings(info.siteAndPriceMap)
      : {},
    listingTypeBySite: listingTypeBySite(info?.siteAndListingTypeList),
  };
}

// Brand and model are optional product attributes in the detail response;
// extract them so the workbench can show them alongside the AI edit draft.
function brandOf(
  info: CollectBoxDetailDto['siteCollectItemInfo'] | undefined,
): string | null {
  return attributeOf(info, ['brand', 'marca', '品牌']);
}

function modelOf(
  info: CollectBoxDetailDto['siteCollectItemInfo'] | undefined,
): string | null {
  return attributeOf(info, ['model', 'modelo', '型号']);
}

function attributeOf(
  info: CollectBoxDetailDto['siteCollectItemInfo'] | undefined,
  names: string[],
): string | null {
  const attribute = info?.attributes?.find((candidate) => {
    const name = candidate.name?.toLowerCase() ?? '';
    return names.some((wanted) => name.includes(wanted));
  });
  return attribute?.values?.[0]?.name ?? null;
}
