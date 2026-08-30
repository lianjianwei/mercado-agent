// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Lightbox } from '../../src/ui/components/Lightbox';

afterEach(() => {
  cleanup();
  delete (window as { mercado?: unknown }).mercado;
});

function mount(src = 'https://img.test/x.png') {
  const onClose = vi.fn();
  render(<Lightbox src={src} onClose={onClose} />);
  return onClose;
}

function openMenu() {
  fireEvent.contextMenu(screen.getByRole('dialog', { name: '图片预览' }).querySelector('img')!);
}

describe('Lightbox right-click context menu', () => {
  it('opens a menu with 复制图片 / 复制图片地址 on right-click', () => {
    mount();
    openMenu();
    expect(screen.getByText('复制图片')).toBeTruthy();
    expect(screen.getByText('复制图片地址')).toBeTruthy();
  });

  it('copies the image address via the clipboard API', async () => {
    const copyText = vi.fn(async () => undefined);
    (window as { mercado?: unknown }).mercado = {
      clipboard: { copyImage: vi.fn(async () => undefined), copyText },
    };
    mount('https://img.test/x.png');
    openMenu();
    fireEvent.click(screen.getByText('复制图片地址'));
    await vi.waitFor(() => expect(copyText).toHaveBeenCalledWith('https://img.test/x.png'));
  });

  it('copies the image via the clipboard API', async () => {
    const copyImage = vi.fn(async () => undefined);
    (window as { mercado?: unknown }).mercado = {
      clipboard: { copyImage, copyText: vi.fn(async () => undefined) },
    };
    mount('https://img.test/x.png');
    openMenu();
    fireEvent.click(screen.getByText('复制图片'));
    await vi.waitFor(() => expect(copyImage).toHaveBeenCalledWith('https://img.test/x.png'));
  });

  it('Esc closes only the menu when open, keeping the lightbox open', () => {
    const onClose = mount();
    openMenu();
    expect(screen.getByText('复制图片地址')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('复制图片地址')).toBeNull();
    expect(screen.getByRole('dialog', { name: '图片预览' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
