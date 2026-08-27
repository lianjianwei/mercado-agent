import { useEffect, useRef } from 'react';

type SyncLogPanelProps = {
  lines: string[];
  visible: boolean;
};

export function SyncLogPanel({ lines, visible }: SyncLogPanelProps) {
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [lines]);

  if (!visible) return null;

  return (
    <section className="sync-log-panel" aria-label="同步日志">
      <div className="sync-log-head">
        <strong>同步日志</strong>
        <span>{lines.length} 行</span>
      </div>
      <pre className="sync-log-body" ref={logRef} role="log">
        {lines.length > 0 ? lines.join('\n') : '等待同步进度…'}
      </pre>
    </section>
  );
}
