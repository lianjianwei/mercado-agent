import { useEffect, useState } from 'react';

import type { EditDraft, EditField } from '../../../domain/edit';
import {
  LISTING_TYPE_LABELS,
  SITE_LABELS,
  normalizeSiteKey,
} from '../../../domain/net-profit';
import type { Product, ProductDetail } from '../../../domain/product';
import type { EditApi, ProductApi } from '../../../shared/ipc-contract';

type EditPanelProps = {
  product: Product;
  api: EditApi;
  loadDetail: ProductApi['detail'];
};

type View = 'miaoshou' | 'aiDraft';

const sourceLabels: Record<EditField['source'], string> = {
  remote: '原值',
  ai: 'AI 生成',
  user: '人工修改',
  fixed: '固定值',
};

function sourcePillClass(source: EditField['source']): string {
  return `edit-source edit-source-${source}`;
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function fieldLine(value: string | null | undefined): string {
  return value ? String(value) : '—';
}

export function EditPanel({ product, api, loadDetail }: EditPanelProps) {
  const [view, setView] = useState<View>('miaoshou');
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
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

  async function runGenerate() {
    setGenerating(true);
    setError('');
    try {
      const generated = await api.generate(product.id);
      setDraft(generated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'AI 编辑草稿生成失败。');
    } finally {
      setGenerating(false);
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

  const mainImage = detail?.mainImage ?? product.thumbnailUrl;

  return (
    <div className="edit-panel">
      <div className="edit-header">
        <div>
          <span className="section-kicker">AI EDIT</span>
          <h2>{product.title ?? '未命名商品'}</h2>
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
        <div className="edit-miaoshou" aria-label="妙手详情">
          {mainImage && <img alt="" className="edit-main-image" src={mainImage} />}

          <div className="edit-draft-field">
            <label>标题</label>
            <span className="edit-readonly-value">{fieldLine(detail?.title)}</span>
          </div>

          <div className="edit-draft-field">
            <label>描述</label>
            <span className="edit-readonly-value">{fieldLine(detail?.description)}</span>
          </div>

          <div className="edit-draft-field">
            <label>品牌</label>
            <span className="edit-readonly-value">{fieldLine(detail?.brand)}</span>
          </div>

          <div className="edit-draft-field">
            <label>型号</label>
            <span className="edit-readonly-value">{fieldLine(detail?.model)}</span>
          </div>

          {!draft && !generating && (
            <div className="edit-generate-prompt">
              <p>该商品尚无 AI 编辑草稿。可先查看下方妙手原数据，或点击「生成 AI 草稿」创建标题、描述、品牌、型号与 SKU 信息。草稿不会写入妙手。</p>
              <button
                className="primary-button"
                disabled={generating}
                onClick={() => void runGenerate()}
                type="button"
              >
                {generating ? '生成中…' : '生成 AI 草稿'}
              </button>
            </div>
          )}

          <section className="edit-sku-section">
            <h3>SKU（妙手原数据）</h3>
            {detail?.skuList && detail.skuList.length > 0 ? (
              detail.skuList.map((sku) => (
                <div className="edit-sku-card" key={sku.skuKey}>
                  <h3>
                    SKU <code>{sku.skuKey}</code>
                  </h3>
                  <div className="edit-draft-field">
                    <label>SKU 名称</label>
                    <span className="edit-readonly-value">{fieldLine(sku.name)}</span>
                  </div>
                  <div className="edit-draft-field">
                    <label>库存</label>
                    <span className="edit-readonly-value">{fieldLine(sku.stock)}</span>
                  </div>
                  <div className="edit-draft-field">
                    <label>货源价</label>
                    <span className="edit-readonly-value">{fieldLine(sku.sourcePrice)}</span>
                  </div>
                  <div className="edit-package-grid">
                    <div className="edit-draft-field">
                      <label>长度</label>
                      <span className="edit-readonly-value">
                        {fieldLine(sku.length)}{sku.dimensionUnit ? ` ${sku.dimensionUnit}` : ''}
                      </span>
                    </div>
                    <div className="edit-draft-field">
                      <label>宽度</label>
                      <span className="edit-readonly-value">
                        {fieldLine(sku.width)}{sku.dimensionUnit ? ` ${sku.dimensionUnit}` : ''}
                      </span>
                    </div>
                    <div className="edit-draft-field">
                      <label>高度</label>
                      <span className="edit-readonly-value">
                        {fieldLine(sku.height)}{sku.dimensionUnit ? ` ${sku.dimensionUnit}` : ''}
                      </span>
                    </div>
                    <div className="edit-draft-field">
                      <label>重量</label>
                      <span className="edit-readonly-value">
                        {fieldLine(sku.weight)}{sku.weightUnit ? ` ${sku.weightUnit}` : ''}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="empty-risk">暂无 SKU 数据。</p>
            )}
          </section>

          <p className="edit-note">
            妙手详情是商品在妙手的原始数据，同步后即可查看，无需先生成 AI 草稿。
          </p>
        </div>
      )}

      {!loading && draft && view === 'aiDraft' && (
        <div className="edit-draft-view" aria-label="AI 编辑详情">
          <div className="edit-draft-field">
            <label htmlFor="edit-title">标题（≤60 字符）</label>
            <input
              id="edit-title"
              maxLength={60}
              onChange={(event) => updateDraftField('title', event.target.value)}
              value={draft.title.value}
            />
            <FieldMeta field={draft.title} />
          </div>

          <div className="edit-draft-field">
            <label htmlFor="edit-description">描述</label>
            <textarea
              id="edit-description"
              onChange={(event) => updateDraftField('description', event.target.value)}
              rows={4}
              value={draft.description.value}
            />
            <FieldMeta field={draft.description} />
          </div>

          <div className="edit-draft-field">
            <label>品牌</label>
            {/* Brand is a fixed value (Generic), consistent with the Miaoshou
                view showing it as read-only. */}
            <span className="edit-readonly-value">{fieldLine(draft.brand.value)}</span>
            <FieldMeta field={draft.brand} />
          </div>

          <div className="edit-draft-field">
            <label htmlFor="edit-model">型号</label>
            <input
              id="edit-model"
              onChange={(event) => updateDraftField('model', event.target.value)}
              value={draft.model.value}
            />
            <FieldMeta field={draft.model} />
          </div>

          {Object.values(draft.siteAndPriceMap ?? {})[0] !== undefined && (
            <div className="edit-draft-field edit-global-net-profit">
              <label>全球净收益</label>
              <span className="edit-readonly-value">
                ${Object.values(draft.siteAndPriceMap ?? {})[0]} USD
              </span>
            </div>
          )}

          {draft.skus.map((sku) => (
            <section className="edit-sku-card" key={sku.skuKey}>
              <h3>
                SKU <code>{sku.skuKey}</code>
              </h3>
              {/* Same field order as the Miaoshou view: name, stock, source
                  price, then a 2x2 package grid. Units are fixed constants
                  shown via the field labels (cm/g). */}
              <div className="edit-draft-field">
                <label htmlFor={`edit-sku-name-${sku.skuKey}`}>SKU 名称</label>
                <input
                  id={`edit-sku-name-${sku.skuKey}`}
                  onChange={(event) =>
                    updateSkuField(sku.skuKey, 'name', event.target.value)
                  }
                  value={sku.name.value}
                />
                <FieldMeta field={sku.name} />
              </div>
              <div className="edit-draft-field">
                <label htmlFor={`edit-sku-price-${sku.skuKey}`}>货源价</label>
                <input
                  id={`edit-sku-price-${sku.skuKey}`}
                  onChange={(event) =>
                    updateSkuField(sku.skuKey, 'sourcePrice', event.target.value)
                  }
                  value={sku.sourcePrice.value}
                />
                <FieldMeta field={sku.sourcePrice} />
              </div>
              <div className="edit-draft-field">
                <label htmlFor={`edit-sku-stock-${sku.skuKey}`}>库存</label>
                <input
                  id={`edit-sku-stock-${sku.skuKey}`}
                  onChange={(event) =>
                    updateSkuField(sku.skuKey, 'stock', event.target.value)
                  }
                  value={sku.stock.value}
                />
                <FieldMeta field={sku.stock} />
              </div>
              <div className="edit-package-grid">
                <div className="edit-draft-field">
                  <label htmlFor={`edit-sku-length-${sku.skuKey}`}>长度（cm）</label>
                  <input
                    id={`edit-sku-length-${sku.skuKey}`}
                    onChange={(event) =>
                      updateSkuPackage(sku.skuKey, 'length', event.target.value)
                    }
                    value={sku.package.length.value}
                  />
                  <FieldMeta field={sku.package.length} />
                </div>
                <div className="edit-draft-field">
                  <label htmlFor={`edit-sku-width-${sku.skuKey}`}>宽度（cm）</label>
                  <input
                    id={`edit-sku-width-${sku.skuKey}`}
                    onChange={(event) =>
                      updateSkuPackage(sku.skuKey, 'width', event.target.value)
                    }
                    value={sku.package.width.value}
                  />
                  <FieldMeta field={sku.package.width} />
                </div>
                <div className="edit-draft-field">
                  <label htmlFor={`edit-sku-height-${sku.skuKey}`}>高度（cm）</label>
                  <input
                    id={`edit-sku-height-${sku.skuKey}`}
                    onChange={(event) =>
                      updateSkuPackage(sku.skuKey, 'height', event.target.value)
                    }
                    value={sku.package.height.value}
                  />
                  <FieldMeta field={sku.package.height} />
                </div>
                <div className="edit-draft-field">
                  <label htmlFor={`edit-sku-weight-${sku.skuKey}`}>重量（g）</label>
                  <input
                    id={`edit-sku-weight-${sku.skuKey}`}
                    onChange={(event) =>
                      updateSkuPackage(sku.skuKey, 'weight', event.target.value)
                    }
                    value={sku.package.weight.value}
                  />
                  <FieldMeta field={sku.package.weight} />
                </div>
              </div>
              <div className="edit-net-profit">
                <h4>净收益</h4>
                {Object.entries(sku.siteAndPriceMap ?? {}).map(([siteKey, value]) => {
                  const siteCode = normalizeSiteKey(siteKey);
                  const listingType = sku.siteAndListingTypeInfoMap?.[siteCode]?.listingType;
                  return (
                    <div className="edit-net-profit-row" key={siteKey}>
                      <span className="net-profit-site">{siteLabel(siteKey)}</span>
                      <span className="net-profit-type">{listingTypeLabel(listingType)}</span>
                      <span className="net-profit-value">${value}</span>
                    </div>
                  );
                })}
                {Object.keys(sku.siteAndPriceMap ?? {}).length === 0 && (
                  <p className="empty-risk">暂无净收益数据。</p>
                )}
              </div>
            </section>
          ))}

          <div className="edit-actions">
            <button
              className="secondary-button"
              disabled={generating}
              onClick={() => void runGenerate()}
              type="button"
            >
              {generating ? '生成中…' : '重新生成'}
            </button>
            <button
              className="primary-button"
              disabled={saving}
              onClick={() => void runSave()}
              type="button"
            >
              {saving ? '保存中…' : '保存草稿'}
            </button>
          </div>

          <p className="edit-note">
            保存草稿仅写入本地 AI 编辑快照，不会保存到妙手。编辑与发布严格分离。
          </p>
        </div>
      )}
    </div>
  );
}

function siteLabel(siteKey: string): string {
  return SITE_LABELS[normalizeSiteKey(siteKey)] ?? siteKey;
}

function listingTypeLabel(listingType: string | undefined): string {
  return listingType ? (LISTING_TYPE_LABELS[listingType] ?? listingType) : '—';
}

function FieldMeta({ field }: { field: EditField }) {
  return (
    <span className={sourcePillClass(field.source)}>
      {sourceLabels[field.source]} · {formatConfidence(field.confidence)}
    </span>
  );
}
