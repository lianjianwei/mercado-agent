// Shared detail preview component. Renders the product detail / AI draft detail
// from a normalized PreviewViewModel so the 妙手 (read-only) and AI (editable)
// views are pixel-for-pixel identical in layout — only data source and
// per-field editability differ. See MiaoshouView / DraftView for the two
// mappings into this ViewModel.

import { useState } from 'react';

import { Lightbox } from '../../components/Lightbox';
import {
  LISTING_TYPE_LABELS,
  SITE_LABELS,
  normalizeSiteKey,
  type NetProfitBreakdown,
} from '../../../domain/net-profit';
import { NetProfitBreakdownPopover } from './NetProfitBreakdownPopover';

// A single displayed/editable field. `editable` decides input/textarea vs
// read-only span; `multiline` switches input→textarea and adds pre-wrap;
// `onChange` is required when editable.
export type PreviewField = {
  value: string;
  editable: boolean;
  multiline?: boolean;
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

export type PreviewSiteNetProfitCell = {
  netProfit: string; // e.g. '15.47'; '' 表示该站点无值
  listingTypeLabel: string; // '经典' | '铂金'(找不到时回退默认「经典」)
  detail: NetProfitBreakdown | null; // 计算明细,有值时单元格显示「计算详情」入口
};

export type PreviewSiteNetProfitRow = {
  skuKey: string;
  skuLabel: string;
  imageUrl: string | null;
  cells: PreviewSiteNetProfitCell[];
};

export type PreviewSiteNetProfitColumn = {
  code: string; // 裸站点码,如 'MX'
  label: string; // 展示名,如 '墨西哥'
};

// 站点净收益矩阵:行 = SKU,列 = 站点,单元格 = { 净收益, 产品类型 }。
export type PreviewSiteNetProfit = {
  columns: PreviewSiteNetProfitColumn[];
  rows: PreviewSiteNetProfitRow[];
};

export type PreviewGlobalNetProfit = { value: string; currency: string };

export type PreviewViewModel = {
  editable: boolean;
  title: PreviewField;
  description: PreviewField;
  attributes: PreviewAttribute[]; // 类目 & 属性
  skus: PreviewSku[]; // SKU 信息
  siteNetProfit: PreviewSiteNetProfit; // 站点净收益矩阵
  globalNetProfit: PreviewGlobalNetProfit | null;
};

export function fieldLine(value: string | null | undefined): string {
  return value ? String(value) : '—';
}

function siteLabel(siteKey: string): string {
  return SITE_LABELS[normalizeSiteKey(siteKey)] ?? siteKey;
}

function listingTypeLabel(listingType: string | undefined): string {
  return listingType ? (LISTING_TYPE_LABELS[listingType] ?? listingType) : '—';
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
  // 所有缩略图共享一个灯箱:点击任意图片放大到正常尺寸查看。
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const zoom = (url: string) => setLightboxSrc(url);

  // 净收益计算详情浮层:锚定在触发按钮旁,至多一个同时打开。
  const [breakdown, setBreakdown] = useState<{
    detail: NetProfitBreakdown;
    anchor: { left: number; top: number; width: number; height: number };
  } | null>(null);
  const showBreakdown = (
    detail: NetProfitBreakdown,
    anchor: { left: number; top: number; width: number; height: number },
  ) => setBreakdown({ detail, anchor });

  return (
    <div className="detail-preview">
      <ProductInfoSection vm={vm} />
      <AttributesSection attributes={vm.attributes} />
      <SkuSection vm={vm} onZoom={zoom} />
      <GlobalNetProfitSection globalNetProfit={vm.globalNetProfit} />
      <SiteNetProfitSection siteNetProfit={vm.siteNetProfit} onZoom={zoom} onShowBreakdown={showBreakdown} />
      <ImagesSection skus={vm.skus} onZoom={zoom} />
      {breakdown && (
        <NetProfitBreakdownPopover
          anchor={breakdown.anchor}
          detail={breakdown.detail}
          onClose={() => setBreakdown(null)}
        />
      )}
      <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  );
}

// 可点击放大的缩略图:无图时显示占位。按钮包裹以便聚焦/键盘操作。
function ZoomableImage({
  src,
  className,
  onZoom,
}: {
  src: string | null;
  className: string;
  onZoom: (url: string) => void;
}) {
  if (!src) return <span className="sku-thumb-placeholder">—</span>;
  return (
    <button type="button" className="image-zoom-button" onClick={() => onZoom(src)}>
      <img alt="" className={className} src={src} />
    </button>
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
    </div>
  );
}

// 表格单元格字段:无 label(单元格有列头),仅控件(保持 aria-label 供测试/
// 无障碍),只读时保留单位后缀。
function renderCellField(
  label: string,
  field: PreviewField,
  opts: { inputId?: string; suffix?: string; unitClass?: string } = {},
) {
  const inputId = opts.inputId;
  const suffix = opts.suffix ?? '';
  if (field.editable && field.onChange) {
    return (
      <input
        aria-label={label}
        id={inputId}
        onChange={(event) => field.onChange!(event.target.value)}
        value={field.value}
      />
    );
  }
  return (
    <span className={`edit-readonly-value ${opts.unitClass ?? ''}`}>
      {field.value || '—'}
      {suffix}
    </span>
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
            </div>
          </div>
        )}
        <div className="attr-pair">
          {pairs.map((item) => (
            <div className="attr-item" key={item.label}>
              <label>{item.label}</label>
              <div className="attr-value">
                <span className="edit-readonly-value">{item.field.value || '—'}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SkuSection({
  vm,
  onZoom,
}: {
  vm: PreviewViewModel;
  onZoom: (url: string) => void;
}) {
  if (vm.skus.length === 0) {
    return (
      <section className="detail-section">
        <h3>SKU 信息</h3>
        <p className="empty-risk">暂无 SKU 数据。</p>
      </section>
    );
  }
  // 参照妙手 SKU 表格:图片预览 / 颜色 / 货源价 / 库存 / 包装尺寸 / 计费重量。
  // 去掉平台SKU、UPC、操作列。
  return (
    <section className="detail-section">
      <h3>SKU 信息</h3>
      <table className="sku-table">
        <thead>
          <tr>
            <th>图片预览</th>
            <th>SKU 名称</th>
            <th>货源价</th>
            <th>库存</th>
            <th>包装尺寸（cm）</th>
            <th>计费重量（g）</th>
          </tr>
        </thead>
        <tbody>
          {vm.skus.map((sku) => (
            <tr key={sku.skuKey}>
              <td>
                <ZoomableImage src={sku.images[0] ?? null} className="sku-thumb" onZoom={onZoom} />
              </td>
              <td>
                <div className="sku-cell-field">
                  {renderCellField('SKU 名称', sku.name, { inputId: `edit-sku-name-${sku.skuKey}` })}
                </div>
              </td>
              <td>
                <div className="sku-cell-field">
                  {renderCellField('货源价', sku.sourcePrice, { inputId: `edit-sku-price-${sku.skuKey}` })}
                </div>
              </td>
              <td>
                <div className="sku-cell-field">
                  {renderCellField('库存', sku.stock, { inputId: `edit-sku-stock-${sku.skuKey}` })}
                </div>
              </td>
              <td>
                <div className="dim-stack">
                  {renderCellField('长度', sku.pkg.length, {
                    inputId: `edit-sku-length-${sku.skuKey}`,
                    suffix: ` ${sku.pkg.dimensionUnit}`,
                  })}
                  {renderCellField('宽度', sku.pkg.width, {
                    inputId: `edit-sku-width-${sku.skuKey}`,
                    suffix: ` ${sku.pkg.dimensionUnit}`,
                  })}
                  {renderCellField('高度', sku.pkg.height, {
                    inputId: `edit-sku-height-${sku.skuKey}`,
                    suffix: ` ${sku.pkg.dimensionUnit}`,
                  })}
                </div>
              </td>
              <td>
                <div className="sku-cell-field">
                  {renderCellField('重量', sku.pkg.weight, {
                    inputId: `edit-sku-weight-${sku.skuKey}`,
                    suffix: ` ${sku.pkg.weightUnit}`,
                  })}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// 全球净收益独立成一块,置于「站点净收益」上方。数值框 + 币种框并排(参照妙手)。
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
        <span className="edit-readonly-value">{globalNetProfit.value}</span>
        <span className="edit-readonly-value global-net-profit-unit">
          {globalNetProfit.currency}
        </span>
      </div>
    </section>
  );
}

function SiteNetProfitSection({
  siteNetProfit,
  onZoom,
  onShowBreakdown,
}: {
  siteNetProfit: PreviewSiteNetProfit;
  onZoom: (url: string) => void;
  onShowBreakdown: (
    detail: NetProfitBreakdown,
    anchor: { left: number; top: number; width: number; height: number },
  ) => void;
}) {
  const { columns, rows } = siteNetProfit;
  if (columns.length === 0 || rows.length === 0) {
    return (
      <section className="detail-section">
        <h3>站点净收益 (USD)</h3>
        <p className="empty-risk">暂无净收益数据。</p>
      </section>
    );
  }
  // 参照妙手矩阵:行 = SKU(图片预览 + SKU),列 = 站点,单元格 = { 净收益, 产品类型 }。
  return (
    <section className="detail-section">
      <h3>站点净收益 (USD)</h3>
      <div className="site-net-profit-scroll">
        <table className="site-net-profit-table">
          <thead>
            <tr>
              <th>图片预览</th>
              <th>SKU</th>
              {columns.map((column) => (
                <th key={column.code}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.skuKey}>
                <td>
                  <ZoomableImage src={row.imageUrl} className="sku-thumb" onZoom={onZoom} />
                </td>
                <td>{row.skuLabel || row.skuKey}</td>
                {row.cells.map((cell, index) => {
                  const detail = cell.detail; // const 便于 TS 从谓词收窄到闭包内。
                  return (
                    <td key={`${row.skuKey}-${index}`} className="site-net-profit-cell">
                      <div className="sn-cell-box">
                        <span className="sn-cell-label">净收益:</span>
                        {cell.netProfit || '—'}
                      </div>
                      <div className="sn-cell-box">
                        <span className="sn-cell-label">产品类型:</span>
                        {cell.listingTypeLabel}
                      </div>
                      {detail && (
                        <button
                          className="sn-cell-detail-button"
                          onClick={(event) =>
                            onShowBreakdown(detail, {
                              left: event.currentTarget.getBoundingClientRect().left,
                              top: event.currentTarget.getBoundingClientRect().top,
                              width: event.currentTarget.getBoundingClientRect().width,
                              height: event.currentTarget.getBoundingClientRect().height,
                            })
                          }
                          type="button"
                        >
                          计算详情
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ImagesSection({
  skus,
  onZoom,
}: {
  skus: PreviewSku[];
  onZoom: (url: string) => void;
}) {
  return (
    <section className="detail-section">
      <h3>产品图片</h3>
      {skus.map((sku) =>
        sku.images.length > 0 ? (
          <div className="sku-images" key={sku.skuKey}>
            <span className="sku-images-label">{sku.name.value || sku.skuKey}</span>
            <div className="images-grid">
              {sku.images.map((url) => (
                <ZoomableImage key={url} src={url} className="product-image-thumb" onZoom={onZoom} />
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

// Build the 站点净收益 matrix (rows = SKU, columns = site) shared by both
// wrappers. `product` 可选:妙手把站点价/产品类型放在产品级(顶层 siteAndPriceMap /
// siteAndListingTypeList),per-SKU 可能为空。取数优先 per-SKU,回退产品级;
// 类型取值:per-SKU → 产品级 → 默认「经典」(妙手默认类型)。
export function buildSiteNetProfit(
  skus: PreviewSku[],
  siteAndPriceMaps: Record<string, string>[],
  siteAndListingTypeInfoMaps: Record<string, { listingType: string }>[],
  product?: {
    siteAndPriceMap?: Record<string, string>;
    listingTypeBySite?: Record<string, string>;
  },
  siteNetProfitDetailMaps?: Record<string, NetProfitBreakdown>[],
): PreviewSiteNetProfit {
  const productPriceMap = product?.siteAndPriceMap ?? {};
  const productListingBySite = product?.listingTypeBySite ?? {};

  // 每个 SKU 的有效站点价表:per-SKU 有值用它,为空则回退产品级(摊到该 SKU)。
  const effectiveMaps = skus.map((_, index) => {
    const perSku = siteAndPriceMaps[index] ?? {};
    return Object.keys(perSku).length > 0 ? perSku : productPriceMap;
  });

  // 列 = 所有 SKU 站点码的并集,按首次出现顺序;label 用首个引入该码的站点名。
  const columns: PreviewSiteNetProfitColumn[] = [];
  const seen = new Set<string>();
  for (const map of effectiveMaps) {
    for (const rawSiteKey of Object.keys(map)) {
      const code = normalizeSiteKey(rawSiteKey);
      if (seen.has(code)) continue;
      seen.add(code);
      columns.push({ code, label: siteLabel(rawSiteKey) });
    }
  }

  const rows: PreviewSiteNetProfitRow[] = skus.map((sku, index) => {
    const map = effectiveMaps[index] ?? {};
    const listingTypeInfoMap = siteAndListingTypeInfoMaps[index] ?? {};
    // 按裸码分桶,便于按列对齐取值。
    const valueByCode = new Map<string, string>();
    for (const [rawSiteKey, value] of Object.entries(map)) {
      valueByCode.set(normalizeSiteKey(rawSiteKey), value);
    }
    const cells = columns.map((column) => {
      const listingType =
        listingTypeInfoMap[column.code]?.listingType
        ?? productListingBySite[column.code]
        ?? 'gold_special';
      return {
        netProfit: valueByCode.get(column.code) ?? '',
        listingTypeLabel: listingTypeLabel(listingType),
        detail: siteNetProfitDetailMaps?.[index]?.[column.code] ?? null,
      };
    });
    return {
      skuKey: sku.skuKey,
      skuLabel: sku.name.value,
      imageUrl: sku.images[0] ?? null,
      cells,
    };
  });

  return { columns, rows };
}
