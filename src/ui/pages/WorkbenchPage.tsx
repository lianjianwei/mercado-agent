import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  LocalPublishState,
  MiaoshouProductState,
  ProductPage,
  ProductPageQuery,
  ProductSyncSummary,
} from '../../domain/product';
import type { InfringementRun } from '../../domain/infringement';
import type { InfringementApi, ProductApi } from '../../shared/ipc-contract';
import { ProductDetailModal } from '../components/ProductDetailModal';
import {
  RiskReviewPanel,
  levelLabels,
  levelPillClass,
} from '../components/RiskReviewPanel';
import { SyncLogPanel } from '../components/SyncLogPanel';
import './workbench.css';
import './infringement.css';

type WorkbenchPageProps = {
  api?: {
    products: ProductApi;
    infringement: InfringementApi;
  };
};

type ProductFilter = 'notPublished' | 'localPublished';
type RightTab = 'quick' | 'risk' | 'edit' | 'publish';

const PAGE_SIZE = 20;

const stateLabels: Record<MiaoshouProductState, string> = {
  notPublished: '未发布',
  timingPublish: '定时发布',
  published: '已发布历史',
  missing: '远端缺失',
};

const stateDescriptions: Record<MiaoshouProductState, string> = {
  notPublished: '本地待检查，可进入后续流程',
  timingPublish: '妙手定时发布中，只读保留',
  published: '妙手已发布历史，只读保留',
  missing: '远端三状态均未命中，只读保留',
};

const localPublishLabels: Record<LocalPublishState, string> = {
  notPublished: '未发布',
  localPublished: '本地已发布',
  localFailed: '发布失败',
};

const tabs: Array<{ id: ProductFilter; label: string }> = [
  { id: 'notPublished', label: stateLabels.notPublished },
  { id: 'localPublished', label: localPublishLabels.localPublished },
];

const rightTabs: Array<{ id: RightTab; label: string }> = [
  { id: 'quick', label: '快速检查' },
  { id: 'risk', label: '侵权检测' },
  { id: 'edit', label: 'AI编辑' },
  { id: 'publish', label: '发布' },
];

function pageQuery(filter: ProductFilter, offset: number): ProductPageQuery {
  return filter === 'localPublished'
    ? { localPublishState: 'localPublished', offset, limit: PAGE_SIZE }
    : { state: 'notPublished', offset, limit: PAGE_SIZE };
}

function countQuery(filter: ProductFilter): ProductPageQuery {
  return filter === 'localPublished'
    ? { localPublishState: 'localPublished', offset: 0, limit: 1 }
    : { state: 'notPublished', offset: 0, limit: 1 };
}

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

function rangeLabel(page: ProductPage | null): string {
  if (!page || page.total === 0) return '0-0 / 0';
  const start = page.offset + 1;
  const end = Math.min(page.offset + page.items.length, page.total);
  return `${start}-${end} / ${page.total}`;
}

