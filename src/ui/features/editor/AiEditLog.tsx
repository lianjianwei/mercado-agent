// AI 编辑日志:固定在编辑弹窗底部的滚动区,实时展示编辑/生图每一步的进度与耗时。
// 与页面级的 LogPanel(同步/侵权/发布)不同,这里是弹窗内嵌的轻量日志,只收 AI 编辑相关行。

import { useEffect, useRef } from 'react';

type AiEditLogProps = {
  lines: string[];
};

export function AiEditLog({ lines }: AiEditLogProps) {
  const bodyRef = useRef<HTMLPreElement>(null);

  // 新行落盘后自动滚到底部,用户无需手动翻页。
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [lines]);

  if (lines.length === 0) return null;

  return (
    <section className="ai-edit-log" aria-label="AI 编辑日志">
      <div className="ai-edit-log-head">
        <strong>AI 编辑日志</strong>
        <span>{lines.length} 行</span>
      </div>
      <pre className="ai-edit-log-body" ref={bodyRef} role="log">
        {lines.join('\n')}
      </pre>
    </section>
  );
}
