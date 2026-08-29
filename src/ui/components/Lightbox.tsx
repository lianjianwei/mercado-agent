// 全屏图片灯箱:点击缩略图放大到正常尺寸查看。支持点遮罩/×/Esc 关闭,点图片本身不关闭。

import { useEffect } from 'react';

type LightboxProps = {
  src: string | null;
  onClose: () => void;
  alt?: string;
};

export function Lightbox({ src, onClose, alt }: LightboxProps) {
  useEffect(() => {
    if (!src) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [src, onClose]);

  if (!src) return null;

  return (
    <div
      className="lightbox-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      onClick={onClose}
    >
      <button
        type="button"
        className="lightbox-close"
        aria-label="关闭"
        onClick={onClose}
      >
        ×
      </button>
      <img
        alt={alt ?? ''}
        className="lightbox-image"
        src={src}
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}