function summaryMessage(summary: ProductSyncSummary): string {
  return `同步完成：发现 ${summary.discovered}，成功 ${summary.succeeded}，失败 ${summary.failed}，耗时 ${formatElapsed(summary.durationMs)}。`;
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder > 0 ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分`;
}

function sitesLabel(sites: string[] | null): string {
  return sites && sites.length > 0 ? sites.join('、') : '—';
}

function localPublishPillClass(state: LocalPublishState): string {
  switch (state) {
    case 'localPublished':
      return 'local-pill published';
    case 'localFailed':
      return 'local-pill failed';
    default:
      return 'local-pill';
  }
}

const ssrProductApi: ProductApi = {
  async page(query) {
    return { items: [], offset: query.offset, limit: query.limit, total: 0 };
  },
  async detail() {
    return {
      productId: '',
      title: null,
      description: null,
      itemNumber: null,
      category: null,
      sites: [],
      stock: null,
      netProfit: null,
      sourcePrice: null,
      mainImage: null,
      images: [],
      skuList: [],
    };
  },
  async syncDefault() {
    return {
      discovered: 0,
      succeeded: 0,
      failed: 0,
      missing: 0,
      failures: [],
      durationMs: 0,
    };
  },
  onSyncLog() {
    return () => undefined;
  },
  async syncOne() {
    return { status: 'deleted' };
  },
  async clear() {
    return undefined;
  },
};

const ssrInfringementApi: InfringementApi = {
  async analyze() {
    throw new Error('侵权检测服务未配置');
  },
  async history() {
    return [];
  },
  async current() {
    return null;
  },
};

export function WorkbenchPage({ api }: WorkbenchPageProps) {
  const productApi =
    api?.products ?? (typeof window === 'undefined' ? ssrProductApi : window.mercado.products);
  const infringementApi =
    api?.infringement ??
    (typeof window === 'undefined'
      ? ssrInfringementApi
      : window.mercado.infringement);

  const [filter, setFilter] = useState<ProductFilter>('notPublished');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<ProductPage | null>(null);
  const [counts, setCounts] = useState<Partial<Record<ProductFilter, number>>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [syncSummary, setSyncSummary] = useState<ProductSyncSummary | null>(null);
  const [syncingOneId, setSyncingOneId] = useState<string | null>(null);
  const [syncOneMessage, setSyncOneMessage] = useState('');
  const [rightTab, setRightTab] = useState<RightTab>('quick');
  const [detailProductId, setDetailProductId] = useState<string | null>(null);
  const [riskByProduct, setRiskByProduct] = useState<
    Record<string, InfringementRun | null>
  >({});
  const [runsFor, setRunsFor] = useState<{
    productId: string;
    runs: InfringementRun[];
    current: InfringementRun | null;
  } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [riskError, setRiskError] = useState('');
  const [continueEditId, setContinueEditId] = useState<string | null>(null);
  const [syncLogLines, setSyncLogLines] = useState<string[]>([]);

  const selectedProduct = useMemo(
    () => page?.items.find((item) => item.id === selectedId) ?? page?.items[0] ?? null,
    [page, selectedId],
  );

  const detailProduct = useMemo(
    () => page?.items.find((item) => item.id === detailProductId) ?? null,
    [page, detailProductId],
  );

  const readCounts = useCallback(async () => {
    const entries = await Promise.all(
      tabs.map(async (tab) => [tab.id, (await productApi.page(countQuery(tab.id))).total] as const),
    );
    return Object.fromEntries(entries) as Partial<Record<ProductFilter, number>>;
  }, [productApi]);

  const readPage = useCallback(async () => {
    return productApi.page(pageQuery(filter, offset));
  }, [filter, offset, productApi]);

  function applyPage(nextPage: ProductPage) {
    setPage(nextPage);
    setSelectedId((current) => {
      if (current && nextPage.items.some((item) => item.id === current)) return current;
      return nextPage.items[0]?.id ?? null;
    });
  }

  useEffect(() => {
    let cancelled = false;
    void readCounts()
      .then((nextCounts) => {
        if (!cancelled) setCounts(nextCounts);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : '商品统计读取失败。');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [readCounts]);

  useEffect(() => {
    let cancelled = false;
    void readPage()
      .then((nextPage) => {
        if (!cancelled) applyPage(nextPage);
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
  }, [readPage]);

  // Load the current risk pill for every product on the page.
  useEffect(() => {
    let cancelled = false;
    if (!page || page.items.length === 0) return;
    void Promise.all(
      page.items.map(async (item) => {
        const run = await infringementApi.current(item.id);
        return [item.id, run] as const;
      }),
    )
      .then((entries) => {
        if (!cancelled) setRiskByProduct(Object.fromEntries(entries));
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : '风险状态读取失败。');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [page, infringementApi]);

  // Load history + current for the selected product into the risk tab.
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
          setRiskError(reason instanceof Error ? reason.message : '检测历史读取失败。');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProduct, infringementApi]);

  // Stream progress log lines from the main process into the sync panel.
  useEffect(() => {
    const unsubscribe = productApi.onSyncLog((line) => {
      setSyncLogLines((current) => [...current, line]);
    });
    return unsubscribe;
  }, [productApi]);

  async function runDefaultSync() {
    setSyncing(true);
    setError('');
    setSyncSummary(null);
    setSyncLogLines([]);
    try {
      const summary = await productApi.syncDefault();
      setSyncSummary(summary);
      setLoading(true);
      const [nextCounts, nextPage] = await Promise.all([readCounts(), readPage()]);
      setCounts(nextCounts);
      applyPage(nextPage);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '商品同步未完成。');
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }

  async function runSyncOne(productId: string) {
    setSyncingOneId(productId);
    setError('');
    setSyncOneMessage('');
    try {
      const result = await productApi.syncOne(productId);
      if (result.status === 'deleted') {
        setSyncOneMessage('该商品已从妙手删除，已移除本地记录。');
        const [nextCounts, nextPage] = await Promise.all([readCounts(), readPage()]);
        setCounts(nextCounts);
        applyPage(nextPage);
      } else {
        setSyncOneMessage(`同步完成：${result.product.title ?? '未命名商品'}`);
        const [nextCounts, nextPage] = await Promise.all([readCounts(), readPage()]);
        setCounts(nextCounts);
        applyPage(nextPage);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '商品同步未完成。');
    } finally {
      setSyncingOneId(null);
    }
  }

  async function runClearData() {
    if (!window.confirm('确定清理本机全部妙手商品数据吗？将删除商品、快照与风险记录，凭证配置会保留。')) {
      return;
    }
    setError('');
    setSyncLogLines([]);
    try {
      await productApi.clear();
      const [nextCounts, nextPage] = await Promise.all([readCounts(), readPage()]);
      setCounts(nextCounts);
      applyPage(nextPage);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '商品数据清理未完成。');
    }
  }

  async function runAnalysis() {
    if (!selectedProduct) return;
    setAnalyzing(true);
    setRiskError('');
    setContinueEditId(null);
    try {
      const latest = await infringementApi.analyze(selectedProduct.id);
      const history = await infringementApi.history(selectedProduct.id);
      setRunsFor({ productId: selectedProduct.id, runs: history, current: latest });
      setRiskByProduct((current) => ({
        ...current,
        [selectedProduct.id]: latest,
      }));
    } catch (reason) {
      setRiskError(reason instanceof Error ? reason.message : '侵权检测未完成。');
    } finally {
      setAnalyzing(false);
    }
  }

  function recordContinueEdit() {
    setContinueEditId(selectedProduct?.id ?? null);
  }

  function openAction(productId: string, tab: RightTab) {
    setSelectedId(productId);
    setRightTab(tab);
  }

  function changeFilter(nextFilter: ProductFilter) {
    setLoading(true);
    setError('');
    setFilter(nextFilter);
    setOffset(0);
  }

  function nextPage() {
    if (!page || offset + PAGE_SIZE >= page.total) return;
    setLoading(true);
    setError('');
    setOffset(offset + PAGE_SIZE);
  }

  function previousPage() {
    setLoading(true);
    setError('');
    setOffset(Math.max(0, offset - PAGE_SIZE));
  }

  const selectedRuns =
    selectedProduct && runsFor?.productId === selectedProduct.id ? runsFor : null;

  return (
    <section className="workbench-page">
      <div className="workbench-toolbar">
        <div className="state-tabs" role="tablist" aria-label="商品状态">
          {tabs.map((tab) => (
            <button
              aria-pressed={filter === tab.id}
              className={filter === tab.id ? 'state-tab active' : 'state-tab'}
              key={tab.id}
              onClick={() => changeFilter(tab.id)}
              type="button"
            >
              {tab.label} {counts[tab.id] ?? '...'}
            </button>
          ))}
        </div>
        <div className="toolbar-actions">
          <button
            className="secondary-button"
            disabled={syncing}
            onClick={() => void runClearData()}
            type="button"
          >
            清理数据
          </button>
          <button
            className="primary-button"
            disabled={syncing}
            onClick={() => void runDefaultSync()}
            type="button"
          >
            {syncing ? '同步中...' : '同步全部'}
          </button>
        </div>
      </div>

      {error && <div className="page-error">{error}</div>}
      {syncOneMessage && (
        <div className="sync-result" role="status">
          <strong>{syncOneMessage}</strong>
        </div>
      )}
      {syncSummary && (
        <div className="sync-result" role="status">
          <strong>{summaryMessage(syncSummary)}</strong>
          {syncSummary.failures.length > 0 && (
            <ul>
              {syncSummary.failures.map((failure) => (
                <li key={failure.id}>
                  {failure.id}：{failure.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="workbench-layout">
        <section className="product-list-panel" aria-label="商品列表">
          <div className="list-header">
            <div>
              <span className="section-kicker">MIAOSHOU COLLECT BOX</span>
              <h2>{filter === 'localPublished' ? '本地已发布' : '未发布商品'}</h2>
            </div>
            <div className="pagination-controls" aria-label="分页">
              <button
                className="secondary-button"
                disabled={offset === 0 || loading}
                onClick={previousPage}
                type="button"
              >
                上一页
              </button>
              <span>{rangeLabel(page)}</span>
              <button
                className="secondary-button"
                disabled={!page || offset + PAGE_SIZE >= page.total || loading}
                onClick={nextPage}
                type="button"
              >
                下一页
              </button>
            </div>
          </div>

          <div className="product-table-wrap">
            <table className="product-table workbench-table">
              <thead>
                <tr>
                  <th>商品</th>
                  <th>类目</th>
                  <th>净收益</th>
                  <th>库存</th>
                  <th>站点</th>
                  <th>货源价</th>
                  <th>本地发布</th>
                  <th>侵权</th>
                  <th>编辑</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={10}>正在读取本地商品...</td></tr>
                ) : page && page.items.length > 0 ? (
                  page.items.map((product) => {
                    const risk = riskByProduct[product.id] ?? null;
                    return (
                      <tr
                        className={selectedProduct?.id === product.id ? 'selected' : ''}
                        key={product.id}
                        onClick={() => setSelectedId(product.id)}
                        tabIndex={0}
                      >
                        <td>
                          <div className="product-title-cell">
                            {product.thumbnailUrl ? (
                              <img alt="" src={product.thumbnailUrl} />
                            ) : (
                              <span aria-hidden="true">图</span>
                            )}
                            <strong>{product.title ?? '未命名商品'}</strong>
                          </div>
                        </td>
                        <td>{product.category ?? '—'}</td>
                        <td>{product.netProfit ?? '—'}</td>
                        <td>{product.stock ?? '—'}</td>
                        <td>{sitesLabel(product.sites)}</td>
                        <td>{product.sourcePrice ?? '—'}</td>
                        <td>
                          <span className={localPublishPillClass(product.localPublishState)}>
                            {localPublishLabels[product.localPublishState]}
                          </span>
                        </td>
                        <td>
                          {risk ? (
                            <span className={levelPillClass(risk.level)}>
                              {levelLabels[risk.level]}
                            </span>
                          ) : (
                            <span className="muted-pill">未检测</span>
                          )}
                        </td>
                        <td><span className="muted-pill">未编辑</span></td>
                        <td>
                          <div className="row-actions">
                            <button
                              className="row-action-button view"
                              onClick={(event) => {
                                event.stopPropagation();
                                setDetailProductId(product.id);
                              }}
                              type="button"
                            >
                              详情
                            </button>
                            <button
                              className="row-action-button"
                              disabled={syncingOneId === product.id}
                              onClick={(event) => {
                                event.stopPropagation();
                                void runSyncOne(product.id);
                              }}
                              type="button"
                            >
                              {syncingOneId === product.id ? '同步中…' : '同步'}
                            </button>
                            <button
                              className="row-action-button risk"
                              onClick={(event) => {
                                event.stopPropagation();
                                openAction(product.id, 'risk');
                              }}
                              type="button"
                            >
                              侵权
                            </button>
                            <button
                              className="row-action-button edit"
                              onClick={(event) => {
                                event.stopPropagation();
                                openAction(product.id, 'edit');
                              }}
                              type="button"
                            >
                              AI编辑
                            </button>
                            <button
                              className="row-action-button publish"
                              onClick={(event) => {
                                event.stopPropagation();
                                openAction(product.id, 'publish');
                              }}
                              type="button"
                            >
                              发布
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr><td colSpan={10}>暂无本地商品记录</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="inspection-panel" aria-label="检查面板">
          <div className="inspection-tabs" role="tablist" aria-label="操作检查">
            {rightTabs.map((tab) => (
              <button
                aria-pressed={rightTab === tab.id}
                aria-selected={rightTab === tab.id}
                className={rightTab === tab.id ? 'inspection-tab active' : 'inspection-tab'}
                key={tab.id}
                onClick={() => setRightTab(tab.id)}
                role="tab"
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>

          {rightTab === 'quick' && (
            <div className="quick-inspection" aria-label="快速检查详情">
              <h2>快速检查</h2>
              {selectedProduct ? (
                <>
                  <div className="inspection-title">
                    <strong>{selectedProduct.title ?? '未命名商品'}</strong>
                    <span>{stateLabels[selectedProduct.state]}</span>
                  </div>
                  <dl>
                    <div><dt>妙手详情 ID</dt><dd>{selectedProduct.id}</dd></div>
                    <div><dt>商品编号</dt><dd>{selectedProduct.itemNumber ?? '未提供'}</dd></div>
                    <div><dt>生命周期</dt><dd>{stateDescriptions[selectedProduct.state]}</dd></div>
                    <div><dt>类目</dt><dd>{selectedProduct.category ?? '—'}</dd></div>
                    <div><dt>净收益</dt><dd>{selectedProduct.netProfit ?? '—'}</dd></div>
                    <div><dt>库存</dt><dd>{selectedProduct.stock ?? '—'}</dd></div>
                    <div><dt>站点</dt><dd>{sitesLabel(selectedProduct.sites)}</dd></div>
                    <div><dt>货源价</dt><dd>{selectedProduct.sourcePrice ?? '—'}</dd></div>
                    <div><dt>本地发布</dt><dd>{localPublishLabels[selectedProduct.localPublishState]}</dd></div>
                    <div><dt>侵权检测</dt><dd>
                      {riskByProduct[selectedProduct.id] ? (
                        <span className={levelPillClass(riskByProduct[selectedProduct.id]!.level)}>
                          {levelLabels[riskByProduct[selectedProduct.id]!.level]}
                        </span>
                      ) : (
                        <span className="muted-pill">未检测</span>
                      )}
                    </dd></div>
                    <div><dt>编辑草稿</dt><dd><span className="muted-pill">未编辑</span></dd></div>
                    <div><dt>最后同步</dt><dd>{formatDate(selectedProduct.lastSyncedAt)}</dd></div>
                  </dl>

                  <section className="readonly-detail" aria-label="只读详情">
                    <h2>只读详情概要</h2>
                    <p>当前任务只读，不编辑、不发布。</p>
                    <dl>
                      <div><dt>商品</dt><dd>{selectedProduct.title ?? '未命名商品'}</dd></div>
                      <div><dt>状态</dt><dd>{stateDescriptions[selectedProduct.state]}</dd></div>
                      <div><dt>快照</dt><dd>已保留本地同步历史</dd></div>
                    </dl>
                  </section>
                </>
              ) : (
                <p>暂无可检查商品。</p>
              )}
            </div>
          )}

          {rightTab === 'risk' && selectedProduct && (
            <RiskReviewPanel
              analyzing={analyzing}
              continueEditId={continueEditId}
              current={selectedRuns?.current ?? null}
              error={riskError}
              onAnalyze={() => void runAnalysis()}
              onContinueEdit={recordContinueEdit}
              product={selectedProduct}
              runs={selectedRuns?.runs ?? []}
            />
          )}
          {rightTab === 'risk' && !selectedProduct && (
            <p className="empty-risk">请选择一个商品查看或分析侵权风险。</p>
          )}

          {rightTab === 'edit' && (
            <div className="placeholder-note">
              <h2>AI 编辑</h2>
              <p>AI 编辑功能将在后续阶段实现。届时可在本面板生成标题、描述、属性、SKU 草稿。</p>
            </div>
          )}

          {rightTab === 'publish' && (
            <div className="placeholder-note">
              <h2>发布</h2>
              <p>发布功能将在后续阶段实现。届时可独立提交发布并追踪妙手异步队列。</p>
            </div>
          )}
        </aside>
      </div>

      <SyncLogPanel lines={syncLogLines} visible={syncLogLines.length > 0} />

      {detailProduct && (
        <ProductDetailModal
          api={productApi}
          onClose={() => setDetailProductId(null)}
          product={detailProduct}
        />
      )}
    </section>
  );
}
