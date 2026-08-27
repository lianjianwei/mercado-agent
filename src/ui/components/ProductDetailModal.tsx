import { useEffect, useState } from 'react';

import type { Product, ProductDetail } from '../../domain/product';
import type { ProductApi } from '../../shared/ipc-contract';

type ProductDetailModalProps = {
  product: Product;
  api: ProductApi;
  onClose: () => void;
};

export function ProductDetailModal({
  product,
  api,
  onClose,
}: ProductDetailModalProps) {
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [error, setError] = useState('');
  const [activeImage, setActiveImage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .detail(product.id)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : '商品详情读取失败。');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, product.id]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const mainImage =
    activeImage ?? detail?.mainImage ?? null;

  return (
    <div
      className="detail-modal-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        aria-label="商品详情"
        aria-modal="true"
        className="detail-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="detail-modal-header">
          <div>
            <span className="section-kicker">MIAOSHOU COLLECT BOX</span>
            <h2>商品详情</h2>
          </div>
          <button
            className="secondary-button"
            onClick={onClose}
            type="button"
          >
            关闭
          </button>
        </div>

        {error && <div className="page-error">{error}</div>}
        {!detail && !error && <p className="detail-loading">正在读取商品详情…</p>}

        {detail && (
          <div className="detail-modal-body">
            <div className="detail-gallery">
              {mainImage ? (
                <img
                  alt="商品主图"
                  className="detail-main-image"
                  src={mainImage}
                />
              ) : (
                <div className="detail-main-image detail-main-placeholder">
                  图
                </div>
              )}
              {detail.images.length > 0 && (
                <div className="detail-thumbs">
                  {detail.images.map((url) => (
                    <button
                      className={
                        url === mainImage ? 'detail-thumb active' : 'detail-thumb'
                      }
                      key={url}
                      onClick={() => setActiveImage(url)}
                      type="button"
                    >
                      <img alt="" src={url} />
                    </button>
                  ))}
                </div>
              )}
              <p className="detail-gallery-note">
                共 {detail.images.length} 张 · 仅展示 SKU 选中图片
              </p>
            </div>

            <div className="detail-info">
              <h3 className="detail-title">{detail.title ?? '未命名商品'}</h3>
              <div className="detail-prices">
                <span className="detail-net">净收益 {detail.netProfit ?? '—'}</span>
                <span className="detail-source">货源价 {detail.sourcePrice ?? '—'}</span>
              </div>
              <dl className="detail-meta">
                <div><dt>站点</dt><dd>{detail.sites.join('、') || '—'}</dd></div>
                <div><dt>库存</dt><dd>{detail.stock ?? '—'}</dd></div>
                <div><dt>类目</dt><dd>{detail.category ?? '—'}</dd></div>
                <div><dt>商品编号</dt><dd>{detail.itemNumber ?? detail.productId}</dd></div>
              </dl>

              <section className="detail-description">
                <h3>描述</h3>
                <p>{detail.description ?? '暂无描述'}</p>
              </section>
            </div>
          </div>
        )}

        {detail && (
          <section className="detail-sku-section">
            <h3>SKU 列表</h3>
            {detail.skuList.length === 0 ? (
              <p className="detail-sku-empty">暂无 SKU 数据。</p>
            ) : (
              <table className="detail-sku-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>图片</th>
                    <th>货源价</th>
                    <th>净收益</th>
                    <th>库存</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.skuList.map((sku) => (
                    <tr key={sku.skuKey}>
                      <td>{sku.name ?? sku.skuKey}</td>
                      <td>
                        {sku.imageUrl ? (
                          <img alt="" className="detail-sku-image" src={sku.imageUrl} />
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{sku.sourcePrice ?? '—'}</td>
                      <td>{sku.netProfit ?? '—'}</td>
                      <td>{sku.stock ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
