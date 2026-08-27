import type { Product, ProductDetail, ProductDetailSku } from '../../domain/product';
import type { CollectBoxDetailDto } from '../../shared/miaoshou-schemas';

// Build the renderer-facing product detail view from the latest snapshot. The
// snapshot payload is the full Miaoshou detail response; list-only fields that
// live on the products row (category, net profit, stock, sites, source price)
// are taken from the product itself, not the detail.

function stringValue(value: unknown): string | null {
  return value === undefined || value === null ? null : String(value);
}

// Site codes arrive from the detail API as "BR(Up)"; strip the parenthesized
// suffix so they match the bare codes the list API and the workbench use.
function normalizeSites(sites: string[] | undefined): string[] {
  return (sites ?? []).map((site) => site.replace(/\s*\([^)]*\)$/, ''));
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
    ? Object.entries(info.skuMap ?? {}).map(([key, sku]) => ({
        skuKey: key,
        name:
          skuDisplayName(key, info)
          ?? stringValue(sku?.itemNum)
          ?? null,
        imageUrl: Array.isArray(sku?.imgUrls) && sku.imgUrls.length > 0
          ? String(sku.imgUrls[0])
          : null,
        stock: stringValue(sku?.stock),
        sourcePrice: null,
        netProfit: null,
      }))
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
  };
}
