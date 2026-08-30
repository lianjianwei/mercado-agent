import { useEffect, useState } from 'react';

import type { EditDraft, EditField, SkuEditField } from '../../../domain/edit';
import { normalizeSiteKey } from '../../../domain/net-profit';
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

// 找到该 SKU 站点净收益表里对应裸站点码(如 'MX')的完整站点 key(如 'MX(Up)')。
function rawSiteKeyFor(sku: SkuEditField, siteCode: string): string | null {
  for (const key of Object.keys(sku.siteAndPriceMap)) {
    if (normalizeSiteKey(key) === siteCode) return key;
  }
  return null;
}

// 在 SKU 的覆盖表里登记某个站点的编辑,保留该站点已有的 netProfit/listingType。
function withOverride(
  sku: SkuEditField,
  siteCode: string,
  patch: { netProfit?: string; listingType?: string },
): Record<string, { netProfit?: string | null; listingType?: string | null }> {
  const overrides = { ...(sku.siteNetProfitOverrides ?? {}) };
  overrides[siteCode] = { ...(overrides[siteCode] ?? {}), ...patch };
  return overrides;
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
      // 草稿生成后同一动作接着触发生成图片,生成完会自动写回草稿的产品图片(公网 URL)。
      void runGenerateImages();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'AI 编辑草稿生成失败。');
    } finally {
      setGenerating(false);
    }
  }

  async function runGenerateImages() {
    if (!product) return;
    try {
      await api.images.generateImages(product.id);
      // 生图会把公网 URL 写回草稿的产品图片字段;重取草稿让「产品图片」区显示。
      const refreshed = await api.draft(product.id);
      if (refreshed) setDraft(refreshed);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '图片生成失败。');
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

  // 站点净收益编辑:写进该 SKU 的 siteAndPriceMap(立即显示),并登记覆盖,
  // 保存重算时沿用覆盖值(「生成按规则,我编辑按我编辑」)。
  function updateSkuNetProfit(skuKey: string, siteCode: string, value: string) {
    if (!draft) return;
    setDraft({
      ...draft,
      skus: draft.skus.map((sku) => {
        if (sku.skuKey !== skuKey) return sku;
        const rawKey = rawSiteKeyFor(sku, siteCode);
        if (!rawKey) return sku;
        const overrides = withOverride(sku, siteCode, { netProfit: value });
        return { ...sku, siteAndPriceMap: { ...sku.siteAndPriceMap, [rawKey]: value }, siteNetProfitOverrides: overrides };
      }),
    });
  }

  // 产品类型编辑:写进该 SKU 的 siteAndListingTypeInfoMap 并登记覆盖。
  function updateSkuListingType(skuKey: string, siteCode: string, value: string) {
    if (!draft) return;
    setDraft({
      ...draft,
      skus: draft.skus.map((sku) =>
        sku.skuKey === skuKey
          ? {
              ...sku,
              siteAndListingTypeInfoMap: { ...sku.siteAndListingTypeInfoMap, [siteCode]: { listingType: value } },
              siteNetProfitOverrides: withOverride(sku, siteCode, { listingType: value }),
            }
          : sku,
      ),
    });
  }

  // 全球净收益编辑:更新产品级 siteAndPriceMap(所有站点同值)并登记覆盖。
  function updateGlobalNetProfit(value: string) {
    if (!draft) return;
    const sites = draft.sites ?? [];
    const siteAndPriceMap = Object.fromEntries(sites.map((site) => [site, value]));
    setDraft({ ...draft, globalNetProfitOverride: value, siteAndPriceMap });
  }

  return (
    <div className="edit-panel">
      {/* 顶部固定:商品标题 + 视图切换(妙手详情 / AI 编辑详情),切换时不随内容滚动。 */}
      <div className="edit-panel-head">
        <div className="edit-header">
          <div>
            <span className="section-kicker">AI EDIT</span>
            <h2>{product.title ?? '未命名商品'}</h2>
            <code className="product-id" title="产品 ID">{product.id}</code>
          </div>
        </div>

        {error && <div className="page-error">{error}</div>}

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
      </div>

      {/* 内容区:从「商品信息」开始,放不下时滚动。 */}
      <div className="edit-panel-body">
        {loading && <p className="detail-loading">正在读取妙手详情…</p>}

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
            onGenerate={() => void runGenerate()}
            onSave={() => void runSave()}
            onUpdateField={updateDraftField}
            onUpdateSkuField={updateSkuField}
            onUpdateSkuPackage={updateSkuPackage}
            onUpdateSkuNetProfit={updateSkuNetProfit}
            onUpdateSkuListingType={updateSkuListingType}
            onUpdateGlobalNetProfit={updateGlobalNetProfit}
            saving={saving}
          />
        )}
      </div>
    </div>
  );
}
