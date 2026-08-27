import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  MiaoshouProductState,
  ProductPage,
  ProductPageQuery,
  ProductSyncSummary,
} from '../../domain/product';
import type { ProductApi } from '../../shared/ipc-contract';
import './workbench.css';

type WorkbenchPageProps = {
  api?: ProductApi;
};

type ProductFilter = MiaoshouProductState | 'all';

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

const tabs: Array<{ id: ProductFilter; label: string }> = [
  { id: 'notPublished', label: stateLabels.notPublished },
  { id: 'timingPublish', label: stateLabels.timingPublish },
  { id: 'published', label: stateLabels.published },
  { id: 'missing', label: stateLabels.missing },
  { id: 'all', label: '全部记录' },
];

function pageQuery(filter: ProductFilter, offset: number): ProductPageQuery {
  return filter === 'all'
    ? { offset, limit: PAGE_SIZE }
    : { state: filter, offset, limit: PAGE_SIZE };
}

function countQuery(filter: ProductFilter): ProductPageQuery {
  return filter === 'all'
    ? { offset: 0, limit: 1 }
    : { state: filter, offset: 0, limit: 1 };
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
  return `同步完成：发现 ${summary.discovered}，成功 ${summary.succeeded}，失败 ${summary.failed}，缺失 ${summary.missing}。`;
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
    return { discovered: 0, succeeded: 0, failed: 0, missing: 0, failures: [] };
  },
  async reconcileTracked() {
    return { discovered: 0, succeeded: 0, failed: 0, missing: 0, failures: [] };
  },
  async syncOne() {
    return { status: 'deleted' };
  },
};

export function WorkbenchPage({ api }: WorkbenchPageProps) {
  const productApi =
    api ?? (typeof window === 'undefined' ? ssrProductApi : window.mercado.products);
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

  const selectedProduct = useMemo(
    () => page?.items.find((item) => item.id === selectedId) ?? page?.items[0] ?? null,
    [page, selectedId],
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

  async function runDefaultSync() {
    setSyncing(true);
    setError('');
    setSyncSummary(null);
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
        <button
          className="primary-button"
          disabled={syncing}
          onClick={() => void runDefaultSync()}
          type="button"
        >
          {syncing ? '同步中...' : '同步未发布商品'}
        </button>
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
              <h2>{filter === 'all' ? '全部本地记录' : stateLabels[filter]}</h2>
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
            <table className="product-table">
              <thead>
                <tr>
                  <th>商品</th>
                  <th>状态</th>
                  <th>编号</th>
                  <th>侵权</th>
                  <th>编辑</th>
                  <th>最后同步</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7}>正在读取本地商品...</td></tr>
                ) : page && page.items.length > 0 ? (
                  page.items.map((product) => (
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
                      <td>
                        <span className={`state-pill ${product.state}`}>
                          {stateLabels[product.state]}
                        </span>
                      </td>
                      <td>{product.itemNumber ?? product.id}</td>
                      <td><span className="muted-pill">未检测</span></td>
                      <td><span className="muted-pill">未编辑</span></td>
                      <td>{formatDate(product.lastSyncedAt)}</td>
                      <td>
                        <button
                          className="secondary-button row-sync-button"
                          disabled={syncingOneId === product.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            void runSyncOne(product.id);
                          }}
                          type="button"
                        >
                          {syncingOneId === product.id ? '同步中…' : '同步'}
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={7}>暂无本地商品记录</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="quick-inspection" aria-label="快速检查详情">
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
                <div><dt>侵权检测</dt><dd>未检测</dd></div>
                <div><dt>编辑草稿</dt><dd>未编辑</dd></div>
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
        </aside>
      </div>
    </section>
  );
}
