// Derive the confirm-dialog change list for 「保存到妙手平台」: which categories the
// current AI draft differs from the Miaoshou detail. The change list is advisory —
// it tells the seller what will be written before they confirm — and only needs to
// be correct enough to warn, since the actual payload is built in the main process.

import type { EditDraft } from '../../../domain/edit';
import type { ProductDetail } from '../../../domain/product';

export function buildSaveChangeList(
  draft: EditDraft,
  detail: ProductDetail | null,
): string[] {
  const lines: string[] = [];

  const detailTitle = detail?.title ?? '';
  if (draft.title?.value && draft.title.value !== detailTitle) lines.push('标题');

  const detailDescription = detail?.description ?? '';
  if (draft.description?.value.trim() && draft.description.value !== detailDescription) {
    lines.push('描述');
  }

  if (draft.brand?.value && detail?.brand && draft.brand.value !== detail.brand) {
    lines.push(`品牌（${draft.brand.value}）`);
  }
  if (draft.model?.value && draft.model.value !== (detail?.model ?? '')) {
    lines.push(`型号（${draft.model.value}）`);
  }

  const origBySku = new Map((detail?.skuList ?? []).map((sku) => [sku.skuKey, sku]));
  const hasSkuFieldChange = (draft.skus ?? []).some((sku) => {
    const orig = origBySku.get(sku.skuKey);
    return (
      sku.name?.value !== (orig?.name ?? '')
      || Boolean(sku.package?.length?.value && sku.package.length.value !== (orig?.length ?? ''))
      || Boolean(sku.package?.width?.value && sku.package.width.value !== (orig?.width ?? ''))
      || Boolean(sku.package?.height?.value && sku.package.height.value !== (orig?.height ?? ''))
      || Boolean(sku.package?.weight?.value && sku.package.weight.value !== (orig?.weight ?? ''))
    );
  });
  if (hasSkuFieldChange) lines.push('SKU 名称 / 包裹尺寸重量');

  // 库存 / 货源价跟随 SKU:草稿值与妙手原值不同才更新(用户用草稿里的库存值控制
  // 库存,草稿库存通常即要推的低库存值)。
  const hasStockSourcePrice = (draft.skus ?? []).some((sku) => {
    const orig = origBySku.get(sku.skuKey);
    const sourcePriceChanged = Boolean(
      sku.sourcePrice?.value?.trim() && sku.sourcePrice.value !== (orig?.sourcePrice ?? ''),
    );
    const stockChanged = Boolean(sku.stock?.value?.trim() && sku.stock.value !== (orig?.stock ?? ''));
    return sourcePriceChanged || stockChanged;
  });
  if (hasStockSourcePrice) lines.push('库存 / 货源价');

  const hasNetProfit =
    (draft.skus ?? []).some((sku) => Object.keys(sku.siteAndPriceMap ?? {}).length > 0)
    || Object.keys(draft.siteAndPriceMap ?? {}).length > 0;
  if (hasNetProfit) lines.push('站点净收益 / 全球净收益');

  const hasListingType = (draft.skus ?? []).some(
    (sku) => Object.keys(sku.siteAndListingTypeInfoMap ?? {}).length > 0,
  );
  if (hasListingType) lines.push('产品类型');

  const hasImages = (draft.skus ?? []).some((sku) => (sku.imageUrls?.length ?? 0) > 0);
  if (hasImages) lines.push('图片（有 AI 生成的图才替换）');

  if (lines.length === 0) lines.push('没有检测到需要保存的变更');

  return lines;
}
