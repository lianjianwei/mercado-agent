// AI 编辑详情 view: editable mapping of the EditDraft into the shared
// DetailPreview ViewModel. Wires onChange to the existing update handlers and
// renders the regenerate/save footer. Images are resolved by skuKey from the
// 妙手 ProductDetail (the draft keeps the same skuKeys); the draft itself
// carries no images.

import type { EditDraft, EditField } from '../../../domain/edit';
import type { ProductDetail } from '../../../domain/product';
import {
  DetailPreview,
  buildSiteNetProfit,
  deriveGlobalNetProfit,
  fieldLine,
  type PreviewField,
  type PreviewViewModel,
} from './DetailPreview';

type FieldPath = 'title' | 'description' | 'brand' | 'model';
type SkuFieldPath = 'name' | 'stock' | 'sourcePrice';
type SkuPackagePath = 'length' | 'width' | 'height' | 'weight';

type DraftViewProps = {
  draft: EditDraft;
  detail: ProductDetail | null;
  onUpdateField: (path: FieldPath, value: string) => void;
  onUpdateSkuField: (skuKey: string, path: SkuFieldPath, value: string) => void;
  onUpdateSkuPackage: (skuKey: string, field: SkuPackagePath, value: string) => void;
  // 净收益/产品类型/全球净收益编辑(AI 编辑详情可改,妙手详情只读)。
  onUpdateSkuNetProfit?: (skuKey: string, siteCode: string, value: string) => void;
  onUpdateSkuListingType?: (skuKey: string, siteCode: string, value: string) => void;
  onUpdateGlobalNetProfit?: (value: string) => void;
  onSave: () => void;
  saving: boolean;
};

function editable(
  field: EditField,
  onChange: (value: string) => void,
  opts: { multiline?: boolean; readonly?: boolean } = {},
): PreviewField {
  return {
    value: field.value,
    editable: !opts.readonly,
    multiline: opts.multiline,
    onChange: opts.readonly ? undefined : onChange,
  };
}

function toViewModel(
  draft: EditDraft,
  detail: ProductDetail | null,
  handlers: Pick<DraftViewProps, 'onUpdateField' | 'onUpdateSkuField' | 'onUpdateSkuPackage'>,
): PreviewViewModel {
  // 全球净收益:AI 用计算器写入的权威值(草稿 siteAndPriceMap 首个非空值)。
  const globalNetProfit = deriveGlobalNetProfit(draft.siteAndPriceMap);

  // AI 生成并上传的图(草稿镜像妙手结构,存于草稿 sku.imageUrls)优先展示;
  // 没有时回退妙手原图。生成的多张「共用详情图」存于草稿产品级 images,
  // 这里一并并进每个 SKU 的图片块(单 SKU 商品即显示全部)。
  const draftImagesBySku = new Map<string, string[]>();
  for (const sku of draft.skus) {
    const urls = sku.imageUrls ?? [];
    if (urls.length > 0) draftImagesBySku.set(sku.skuKey, urls);
  }
  const skuMains = new Set(draft.skus.flatMap((sku) => sku.imageUrls ?? []));
  const sharedDetailUrls = (draft.images ?? []).filter((url) => !skuMains.has(url));
  const miaoshouImagesBySku = new Map<string, string[]>();
  for (const sku of detail?.skuList ?? []) {
    miaoshouImagesBySku.set(sku.skuKey, sku.imageUrls.length > 0 ? sku.imageUrls : sku.imageUrl ? [sku.imageUrl] : []);
  }

  const skus = draft.skus.map((sku) => ({
    skuKey: sku.skuKey,
    name: editable(sku.name, (value) => handlers.onUpdateSkuField(sku.skuKey, 'name', value)),
    sourcePrice: editable(sku.sourcePrice, (value) =>
      handlers.onUpdateSkuField(sku.skuKey, 'sourcePrice', value),
    ),
    stock: editable(sku.stock, (value) => handlers.onUpdateSkuField(sku.skuKey, 'stock', value)),
    pkg: {
      length: editable(sku.package.length, (value) =>
        handlers.onUpdateSkuPackage(sku.skuKey, 'length', value),
      ),
      width: editable(sku.package.width, (value) =>
        handlers.onUpdateSkuPackage(sku.skuKey, 'width', value),
      ),
      height: editable(sku.package.height, (value) =>
        handlers.onUpdateSkuPackage(sku.skuKey, 'height', value),
      ),
      weight: editable(sku.package.weight, (value) =>
        handlers.onUpdateSkuPackage(sku.skuKey, 'weight', value),
      ),
      dimensionUnit: 'cm',
      weightUnit: 'g',
    },
    images: [
      ...(draftImagesBySku.get(sku.skuKey) ?? miaoshouImagesBySku.get(sku.skuKey) ?? []),
      ...sharedDetailUrls,
    ],
  }));

  const siteAndPriceMaps = draft.skus.map((sku) => sku.siteAndPriceMap);
  const listingTypeMaps = draft.skus.map((sku) => sku.siteAndListingTypeInfoMap);
  // 计算明细:旧草稿可能缺失,回退空表(单元格无「计算详情」入口)。
  const detailMaps = draft.skus.map((sku) => sku.siteNetProfitDetail ?? {});

  return {
    editable: true,
    title: editable(draft.title, (value) => handlers.onUpdateField('title', value)),
    description: editable(draft.description, (value) => handlers.onUpdateField('description', value), {
      multiline: true,
    }),
    attributes: [
      { label: '类目', field: { value: fieldLine(detail?.category), editable: false } },
      // 品牌是固定值(Generic),只读。
      { label: '品牌', field: editable(draft.brand, () => undefined, { readonly: true }) },
      { label: '型号', field: editable(draft.model, (value) => handlers.onUpdateField('model', value)) },
    ],
    skus,
    siteNetProfit: buildSiteNetProfit(skus, siteAndPriceMaps, listingTypeMaps, undefined, detailMaps, draft.sites),
    globalNetProfit,
  };
}

export function DraftView({
  draft,
  detail,
  onUpdateField,
  onUpdateSkuField,
  onUpdateSkuPackage,
  onUpdateSkuNetProfit,
  onUpdateSkuListingType,
  onUpdateGlobalNetProfit,
  onSave,
  saving,
}: DraftViewProps) {
  const vm = toViewModel(draft, detail, {
    onUpdateField,
    onUpdateSkuField,
    onUpdateSkuPackage,
  });

  return (
    <div className="edit-draft-view" aria-label="AI 编辑详情">
      <DetailPreview
        vm={vm}
        onEditNetProfit={onUpdateSkuNetProfit}
        onEditListingType={onUpdateSkuListingType}
        onEditGlobalNetProfit={onUpdateGlobalNetProfit}
      />

      <div className="edit-actions">
        <button
          className="primary-button"
          disabled={saving}
          onClick={onSave}
          type="button"
        >
          {saving ? '保存中…' : '保存草稿'}
        </button>
      </div>

      <p className="edit-note">
        保存草稿仅写入本地 AI 编辑快照，不会保存到妙手。编辑与发布严格分离。
      </p>
    </div>
  );
}
