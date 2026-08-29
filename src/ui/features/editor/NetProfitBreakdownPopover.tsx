// 净收益计算详情浮层:点击站点净收益单元格里的「计算详情」后,锚定在该按钮
// 旁的只读小框,用紧凑的「标签 → 值」行展示算出这个净收益用到的每个参数、
// 运费,并高亮命中的运费阶梯。只读,无输入框。参照 美客多净利润计算器 的展示,
// 但压缩成一小块。

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  LISTING_TYPE_LABELS,
  SITE_LABELS,
  type NetProfitBreakdown,
} from '../../../domain/net-profit';

type Anchor = { left: number; top: number; width: number; height: number };

type Props = {
  detail: NetProfitBreakdown;
  anchor: Anchor;
  onClose: () => void;
};

const POPOVER_MIN_WIDTH = 300;

// 数值格式化:整数省略小数,其它保留两位并去掉尾零(与 formatNetProfit 一致)。
function fmt(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function tierRange(tier: NetProfitBreakdown['tier']): string {
  if (tier.maxKg === Infinity) return `≥ ${fmt(tier.minKg)} kg`;
  return `${fmt(tier.minKg)}–${fmt(tier.maxKg)} kg`;
}

function marginModeLabel(mode: NetProfitBreakdown['marginMode']): string {
  return mode === 'income' ? '模式一(利润 ÷ 净收益)' : '模式二(利润 ÷ 平台发布价)';
}

function siteLabel(code: string): string {
  return SITE_LABELS[code] ?? code;
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="np-row">
      <span className="np-row-label">{label}</span>
      <span className={strong ? 'np-row-value np-row-strong' : 'np-row-value'}>{value}</span>
    </div>
  );
}

function GroupTitle({ children }: { children: React.ReactNode }) {
  return <div className="np-group-title">{children}</div>;
}

export function NetProfitBreakdownPopover({ detail, anchor, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const [ready, setReady] = useState(false);

  // Esc 关闭:只关本浮层,不关外层 AI 编辑弹窗。外层弹窗的 keydown 监听通过
  // document.querySelector('.np-breakdown-popover') 提前返回,见 EditDraftModal。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 锚定在按钮旁:默认右侧,越界翻转;上下越界时收缩到视口内。
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const width = Math.max(el.offsetWidth, POPOVER_MIN_WIDTH);
    const height = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchor.left + anchor.width + 10;
    if (left + width > vw - 8) left = Math.max(8, anchor.left - width - 10);
    let top = anchor.top;
    if (top + height > vh - 8) top = Math.max(8, vh - height - 8);
    setPos({ left, top });
    setReady(true);
  }, [anchor]);

  return (
    <>
      <div className="np-breakdown-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        aria-label={`${siteLabel(detail.siteCode)}净收益计算详情`}
        className="np-breakdown-popover"
        ref={ref}
        role="dialog"
        style={{ left: pos.left, top: pos.top, visibility: ready ? 'visible' : 'hidden' }}
      >
        <div className="np-header">
          <div>
            <span className="np-header-title">净收益计算详情</span>
            <span className="np-header-site">{siteLabel(detail.siteCode)}</span>
          </div>
          <button className="np-close" aria-label="关闭" onClick={onClose} type="button">
            ×
          </button>
        </div>

        <div className="np-body">
          <GroupTitle>输入</GroupTitle>
          <Row label="采购价" value={`${fmt(detail.sourcePriceCny)} CNY`} />
          <Row label="贴单打包费" value={`${fmt(detail.packingCostCny)} CNY`} />
          <Row label="尺寸" value={`${fmt(detail.lengthCm)} × ${fmt(detail.widthCm)} × ${fmt(detail.heightCm)} cm`} />
          <Row label="重量" value={`${fmt(detail.weightG)} g`} />

          <GroupTitle>计费重量</GroupTitle>
          <Row
            label="采用"
            value={`${fmt(detail.billableKg)} kg${detail.isVolumeWeight ? '(体积重)' : '(实际重)'}`}
          />

          <GroupTitle>运费</GroupTitle>
          <Row label="命中阶梯" value={tierRange(detail.tier)} strong />
          <Row label="该档运费" value={`${fmt(detail.tier.highPriceUsd)} / ${fmt(detail.tier.lowPriceUsd)} USD(高/低)`} />
          <Row label="采用运费" value={`${fmt(detail.shippingUsd)} USD${detail.isHigh ? '(高价档)' : '(低价档)'}`} strong />

          <GroupTitle>发布</GroupTitle>
          <Row label="产品类型" value={LISTING_TYPE_LABELS[detail.listingType] ?? detail.listingType} />
          <Row label="平台佣金" value={`${fmt(detail.commissionPct)}%`} />
          <Row label="平台发布价" value={`${fmt(detail.priceUsd)} USD`} />

          <GroupTitle>测算</GroupTitle>
          <Row label="目标利润率" value={`${fmt(detail.targetMargin)}%`} />
          <Row label="利润率口径" value={marginModeLabel(detail.marginMode)} />
          <Row label="汇率" value={`USD→CNY ${fmt(detail.fxCny)} · USD→本地 ${fmt(detail.fxLocal)}`} />
        </div>

        <div className="np-footer">
          <span>净收益</span>
          <strong>{fmt(detail.netProfitUsd)} USD</strong>
        </div>
      </div>
    </>
  );
}
