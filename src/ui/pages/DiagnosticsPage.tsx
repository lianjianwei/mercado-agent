import { useEffect, useState } from 'react';

import type { ProviderKind } from '../../domain/config';
import type { ConnectionResult } from '../../domain/providers';
import type {
  DiagnosticApi,
  DiagnosticSnapshot,
} from '../../shared/ipc-contract';
import './diagnostics.css';

type DiagnosticsPageProps = {
  api?: DiagnosticApi;
};

const platformNames: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
};

export function DiagnosticsPage({ api }: DiagnosticsPageProps) {
  const diagnosticApi = api ?? window.mercado.diagnostics;
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot | null>(null);
  const [error, setError] = useState('');
  const [testing, setTesting] = useState<ProviderKind | null>(null);
  const [results, setResults] = useState<
    Partial<Record<ProviderKind, ConnectionResult>>
  >({});

  useEffect(() => {
    let cancelled = false;
    void diagnosticApi
      .getSnapshot()
      .then((value) => {
        if (!cancelled) setSnapshot(value);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : '读取诊断信息失败。');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [diagnosticApi]);

  async function runTest(kind: ProviderKind) {
    setTesting(kind);
    setError('');
    try {
      const result = await diagnosticApi.testConnection(kind);
      setResults((current) => ({ ...current, [kind]: result }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '连接测试失败。');
    } finally {
      setTesting((current) => (current === kind ? null : current));
    }
  }

  async function cancelTest(kind: ProviderKind) {
    await diagnosticApi.cancelConnection(kind);
  }

  if (!snapshot && !error) {
    return <div className="diagnostics-loading">正在读取本机诊断信息…</div>;
  }

  return (
    <section className="diagnostics-page">
      {error && <div className="page-error">{error}</div>}
      {snapshot && (
        <>
          <section className="diagnostic-card">
            <div className="diagnostic-heading">
              <span className="section-kicker">LOCAL ENVIRONMENT</span>
              <h2>本机环境</h2>
              <p>此页面只显示运行信息和配置完成状态，不展示任何密钥。</p>
            </div>
            <dl className="environment-list">
              <div><dt>应用版本</dt><dd>{snapshot.app.version}</dd></div>
              <div><dt>操作系统</dt><dd>{platformNames[snapshot.app.platform] ?? snapshot.app.platform}</dd></div>
              <div className="database-path"><dt>数据库位置</dt><dd>{snapshot.databasePath}</dd></div>
            </dl>
          </section>

          <section className="diagnostic-card">
            <div className="diagnostic-heading">
              <span className="section-kicker">CONFIGURATION</span>
              <h2>配置完整性</h2>
              <p>“已完成”表示必填字段已保存；妙手与七牛的真实连接将在后续对接任务验证。</p>
            </div>
            <div className="completeness-grid">
              {[
                ['文本模型', snapshot.completeness.textProvider],
                ['生图模型', snapshot.completeness.imageProvider],
                ['妙手 ERP', snapshot.completeness.miaoshou],
                ['七牛云', snapshot.completeness.qiniu],
              ].map(([label, complete]) => (
                <div key={String(label)}>
                  <strong>{label}</strong>
                  <span className={complete ? 'complete' : 'incomplete'}>
                    {complete ? '已完成' : '未完成'}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="diagnostic-card">
            <div className="diagnostic-heading">
              <span className="section-kicker">CONNECTION TEST</span>
              <h2>模型连接测试</h2>
              <p>只测试当前启用配置，并在 15 秒后自动超时。</p>
            </div>
            <div className="connection-grid">
              {(['text', 'image'] as const).map((kind) => {
                const label = kind === 'text' ? '文本模型' : '生图模型';
                const isTesting = testing === kind;
                return (
                  <article key={kind}>
                    <strong>{label}</strong>
                    {results[kind] && (
                      <p className={results[kind]?.ok ? 'test-success' : 'test-failure'} role="status">
                        <span>{results[kind]?.message}</span>
                        <small>
                          （{results[kind]?.latencyMs} ms，
                          {results[kind]?.route === 'http_proxy' ? 'HTTP 代理' : '直连'}）
                        </small>
                      </p>
                    )}
                    <div>
                      <button
                        className="primary-button"
                        type="button"
                        aria-label={`测试${label}连接`}
                        disabled={isTesting}
                        onClick={() => void runTest(kind)}
                      >
                        {isTesting ? '测试中…' : '测试连接'}
                      </button>
                      {isTesting && (
                        <button
                          className="secondary-button"
                          type="button"
                          aria-label={`取消${label}测试`}
                          onClick={() => void cancelTest(kind)}
                        >
                          取消
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
