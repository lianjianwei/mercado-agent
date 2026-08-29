// Shared detail preview component. Renders the product detail / AI draft detail
// from a normalized PreviewViewModel so the 妙手 (read-only) and AI (editable)
// views are pixel-for-pixel identical in layout — only data source and
// per-field editability differ. See MiaoshouView / DraftView for the two
// mappings into this ViewModel.

import type { EditField } from '../../../domain/edit';
import {
  LISTING_TYPE_LABELS,
  SITE_LABELS,
  normalizeSiteKey,
} from '../../../domain/net-profit';

export type PreviewFieldMeta = {
  source: EditField['source'];
  confidence: number;
};

// A single displayed/editable field. `editable` decides input/textarea vs
// read-only span; `multiline` switches input→textarea and adds pre-wrap; `meta`
// renders the source/confidence pill; `onChange` is required when editable.
export type PreviewField = {
  value: string;
  editable: boolean;
  multiline?: boolean;
  meta?: PreviewFieldMeta;
  onChange?: (value: string) => void;
};

export type PreviewPackage = {
  length: PreviewField;
  width: PreviewField;
  height: PreviewField;
  weight: PreviewField;
  dimensionUnit: string;
  weightUnit: string;
};

export type PreviewSku = {
  skuKey: string;
  name: PreviewField;
  sourcePrice: PreviewField;
  stock: PreviewField;
  pkg: PreviewPackage;
  images: string[];
};

export type PreviewAttribute = {
  label: string;
  field: PreviewField;
};

export type PreviewSiteNetProfitRow = {
  skuKey: string;
  skuLabel: string;
  siteLabel: string;
  listingTypeLabel: string; // '经典' | '铂金' | '—'
  netProfit: string; // e.g. '9'
};

export type PreviewGlobalNetProfit = { value: string; currency: string };

export type PreviewViewModel = {
  editable: boolean;
  title: PreviewField;
  description: PreviewField;
  attributes: PreviewAttribute[]; // 类目 & 属性
  skus: PreviewSku[]; // SKU 信息
  siteNetProfitRows: PreviewSiteNetProfitRow[]; // 站点净收益表
  globalNetProfit: PreviewGlobalNetProfit | null;
};

export const sourceLabels: Record<EditField['source'], string> = {
  remote: '原值',
  ai: 'AI 生成',
  user: '人工修改',
  fixed: '固定值',
};

function sourcePillClass(source: EditField['source']): string {
  return `edit-source edit-source-${source}`;
}

export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

export function fieldLine(value: string | null | undefined): string {
  return value ? String(value) : '—';
}

function siteLabel(siteKey: string): string {
  return SITE_LABELS[normalizeSiteKey(siteKey)] ?? siteKey;
}

function listingTypeLabel(listingType: string | undefined): string {
  return listingType ? (LISTING_TYPE_LABELS[listingType] ?? listingType) : '—';
}

export function FieldMeta({ field }: { field: PreviewFieldMeta }) {
  return (
    <span className={sourcePillClass(field.source)}>
      {sourceLabels[field.source]} · {formatConfidence(field.confidence)}
    </span>
  );
}

// Build the 全球净收益 line from a product-level siteAndPriceMap.妙手原本显示
// 什么就显示什么(有值显示,无值返回 null);AI 传草稿的权威值。不入队不计算。
export function deriveGlobalNetProfit(
  productSiteAndPriceMap: Record<string, string> | undefined,
): PreviewGlobalNetProfit | null {
  const first = productSiteAndPriceMap
    ? Object.values(productSiteAndPriceMap)[0]
    : undefined;
  return first !== undefined && first !== '' ? { value: first, currency: 'USD' } : null;
}

export function DetailPreview({ vm }: { vm: PreviewViewModel }) {
  return (
    <div className="detail-preview">
      <ProductInfoSection vm={vm} />
      <AttributesSection attributes={vm.attributes} />
      <SkuSection vm={vm} />
      <GlobalNetProfitSection globalNetProfit={vm.globalNetProfit} />
      <SiteNetProfitSection rows={vm.siteNetProfitRows} />
      <ImagesSection skus={vm.skus} />
    </div>
  );
}

function renderField(
  label: string,
  field: PreviewField,
  opts: { inputId?: string; suffix?: string; multiline?: boolean } = {},
) {
  const inputId = opts.inputId;
  const suffix = opts.suffix ?? '';
  const multiline = opts.multiline ?? field.multiline;
  let control;
  if (field.editable && field.onChange) {
    if (multiline) {
      control = (
        <textarea
          aria-label={label}
          id={inputId}
          onChange={(event) => field.onChange!(event.target.value)}
          rows={4}
          value={field.value}
        />
      );
    } else {
      control = (
        <input
          aria-label={label}
          id={inputId}
          onChange={(event) => field.onChange!(event.target.value)}
          value={field.value}
        />
      );
    }
  } else {
    control = (
      <span className={multiline ? 'edit-readonly-value multiline' : 'edit-readonly-value'}>
        {field.value || '—'}
        {suffix}
      </span>
    );
  }
  return (
    <div className="edit-draft-field">
      <label htmlFor={inputId}>{label}</label>
      {control}
      {field.meta && <FieldMeta field={field.meta} />}
    </div>
  );
}

function ProductInfoSection({ vm }: { vm: PreviewViewModel }) {
  const { title, description } = vm;
  return (
    <section className="detail-section">
      <h3>商品信息</h3>
      {renderField('标题', title, { inputId: 'edit-title' })}
      {renderField('描述', description, { inputId: 'edit-description', multiline: true })}
    </section>
  );
}

