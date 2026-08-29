import { useEffect, useState } from 'react';

import type { FxRates, NetProfitConfig } from '../../../domain/net-profit';
import type { NetProfitApi } from '../../../shared/ipc-contract';

type NetProfitConfigModalProps = {
  api: NetProfitApi;
  onClose: () => void;
};

export function NetProfitConfigModal({ api, onClose }: NetProfitConfigModalProps) {
  const [loaded, setLoaded] = useState(false);
  const [targetMargin, setTargetMargin] = useState('20');
  const [marginMode, setMarginMode] = useState<'income' | 'price'>('price');
  const [classicComm, setClassicComm] = useState('12');
  const [premiumComm, setPremiumComm] = useState('20');
  const [packingCost, setPackingCost] = useState('2.5');
  const [fx, setFx] = useState<FxRates | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .getConfig()
      .then((snapshot) => {
        if (cancelled) return;
        const c: NetProfitConfig = snapshot.config;
        setTargetMargin(String(c.targetMargin));
        setMarginMode(c.marginMode);
        setClassicComm(String(c.commission.classic));
        setPremiumComm(String(c.commission.premium));
        setPackingCost(String(c.packingCost));
        setFx(snapshot.fxRates);
        setLoaded(true);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '配置读取失败。');
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function runSave() {
    setSaving(true);
    setError('');
    try {
      await api.saveConfig({
        targetMargin: Number(targetMargin),
        marginMode,
        commission: { classic: Number(classicComm), premium: Number(premiumComm) },
        packingCost: Number(packingCost),
      });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '配置保存失败。');
      setSaving(false);
    }
  }

  async function runRefresh() {
    setRefreshing(true);
    setError('');
    try {
      setFx(await api.refreshRates());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '汇率刷新失败。');
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="detail-modal-overlay" onClick={onClose} role="presentation">
      <div
        aria-label="利润率配置"
        aria-modal="true"
        className="detail-modal net-profit-config-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="detail-modal-header">
          <div>
            <span className="section-kicker">NET PROFIT</span>
            <h2>利润率配置</h2>
          </div>
          <button className="secondary-button" onClick={onClose} type="button">关闭</button>
        </div>

        {error && <div className="page-error">{error}</div>}
        {!loaded && !error && <p className="detail-loading">正在读取配置…</p>}

        {loaded && (
          <>
            <div className="net-profit-form">
              <div className="edit-draft-field">
                <label htmlFor="np-target">目标利润率（%）</label>
                <input
                  id="np-target"
                  onChange={(event) => setTargetMargin(event.target.value)}
                  value={targetMargin}
                />
              </div>

              <div className="net-profit-mode">
                <span className="net-profit-mode-label">利润率口径</span>
                <label>
                  <input
                    checked={marginMode === 'income'}
                    name="np-mode"
                    onChange={() => setMarginMode('income')}
                    type="radio"
                  />
                  模式一（利润 ÷ 净收益）
                </label>
                <label>
                  <input
                    checked={marginMode === 'price'}
                    name="np-mode"
                    onChange={() => setMarginMode('price')}
                    type="radio"
                  />
                  模式二（利润 ÷ 平台发布价）
                </label>
              </div>

              <div className="net-profit-commissions">
                <div className="edit-draft-field">
                  <label htmlFor="np-classic">经典佣金（%）</label>
                  <input
                    id="np-classic"
                    onChange={(event) => setClassicComm(event.target.value)}
                    value={classicComm}
                  />
                </div>
                <div className="edit-draft-field">
                  <label htmlFor="np-premium">铂金佣金（%）</label>
                  <input
                    id="np-premium"
                    onChange={(event) => setPremiumComm(event.target.value)}
                    value={premiumComm}
                  />
                </div>
              </div>

              <div className="edit-draft-field">
                <label htmlFor="np-packing">贴单打包费（CNY）</label>
                <input
                  id="np-packing"
                  onChange={(event) => setPackingCost(event.target.value)}
                  value={packingCost}
                />
              </div>
            </div>

            {fx && (
              <section className="net-profit-rates">
                <h3>汇率（1 USD 兑换）</h3>
                <div className="net-profit-rates-grid">
                  <span>CNY {fx.cny.toFixed(4)}</span>
                  <span>MXN {fx.mxn.toFixed(4)}</span>
                  <span>BRL {fx.brl.toFixed(4)}</span>
                  <span>ARS {fx.ars.toFixed(4)}</span>
                </div>
                <p className="net-profit-rates-meta">
                  更新时间：{fx.updatedAt || '尚未刷新'}
                  <button
                    className="secondary-button"
                    disabled={refreshing}
                    onClick={() => void runRefresh()}
                    type="button"
                  >
                    {refreshing ? '刷新中…' : '刷新汇率'}
                  </button>
                </p>
                <p className="edit-note">
                  运费为内置阶梯表核价预估，非平台实时账单，正式上架前请用卖家后台实际运费复核。
                </p>
              </section>
            )}

            <div className="edit-actions">
              <button className="secondary-button" disabled={saving} onClick={onClose} type="button">
                取消
              </button>
              <button className="primary-button" disabled={saving} onClick={() => void runSave()} type="button">
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
