// 妙手详情 view: read-only mapping of the ProductDetail snapshot into the
// shared DetailPreview ViewModel. No meta pills, no editable inputs. The
// generate-AI-draft prompt lives here (below the shared component) since it is
// a 妙手-view action, not part of the shared layout.

import type { ProductDetail } from '../../../domain/product';
import {
  DetailPreview,
  buildSiteNetProfit,
  fieldLine,
  type PreviewField,
  type PreviewGlobalNetProfit,
  type PreviewViewModel,
} from './DetailPreview';

type MiaoshouViewProps = {
  detail: ProductDetail | null;
};

const readonly = (value: string | null | undefined): PreviewField => ({
  value: fieldLine(value),
  editable: false,
});

function toViewModel(detail: ProductDetail): PreviewViewModel {
  // 产品级全球净收益:妙手产品级 netProfit 每个产品都有(来自 product 行)。
  const globalNetProfit: PreviewGlobalNetProfit | null = detail.netProfit
    ? { value: detail.netProfit, currency: 'USD' }
    : null;

  const skus = detail.skuList.map((sku) => ({
    skuKey: sku.skuKey,
    name: readonly(sku.name),
    sourcePrice: readonly(sku.sourcePrice),
    stock: readonly(sku.stock),
    pkg: {
      length: readonly(sku.length),
      width: readonly(sku.width),
      height: readonly(sku.height),
      weight: readonly(sku.weight),
      dimensionUnit: sku.dimensionUnit ?? 'cm',
      weightUnit: sku.weightUnit ?? 'g',
    },
    images: sku.imageUrls.length > 0 ? sku.imageUrls : sku.imageUrl ? [sku.imageUrl] : [],
  }));

  const siteAndPriceMaps = detail.skuList.map((sku) => sku.siteAndPriceMap);
  const listingTypeMaps = detail.skuList.map((sku) => sku.siteAndListingTypeInfoMap);

  return {
    editable: false,
    title: readonly(detail.title),
    description: { value: fieldLine(detail.description), editable: false, multiline: true },
    attributes: [
      { label: '类目', field: readonly(detail.category) },
      { label: '品牌', field: readonly(detail.brand) },
      { label: '型号', field: readonly(detail.model) },
    ],
    skus,
    siteNetProfit: buildSiteNetProfit(skus, siteAndPriceMaps, listingTypeMaps, {
      siteAndPriceMap: detail.siteAndPriceMap,
      listingTypeBySite: detail.listingTypeBySite,
    }, undefined, detail.sites),
    globalNetProfit,
  };
}

export function MiaoshouView({ detail }: MiaoshouViewProps) {
  const vm = detail ? toViewModel(detail) : null;

  return (
    <div className="edit-miaoshou" aria-label="妙手详情">
      {vm ? (
        <DetailPreview vm={vm} />
      ) : (
        <p className="detail-loading">暂无可显示的妙手详情。</p>
      )}

      <p className="edit-note">
        妙手详情是商品在妙手的原始数据，同步后即可查看，无需先生成 AI 草稿。
      </p>
    </div>
  );
}
