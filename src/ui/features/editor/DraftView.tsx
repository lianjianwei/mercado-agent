// AI 编辑详情 view: editable mapping of the EditDraft into the shared
// DetailPreview ViewModel. Wires onChange to the existing update handlers and
// renders the regenerate/save footer. Images are resolved by skuKey from the
// 妙手 ProductDetail (the draft keeps the same skuKeys); the draft itself
// carries no images.

import type { EditDraft, EditField } from '../../../domain/edit';
import type { AiImagesResult } from '../../../domain/images';
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
  onGenerate: () => void;
  onRetryImages: () => void;
  onSave: () => void;
  generating: boolean;
  generatingImages: boolean;
  imageError: string;
  imageResult: AiImagesResult | null;
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
  // 没有时回退妙手原图。
  const draftImagesBySku = new Map<string, string[]>();
  for (const sku of draft.skus) {
    const urls = sku.imageUrls ?? [];
    if (urls.length > 0) draftImagesBySku.set(sku.skuKey, urls);
  }
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
    images: draftImagesBySku.get(sku.skuKey) ?? miaoshouImagesBySku.get(sku.skuKey) ?? [],
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

// 图片生成进度区:主图 + 详情图缩略图,带生成状态。生成后可重试。
// error 就地展示(不与弹窗后方的 page-error 横幅混淆),方便排查接口返回的错误。
function ImageProgress({
  result,
  generating,
  error,
  onRetry,
}: {
  result: AiImagesResult | null;
  generating: boolean;
  error: string;
  onRetry: () => void;
}) {
  const images = result ? [...result.mainImages, ...result.detailImages] : [];
  return (
    <section className="image-progress">
      <h3>图片生成</h3>
      {generating && <p className="image-progress-line">图片生成中…</p>}
      {!generating && images.length === 0 && !error && (
        <p className="empty-risk">暂无生成图片。</p>
      )}
      {error && <p className="image-progress-error">{error}</p>}
      {images.length > 0 && (
        <div className="image-progress-grid">
          {images.map((image) => (
            <div
              className={`image-progress-item image-status-${image.status}`}
              key={image.imageId}
            >
              <img alt="" className="image-progress-thumb" src={image.publicUrl ?? image.localPath} />
              <span className="image-progress-kind">
                {image.kind === 'main' ? '主图' : '详情图'}
              </span>
              <span className="image-progress-status">
                {image.status === 'ok' ? '成功' : image.status === 'retried' ? '重试' : '失败'}
              </span>
            </div>
          ))}
        </div>
      )}
      <button
        className="secondary-button"
        disabled={generating}
        onClick={onRetry}
        type="button"
      >
        {generating ? '生成中…' : '重新生成图片'}
      </button>
    </section>
  );
}

export function DraftView({
  draft,
  detail,
  onUpdateField,
  onUpdateSkuField,
  onUpdateSkuPackage,
  onGenerate,
  onRetryImages,
  onSave,
  generating,
  generatingImages,
  imageError,
  imageResult,
  saving,
}: DraftViewProps) {
  const vm = toViewModel(draft, detail, {
    onUpdateField,
    onUpdateSkuField,
    onUpdateSkuPackage,
  });

  return (
    <div className="edit-draft-view" aria-label="AI 编辑详情">
      <DetailPreview vm={vm} />

      <ImageProgress error={imageError} result={imageResult} generating={generatingImages} onRetry={onRetryImages} />

      <div className="edit-actions">
        <button
          className="secondary-button"
          disabled={generating}
          onClick={onGenerate}
          type="button"
        >
          {generating ? '生成中…' : '重新生成'}
        </button>
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
