import { useEffect, useState } from 'react';

import type { InfringementRun } from '../../domain/infringement';
import type { Product } from '../../domain/product';
import type { InfringementApi, ProductApi } from '../../shared/ipc-contract';
import type { RiskLevel } from '../../shared/infringement-schema';
import './infringement.css';

type InfringementPageProps = {
  api?: {
    products: ProductApi;
    infringement: InfringementApi;
  };
};

const levelLabels: Record<RiskLevel, string> = {
  none: '无风险',
  low: '低风险',
  medium: '中风险',
  high: '高风险',
};

function levelPillClass(level: RiskLevel): string {
  return `risk-pill risk-${level}`;
}

const kindLabels: Record<InfringementRun['kind'], string> = {
  brand_owner: '品牌本体',
  compatible_accessory: '兼容配件',
  unbranded: '无品牌',
  unknown: '不确定',
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function InfringementPage({ api }: InfringementPageProps) {
  const productApi = api?.products ?? window.mercado.products;
  const infringementApi = api?.infringement ?? window.mercado.infringement;

  const [products, setProducts] = useState<Product[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runsFor, setRunsFor] = useState<{ productId: string; runs: InfringementRun[]; current: InfringementRun | null } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [continueEditId, setContinueEditId] = useState<string | null>(null);

  const selectedProduct =
    products.find((item) => item.id === selectedId) ?? products[0] ?? null;

  useEffect(() => {
    let cancelled = false;
    productApi
      .page({ offset: 0, limit: 100 })
      .then((page) => {
        if (!cancelled) {
          setProducts(page.items);
          setSelectedId((currentId) => currentId ?? page.items[0]?.id ?? null);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : '商品列表读取失败。');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [productApi]);

  useEffect(() => {
    if (!selectedProduct) return;
    let cancelled = false;
    const productId = selectedProduct.id;
    void Promise.all([
      infringementApi.history(productId),
      infringementApi.current(productId),
    ])
      .then(([history, latest]) => {
        if (!cancelled) setRunsFor({ productId, runs: history, current: latest });
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : '检测历史读取失败。');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProduct, infringementApi]);

  const loaded =
    selectedProduct && runsFor?.productId === selectedProduct.id ? runsFor : null;
  const runs = loaded?.runs ?? [];
  const current = loaded?.current ?? null;

  async function runAnalysis() {
    if (!selectedProduct) return;
    setAnalyzing(true);
    setError('');
    setContinueEditId(null);
    try {
      const latest = await infringementApi.analyze(selectedProduct.id);
      const history = await infringementApi.history(selectedProduct.id);
      setRunsFor({ productId: selectedProduct.id, runs: history, current: latest });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '侵权检测未完成。');
    } finally {
      setAnalyzing(false);
    }
  }

  function recordContinueEdit() {
    setContinueEditId(selectedProduct?.id ?? null);
  }

  if (loading) {
    return <section className="infringement-page"><p className="infringement-loading">正在读取商品列表…</p></section>;
  }

  return (
    <section className="infringement-page">
      {error && <div className="page-error">{error}</div>}

      <div className="infringement-layout">
        <section className="risk-product-list" aria-label="待检测商品">
          <div className="risk-list-header">
            <span className="section-kicker">INFRINGEMENT REVIEW</span>
            <h2>待检测商品</h2>
          </div>
          <div className="risk-product-table-wrap">
            <table className="risk-product-table">
              <thead>
                <tr>
                  <th>商品</th>
                  <th>当前风险</th>
                </tr>
              </thead>
              <tbody>
                {products.length === 0 ? (
                  <tr><td colSpan={2}>暂无商品，请先同步。</td></tr>
                ) : (
                  products.map((item) => {
                    const latest = runs.find((run) => run.productId === item.id);
                    return (
                      <tr
                        className={selectedProduct?.id === item.id ? 'selected' : ''}
                        key={item.id}
                        onClick={() => setSelectedId(item.id)}
                      >
                        <td>{item.title ?? '未命名商品'}</td>
                        <td>
                          {latest ? (
                            <span className={levelPillClass(latest.level)}>
                              {levelLabels[latest.level]}
                            </span>
                          ) : (
                            <span className="muted-pill">未检测</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="risk-detail" aria-label="风险详情">
          {selectedProduct ? (
            <>
              <div className="risk-detail-header">
                <div>
                  <span className="section-kicker">SELECTED PRODUCT</span>
                  <h2>{selectedProduct.title ?? '未命名商品'}</h2>
                </div>
                <button
                  className="primary-button"
                  disabled={analyzing}
                  onClick={() => void runAnalysis()}
                  type="button"
                >
                  {analyzing ? '分析中…' : '分析侵权风险'}
                </button>
              </div>

              {current && (
                <section className="current-decision" aria-label="当前检测结论">
                  <div className="current-decision-row">
                    <span className={levelPillClass(current.level)}>
                      {levelLabels[current.level]}
                    </span>
                    <span className="kind-pill">{kindLabels[current.kind]}</span>
                    <span className="version-pill">V{current.version}</span>
                  </div>
                  <p>{current.decision.summary}</p>

                  {current.decision.rules.length > 0 && (
                    <div className="rule-hits">
                      <h3>本地规则命中</h3>
                      <ul>
                        {current.decision.rules.map((rule) => (
                          <li key={rule.rule}>
                            <code>{rule.rule}</code> — {rule.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {current.decision.evidence.length > 0 && (
                    <div className="evidence-list">
                      <h3>证据</h3>
                      <ul>
                        {current.decision.evidence.map((evidence, index) => (
                          <li key={`${evidence.source}-${index}`}>
                            <span className={evidence.source === 'image' ? 'evidence-image' : 'evidence-text'}>
                              {evidence.source === 'image' ? '图片' : '文本'}
                            </span>
                            {evidence.quote} — {evidence.explanation}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="continue-edit">
                    <button
                      className="secondary-button"
                      onClick={recordContinueEdit}
                      type="button"
                    >
                      继续编辑
                    </button>
                    {continueEditId === selectedProduct.id && (
                      <span role="status">已记录继续编辑，风险结论不变。</span>
                    )}
                  </div>
                </section>
              )}

              {runs.length > 0 && (
                <section className="run-history" aria-label="检测历史">
                  <h2>检测历史</h2>
                  <table className="run-history-table">
                    <thead>
                      <tr>
                        <th>版本</th>
                        <th>风险</th>
                        <th>时间</th>
                        <th>状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((run) => (
                        <tr key={run.id}>
                          <td>V{run.version}</td>
                          <td>
                            <span className={levelPillClass(run.level)}>
                              {levelLabels[run.level]}
                            </span>
                          </td>
                          <td>{formatDate(run.createdAt)}</td>
                          <td>
                            {current?.id === run.id ? (
                              <span className="current-badge">当前有效</span>
                            ) : (
                              <span className="expired-badge">已过期</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              {!current && runs.length === 0 && (
                <p className="empty-risk">该商品尚无检测结论。点击「分析侵权风险」开始首次检测。</p>
              )}
            </>
          ) : (
            <p>请选择一个商品查看或分析侵权风险。</p>
          )}
        </section>
      </div>
    </section>
  );
}
