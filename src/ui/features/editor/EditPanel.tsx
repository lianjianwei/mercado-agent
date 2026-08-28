import { useEffect, useState } from 'react';

import type { EditDraft, EditField } from '../../../domain/edit';
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
  const [view, setView] = useState<View>('aiDraft');
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

  function updateSkuName(skuKey: string, value: string) {
    if (!draft) return;
    setDraft({
      ...draft,
      skus: draft.skus.map((sku) =>
        sku.skuKey === skuKey ? { ...sku, name: updateField(sku.name, value) } : sku,
      ),
    });
  }

  function updatePackage(
    field: 'length' | 'width' | 'height' | 'weight',
    value: string,
  ) {
    if (!draft) return;
    setDraft({
      ...draft,
      package: { ...draft.package, [field]: updateField(draft.package[field], value) },
    });
  }

  const mainImage = detail?.mainImage ?? product.thumbnailUrl;

  return (
    <div className="edit-panel" aria-label="AI 编辑">
      <div className="edit-header">
        <div>
          <span className="section-kicker">AI EDIT</span>
          <h2>{product.title ?? '未命名商品'}</h2>
        </div>
        {!draft && (
          <button
            className="primary-button"
            disabled={generating}
            onClick={() => void runGenerate()}
            type="button"
          >
            {generating ? '生成中…' : '生成 AI 草稿'}
          </button>
        )}
      </div>

      {error && <div className="page-error">{error}</div>}

      {loading && <p className="detail-loading">正在读取编辑草稿…</p>}

      {!loading && !draft && !generating && (
        <p className="empty-risk">
          该商品尚无 AI 编辑草稿。点击「生成 AI 草稿」创建标题、描述、品牌、型号、
          SKU 名称、包裹尺寸与计费重量的本地草稿。草稿不会写入妙手。
        </p>
      )}

      {draft && (
        <>
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
            <button
              aria-selected={view === 'aiDraft'}
              className={view === 'aiDraft' ? 'edit-view-tab active' : 'edit-view-tab'}
              onClick={() => setView('aiDraft')}
              role="tab"
              type="button"
            >
              AI 编辑详情
            </button>
          </div>

          {view === 'miaoshou' ? (
            <div className="edit-miaoshou" aria-label="妙手详情">
              <div className="edit-detail-summary">
                {mainImage && <img alt="" className="edit-main-image" src={mainImage} />}
                <dl>
                  <div><dt>标题</dt><dd>{fieldLine(detail?.title)}</dd></div>
                  <div><dt>描述</dt><dd>{fieldLine(detail?.description)}</dd></div>
                  <div><dt>品牌</dt><dd>{fieldLine(detail?.brand)}</dd></div>
                  <div><dt>型号</dt><dd>{fieldLine(detail?.model)}</dd></div>
                  <div><dt>货号</dt><dd>{fieldLine(detail?.itemNumber)}</dd></div>
                  <div><dt>类目</dt><dd>{fieldLine(detail?.category)}</dd></div>
                  <div><dt>站点</dt><dd>{detail?.sites?.length ? detail.sites.join('、') : '—'}</dd></div>
                  <div><dt>库存</dt><dd>{fieldLine(detail?.stock)}</dd></div>
                  <div><dt>货源价</dt><dd>{fieldLine(detail?.sourcePrice)}</dd></div>
                </dl>
              </div>

              {detail?.skuList && detail.skuList.length > 0 && (
                <section className="edit-sku-section">
                  <h3>SKU（妙手）</h3>
                  <table className="edit-sku-table">
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th>名称</th>
                        <th>尺寸</th>
                        <th>重量</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.skuList.map((sku) => (
                        <tr key={sku.skuKey}>
                          <td><code>{sku.skuKey}</code></td>
                          <td>{fieldLine(sku.name)}</td>
                          <td>
                            {[sku.length, sku.width, sku.height].every((value) => value !== null)
                              ? `${sku.length}×${sku.width}×${sku.height} ${sku.dimensionUnit ?? ''}`.trim()
                              : '—'}
                          </td>
                          <td>
                            {sku.weight
                              ? `${sku.weight} ${sku.weightUnit ?? ''}`.trim()
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              <p className="edit-note">
                妙手详情与 AI 编辑草稿一致时，表示草稿已落库为当前内容；不一致时，AI 编辑详情反映待保存的草稿。
              </p>
            </div>
          ) : (
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
                <label htmlFor="edit-brand">品牌</label>
                <input
                  id="edit-brand"
                  onChange={(event) => updateDraftField('brand', event.target.value)}
                  value={draft.brand.value}
                />
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

              {draft.skus.length > 0 && (
                <section className="edit-sku-section">
                  <h3>SKU 名称</h3>
                  {draft.skus.map((sku) => (
                    <div className="edit-draft-field" key={sku.skuKey}>
                      <label htmlFor={`edit-sku-${sku.skuKey}`}>
                        <code>{sku.skuKey}</code>
                      </label>
                      <input
                        id={`edit-sku-${sku.skuKey}`}
                        onChange={(event) => updateSkuName(sku.skuKey, event.target.value)}
                        value={sku.name.value}
                      />
                      <FieldMeta field={sku.name} />
                    </div>
                  ))}
                </section>
              )}

              <section className="edit-sku-section">
                <h3>包裹尺寸与计费重量</h3>
                <div className="edit-package-grid">
                  <div className="edit-draft-field">
                    <label htmlFor="edit-length">长度（cm）</label>
                    <input
                      id="edit-length"
                      onChange={(event) => updatePackage('length', event.target.value)}
                      value={draft.package.length.value}
                    />
                    <FieldMeta field={draft.package.length} />
                  </div>
                  <div className="edit-draft-field">
                    <label htmlFor="edit-width">宽度（cm）</label>
                    <input
                      id="edit-width"
                      onChange={(event) => updatePackage('width', event.target.value)}
                      value={draft.package.width.value}
                    />
                    <FieldMeta field={draft.package.width} />
                  </div>
                  <div className="edit-draft-field">
                    <label htmlFor="edit-height">高度（cm）</label>
                    <input
                      id="edit-height"
                      onChange={(event) => updatePackage('height', event.target.value)}
                      value={draft.package.height.value}
                    />
                    <FieldMeta field={draft.package.height} />
                  </div>
                  <div className="edit-draft-field">
                    <label htmlFor="edit-weight">重量（g）</label>
                    <input
                      id="edit-weight"
                      onChange={(event) => updatePackage('weight', event.target.value)}
                      value={draft.package.weight.value}
                    />
                    <FieldMeta field={draft.package.weight} />
                  </div>
                  <div className="edit-unit-display">
                    <span>尺寸单位</span>
                    <strong>{draft.package.dimensionUnit}</strong>
                  </div>
                  <div className="edit-unit-display">
                    <span>重量单位</span>
                    <strong>{draft.package.weightUnit}</strong>
                  </div>
                </div>
              </section>

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
        </>
      )}
    </div>
  );
}

function FieldMeta({ field }: { field: EditField }) {
  return (
    <span className={sourcePillClass(field.source)}>
      {sourceLabels[field.source]} · {formatConfidence(field.confidence)}
    </span>
  );
}
