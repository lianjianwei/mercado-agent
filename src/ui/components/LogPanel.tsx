import { useEffect, useRef } from 'react';

export type LogKind = 'sync' | 'infringement' | 'publish';

type LogPanelProps = {
  logs: Record<LogKind, string[]>;
  active: LogKind;
  onSelectTab: (kind: LogKind) => void;
};

const tabLabels: Record<LogKind, string> = {
  sync: '同步日志',
  infringement: '侵权检测日志',
  publish: '发布日志',
};

const emptyHints: Record<LogKind, string> = {
  sync: '等待同步进度…',
  infringement: '等待侵权检测…',
  publish: '等待发布日志…',
};

export const logTabs: Array<{ id: LogKind; label: string }> = [
  { id: 'sync', label: tabLabels.sync },
  { id: 'infringement', label: tabLabels.infringement },
  { id: 'publish', label: tabLabels.publish },
];

export function LogPanel({ logs, active, onSelectTab }: LogPanelProps) {
  const logRef = useRef<HTMLPreElement>(null);
  const lines = logs[active];
  const hasAny = logTabs.some((tab) => logs[tab.id].length > 0);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [lines]);

  if (!hasAny) return null;

  return (
    <section className="log-panel" aria-label="操作日志">
      <div className="log-tabs" role="tablist" aria-label="日志分类">
        {logTabs.map((tab) => (
          <button
            aria-selected={active === tab.id}
            className={active === tab.id ? 'log-tab active' : 'log-tab'}
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            role="tab"
            type="button"
          >
            {tab.label}
            {logs[tab.id].length > 0 ? ` ${logs[tab.id].length}` : ''}
          </button>
        ))}
      </div>
      <div className="log-head">
        <strong>{tabLabels[active]}</strong>
        <span>{lines.length} 行</span>
      </div>
      <pre className="log-body" ref={logRef} role="log">
        {lines.length > 0 ? lines.join('\n') : emptyHints[active]}
      </pre>
    </section>
  );
}
