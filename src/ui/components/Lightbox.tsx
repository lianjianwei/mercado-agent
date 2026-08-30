// 全屏图片灯箱:点击缩略图放大到正常尺寸查看。支持点遮罩/×/Esc 关闭,点图片本身不关闭。
// 右击图片弹出菜单:复制图片 / 复制图片地址,方便在详情里取图。

import { useEffect, useState } from 'react';

import type { ClipboardApi } from '../../shared/ipc-contract';

type LightboxProps = {
  src: string | null;
  onClose: () => void;
  alt?: string;
};

// 右击菜单位置(光标坐标)。null 表示菜单未打开。
type MenuPosition = { x: number; y: number };

// 渲染层可能无 window.mercado(如单测),故按需取;复制走主进程剪贴板,跨域图也不受 CORS 影响。
function mercadoClipboard(): ClipboardApi | null {
  return (window as { mercado?: { clipboard?: ClipboardApi } }).mercado?.clipboard ?? null;
}

export function Lightbox({ src, onClose, alt }: LightboxProps) {
  const [menu, setMenu] = useState<MenuPosition | null>(null);

  useEffect(() => {
    if (!src) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // 右击菜单打开时,Esc 只关菜单;否则关灯箱。
      if (menu) {
        setMenu(null);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [src, onClose, menu]);

  if (!src) return null;

  const copyImage = async () => {
    setMenu(null);
    try {
      await mercadoClipboard()?.copyImage(src);
    } catch {
      /* 复制失败静默,避免未捕获的拒绝 */
    }
  };
  const copyAddress = async () => {
    setMenu(null);
    try {
      await mercadoClipboard()?.copyText(src);
    } catch {
      /* 复制失败静默 */
    }
  };

  // 菜单贴近光标,但避免超出视口右/下边缘。
  const menuLeft = menu ? Math.min(menu.x, window.innerWidth - 140) : 0;
  const menuTop = menu ? Math.min(menu.y, window.innerHeight - 88) : 0;

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
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
      />
      {menu && (
        <>
          <div className="image-menu-backdrop" onClick={() => setMenu(null)} />
          <div
            className="image-context-menu"
            role="menu"
            aria-label="图片操作"
            style={{ left: menuLeft, top: menuTop }}
          >
            <button type="button" role="menuitem" onClick={() => void copyImage()}>
              复制图片
            </button>
            <button type="button" role="menuitem" onClick={() => void copyAddress()}>
              复制图片地址
            </button>
          </div>
        </>
      )}
    </div>
  );
}
