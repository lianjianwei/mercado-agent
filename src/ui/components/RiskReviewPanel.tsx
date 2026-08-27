import type { InfringementRun } from '../../domain/infringement';
import type { Product } from '../../domain/product';
import type { RiskLevel } from '../../shared/infringement-schema';

type RiskReviewPanelProps = {
  product: Product;
  runs: InfringementRun[];
  current: InfringementRun | null;
  analyzing: boolean;
  error: string;
  continueEditId: string | null;
  onAnalyze: () => void;
  onContinueEdit: () => void;
};

export const levelLabels: Record<RiskLevel, string> = {
  none: '无风险',
  low: '低风险',
  medium: '中风险',
  high: '高风险',
};

export function levelPillClass(level: RiskLevel): string {
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

export function RiskReviewPanel({
  product,
  runs,
  current,
  analyzing,
  error,
  continueEditId,
  onAnalyze,
  onContinueEdit,
}: RiskReviewPanelProps) {
  return (
    <div className="risk-review" aria-label="风险详情">
      <div className="risk-detail-header">
        <div>
          <span className="section-kicker">SELECTED PRODUCT</span>
          <h2>{product.title ?? '未命名商品'}</h2>
        </div>
        <button
          className="primary-button"
          disabled={analyzing}
          onClick={onAnalyze}
          type="button"
        >
          {analyzing ? '分析中…' : '分析侵权风险'}
        </button>
      </div>

      {error && <div className="page-error">{error}</div>}

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
                    <span
                      className={
                        evidence.source === 'image'
                          ? 'evidence-image'
                          : 'evidence-text'
                      }
                    >
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
              onClick={onContinueEdit}
              type="button"
            >
              继续编辑
            </button>
            {continueEditId === product.id && (
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
        <p className="empty-risk">
          该商品尚无检测结论。点击「分析侵权风险」开始首次检测。
        </p>
      )}
    </div>
  );
}