// 类目通常很长,单行横向滚动;品牌/型号短,并排成一行节省空间。
function AttributesSection({ attributes }: { attributes: PreviewAttribute[] }) {
  if (attributes.length === 0) return null;
  const category = attributes.find((item) => item.label === '类目');
  const pairs = attributes.filter((item) => item.label !== '类目');
  return (
    <section className="detail-section">
      <h3>类目 &amp; 属性</h3>
      <div className="attr-grid">
        {category && (
          <div className="attr-item">
            <label>{category.label}</label>
            <div className="attr-value attr-value-scroll">
              <span className="edit-readonly-value">{category.field.value || '—'}</span>
              {category.field.meta && <FieldMeta field={category.field.meta} />}
            </div>
          </div>
        )}
        <div className="attr-pair">
          {pairs.map((item) => (
            <div className="attr-item" key={item.label}>
              <label>{item.label}</label>
              <div className="attr-value">
                <span className="edit-readonly-value">{item.field.value || '—'}</span>
                {item.field.meta && <FieldMeta field={item.field.meta} />}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SkuSection({ vm }: { vm: PreviewViewModel }) {
  if (vm.skus.length === 0) {
    return (
      <section className="detail-section">
        <h3>SKU 信息</h3>
        <p className="empty-risk">暂无 SKU 数据。</p>
      </section>
    );
  }
  return (
    <section className="detail-section">
      <h3>SKU 信息</h3>
      {vm.skus.map((sku) => (
        <div className="edit-sku-card" key={sku.skuKey}>
          <div className="sku-card-top">
            {sku.images[0] && (
              <img alt="" className="sku-thumb" src={sku.images[0]} />
            )}
            <div className="sku-card-fields">
              {renderField('SKU 名称', sku.name, { inputId: `edit-sku-name-${sku.skuKey}` })}
              <div className="sku-fields-row">
                {renderField('货源价', sku.sourcePrice, { inputId: `edit-sku-price-${sku.skuKey}` })}
                {renderField('库存', sku.stock, { inputId: `edit-sku-stock-${sku.skuKey}` })}
              </div>
            </div>
          </div>
          <div className="edit-package-grid">
            {renderField('长度', sku.pkg.length, {
              inputId: `edit-sku-length-${sku.skuKey}`,
              suffix: ` ${sku.pkg.dimensionUnit}`,
            })}
            {renderField('宽度', sku.pkg.width, {
              inputId: `edit-sku-width-${sku.skuKey}`,
              suffix: ` ${sku.pkg.dimensionUnit}`,
            })}
            {renderField('高度', sku.pkg.height, {
              inputId: `edit-sku-height-${sku.skuKey}`,
              suffix: ` ${sku.pkg.dimensionUnit}`,
            })}
            {renderField('重量', sku.pkg.weight, {
              inputId: `edit-sku-weight-${sku.skuKey}`,
              suffix: ` ${sku.pkg.weightUnit}`,
            })}
          </div>
        </div>
      ))}
    </section>
  );
}

// 全球净收益独立成一块,置于「站点净收益」上方。
function GlobalNetProfitSection({
  globalNetProfit,
}: {
  globalNetProfit: PreviewGlobalNetProfit | null;
}) {
  if (!globalNetProfit) return null;
  return (
    <section className="detail-section">
      <h3>全球净收益</h3>
      <div className="global-net-profit">
        <span className="edit-readonly-value">
          ${globalNetProfit.value} {globalNetProfit.currency}
        </span>
      </div>
    </section>
  );
}

function SiteNetProfitSection({ rows }: { rows: PreviewSiteNetProfitRow[] }) {
  return (
    <section className="detail-section">
      <h3>站点净收益</h3>
      {rows.length > 0 ? (
        <table className="net-profit-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>站点</th>
              <th>类型</th>
              <th>净收益</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.skuKey}-${row.siteLabel}-${index}`}>
                <td>{row.skuLabel || row.skuKey}</td>
                <td>{row.siteLabel}</td>
                <td>{row.listingTypeLabel}</td>
                <td>${row.netProfit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-risk">暂无净收益数据。</p>
      )}
    </section>
  );
}

function ImagesSection({ skus }: { skus: PreviewSku[] }) {
  return (
    <section className="detail-section">
      <h3>产品图片</h3>
      {skus.map((sku) =>
        sku.images.length > 0 ? (
          <div className="sku-images" key={sku.skuKey}>
            <span className="sku-images-label">{sku.name.value || sku.skuKey}</span>
            <div className="images-grid">
              {sku.images.map((url) => (
                <img
                  alt=""
                  className="product-image-thumb"
                  key={url}
                  src={url}
                />
              ))}
            </div>
          </div>
        ) : null,
      )}
      {skus.every((sku) => sku.images.length === 0) && (
        <p className="empty-risk">暂无图片。</p>
      )}
    </section>
  );
}

// Re-export a small helper for site row building shared by both wrappers.
export function buildSiteNetProfitRows(
  skus: PreviewSku[],
  siteAndPriceMaps: Record<string, string>[],
  siteAndListingTypeInfoMaps: Record<string, { listingType: string }>[],
): PreviewSiteNetProfitRow[] {
  const rows: PreviewSiteNetProfitRow[] = [];
  skus.forEach((sku, index) => {
    const siteAndPriceMap = siteAndPriceMaps[index] ?? {};
    const listingTypeInfoMap = siteAndListingTypeInfoMaps[index] ?? {};
    for (const [siteKey, value] of Object.entries(siteAndPriceMap)) {
      const code = normalizeSiteKey(siteKey);
      const listingType = listingTypeInfoMap[code]?.listingType;
      rows.push({
        skuKey: sku.skuKey,
        skuLabel: sku.name.value,
        siteLabel: siteLabel(siteKey),
        listingTypeLabel: listingTypeLabel(listingType),
        netProfit: value,
      });
    }
  });
  return rows;
}
