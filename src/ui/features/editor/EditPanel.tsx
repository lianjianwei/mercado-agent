import { useEffect, useState } from 'react';

import type { EditDraft, EditField } from '../../../domain/edit';
import type { AiImagesResult } from '../../../domain/images';
import type { Product, ProductDetail } from '../../../domain/product';
import type { EditApi, ProductApi } from '../../../shared/ipc-contract';
import { DraftView } from './DraftView';
import { MiaoshouView } from './MiaoshouView';

type EditPanelProps = {
  product: Product;
  api: EditApi;
  loadDetail: ProductApi['detail'];
};

type View = 'miaoshou' | 'aiDraft';

export function EditPanel({ product, api, loadDetail }: EditPanelProps) {
  const [view, setView] = useState<View>('miaoshou');
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatingImages, setGeneratingImages] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imageResult, setImageResult] = useState<AiImagesResult | null>(null);
  const [imageError, setImageError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Load any existing draft plus the Miaoshou detail when the panel opens for
  // a product. The two views compare the miaoshou snapshot with the draft.
  useEffect(() => {
    let cancelled = false;
    void Promise.all([api.draft(product.id), loadDetail(product.id)])
      .then(([existing, loadedDetail]) => {
        if (cancelled) return;
        setDraft(existing);
        setDetail(loadedDetail);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : '编辑详情读取失败。');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [product.id, api, loadDetail]);

  // 打开弹窗时若有已生成的图(未上传/已上传),先把它们显示出来,供「上传到七牛」使用。
  useEffect(() => {
    if (typeof api.images.getImages !== 'function') return;
    let cancelled = false;
    void api.images
      .getImages(product.id)
      .then((images) => {
        if (!cancelled && images) setImageResult(images);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [product.id, api]);

  async function runGenerate() {
    setGenerating(true);
    setError('');
    try {
      const generated = await api.generate(product.id);
      setDraft(generated);
      // 草稿生成后同一动作接着触发图片生成。
      void runGenerateImages();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'AI 编辑草稿生成失败。');
    } finally {
      setGenerating(false);
    }
  }

  async function runGenerateImages() {
    if (!product) return;
    setGeneratingImages(true);
    setImageError('');
    try {
      const result = await api.images.generateImages(product.id);
      setImageResult(result);
      // 生图会把公网 URL 写回草稿的产品图片字段;重取草稿让「产品图片」区显示 AI 图。
      // 仅当草稿存在时替换,避免把当前草稿覆盖成 null。
      const refreshed = await api.draft(product.id);
      if (refreshed) setDraft(refreshed);
    } catch (reason) {
      // 独立于共享 error 横幅(在弹窗内会被遮住):在「图片生成」区就地展示。
      setImageError(reason instanceof Error ? reason.message : '图片生成失败。');
    } finally {
      setGeneratingImages(false);
    }
  }

  async function runUpload() {
    if (!product) return;
    setUploading(true);
    setImageError('');
    try {
      const result = await api.images.uploadImages(product.id);
      setImageResult(result);
      // 上传后公网 URL 已写回 AI 草稿;重取草稿让「产品图片」区显示。
      const refreshed = await api.draft(product.id);
      if (refreshed) setDraft(refreshed);
    } catch (reason) {
      setImageError(reason instanceof Error ? reason.message : '已有图片上传到七牛失败。');
    } finally {
      setUploading(false);
    }
  }

  async function runSave() {
    if (!draft) return;
    setSaving(true);
    setError('');
    try {
      const saved = await api.saveDraft(product.id, draft);
      setDraft(saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '编辑草稿保存失败。');
    } finally {
      setSaving(false);
    }
  }

  // Mark a field as user-edited when its input changes.
  function updateField(field: EditField, value: string): EditField {
    return {
      value,
      source: 'user',
      confidence: 1,
    };
  }

  function updateDraftField(path: 'title' | 'description' | 'brand' | 'model', value: string) {
    if (!draft) return;
    setDraft({
      ...draft,
      [path]: updateField(draft[path], value),
    });
  }

  function updateSkuField(
    skuKey: string,
    path: 'name' | 'stock' | 'sourcePrice',
    value: string,
  ) {
    if (!draft) return;
    setDraft({
      ...draft,
      skus: draft.skus.map((sku) =>
        sku.skuKey === skuKey
          ? { ...sku, [path]: updateField(sku[path], value) }
          : sku,
      ),
    });
  }

  function updateSkuPackage(
    skuKey: string,
    field: 'length' | 'width' | 'height' | 'weight',
    value: string,
  ) {
    if (!draft) return;
    setDraft({
      ...draft,
      skus: draft.skus.map((sku) =>
        sku.skuKey === skuKey
          ? {
              ...sku,
              package: {
                ...sku.package,
                [field]: updateField(sku.package[field], value),
              },
            }
          : sku,
      ),
    });
  }

  return (
    <div className="edit-panel">
      <div className="edit-header">
        <div>
          <span className="section-kicker">AI EDIT</span>
          <h2>{product.title ?? '未命名商品'}</h2>
          <code className="product-id" title="产品 ID">{product.id}</code>
        </div>
      </div>

      {error && <div className="page-error">{error}</div>}

      {loading && <p className="detail-loading">正在读取妙手详情…</p>}

      {!loading && (
        <div className="edit-view-tabs" role="tablist" aria-label="编辑视图">
          <button
            aria-selected={view === 'miaoshou'}
            className={view === 'miaoshou' ? 'edit-view-tab active' : 'edit-view-tab'}
            onClick={() => setView('miaoshou')}
            role="tab"
            type="button"
          >
            妙手详情
          </button>
          {draft && (
            <button
              aria-selected={view === 'aiDraft'}
              className={view === 'aiDraft' ? 'edit-view-tab active' : 'edit-view-tab'}
              onClick={() => setView('aiDraft')}
              role="tab"
              type="button"
            >
              AI 编辑详情
            </button>
          )}
        </div>
      )}

      {!loading && view === 'miaoshou' && (
        <MiaoshouView
          detail={detail}
          generating={generating}
          hasDraft={!!draft}
          onGenerate={() => void runGenerate()}
        />
      )}

      {!loading && draft && view === 'aiDraft' && (
        <DraftView
          detail={detail}
          draft={draft}
          generating={generating}
          generatingImages={generatingImages}
          uploadingImages={uploading}
          imageError={imageError}
          imageResult={imageResult}
          onGenerate={() => void runGenerate()}
          onRetryImages={() => void runGenerateImages()}
          onUploadImages={() => void runUpload()}
          onSave={() => void runSave()}
          onUpdateField={updateDraftField}
          onUpdateSkuField={updateSkuField}
          onUpdateSkuPackage={updateSkuPackage}
          saving={saving}
        />
      )}
    </div>
  );
}
