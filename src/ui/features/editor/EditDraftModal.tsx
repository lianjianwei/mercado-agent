import { useEffect } from 'react';

import type { Product } from '../../../domain/product';
import type { EditApi, ProductApi } from '../../../shared/ipc-contract';
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
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      // 图片灯箱/净收益计算详情浮层打开时,Esc 只关它们,不关本弹窗
      // (避免按一下 Esc 两处都关)。
      if (document.querySelector('.lightbox-overlay')) return;
      if (document.querySelector('.np-breakdown-popover')) return;
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
      </div>
    </div>
  );
}
