import { useEffect, useState } from 'react';

import type { Product } from '../../../domain/product';
import type { EditApi, ProductApi } from '../../../shared/ipc-contract';
import { AiEditLog } from './AiEditLog';
import { EditPanel } from './EditPanel';

type EditDraftModalProps = {
  product: Product;
  api: EditApi;
  loadDetail: ProductApi['detail'];
  onClose: () => void;
};

export function EditDraftModal({
  product,
  api,
  loadDetail,
  onClose,
}: EditDraftModalProps) {
  // 编辑/生图进度行:主进程通过 edit:log 广播,这里累积并固定展示在弹窗底部。
  const [logLines, setLogLines] = useState<string[]>([]);

  // 切换商品时清空日志,避免上一个商品的进度串到当前商品。
  useEffect(() => {
    setLogLines([]);
  }, [product.id]);

  useEffect(() => {
    return api.onEditLog((line) => {
      setLogLines((current) => [...current, line]);
    });
  }, [api]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      // 图片灯箱/净收益计算详情浮层/重新生成弹窗打开时,Esc 只关它们,不关本弹窗
      // (避免按一下 Esc 两处都关)。
      if (document.querySelector('.lightbox-overlay')) return;
      if (document.querySelector('.np-breakdown-popover')) return;
      if (document.querySelector('.regenerate-dialog-overlay')) return;
      if (document.querySelector('.save-confirm-overlay')) return;
      onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="detail-modal-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        aria-label="AI 编辑"
        aria-modal="true"
        className="detail-modal edit-draft-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="detail-modal-header">
          <div>
            <span className="section-kicker">AI EDIT DRAFT</span>
            <h2>AI 编辑</h2>
          </div>
          <button
            className="secondary-button"
            onClick={onClose}
            type="button"
          >
            关闭
          </button>
        </div>
        <EditPanel api={api} loadDetail={loadDetail} product={product} />
        <AiEditLog lines={logLines} />
      </div>
    </div>
  );
}
