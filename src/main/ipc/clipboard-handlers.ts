// 复制到系统剪贴板的 IPC 处理。图片复制走主进程:用 fetch/file 读回图片字节,
// 转 nativeImage 后 clipboard.writeImage,避免渲染层跨域拉图被 CORS 拦截。

import { clipboard, ClipboardItem, nativeImage } from 'electron';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { IPC_CHANNELS, type IpcRegistrar } from '../../shared/ipc-contract';

const copyImageSchema = z.strictObject({ src: z.string().min(1) });
const copyTextSchema = z.strictObject({ text: z.string() });

// 把图片来源解析为字节:https(s)/file:///本地绝对路径均可。
async function imageBuffer(src: string): Promise<Buffer> {
  if (/^file:\/\//i.test(src)) {
    return readFileSync(decodeURIComponent(new URL(src).pathname));
  }
  if (/^https?:\/\//i.test(src)) {
    const response = await fetch(src);
    if (!response.ok) throw new Error('图片下载失败');
    return Buffer.from(await response.arrayBuffer());
  }
  if (path.isAbsolute(src)) return readFileSync(src);
  throw new Error('不支持的图片来源');
}

export function registerClipboardHandlers(registrar: IpcRegistrar): void {
  registrar.handle(IPC_CHANNELS.clipboardImage, async (_event, payload) => {
    try {
      const { src } = copyImageSchema.parse(payload);
      const buffer = await imageBuffer(src);
      const image = nativeImage.createFromBuffer(buffer);
      if (image.isEmpty()) throw new Error('图片读取失败');
      // Electron 44 的 clipboard 已用 W3C 风格 API,用 image/png 项写入以便粘贴为图片。
      const png = image.toPNG();
      await clipboard.write([
        new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) }),
      ]);
      return { ok: true, data: undefined };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return { ok: false, error: { code: 'VALIDATION_ERROR', message: '图片来源无效' } };
      }
      return {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : '复制图片失败',
        },
      };
    }
  });

  registrar.handle(IPC_CHANNELS.clipboardText, async (_event, payload) => {
    try {
      const { text } = copyTextSchema.parse(payload);
      await clipboard.writeText(text);
      return { ok: true, data: undefined };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return { ok: false, error: { code: 'VALIDATION_ERROR', message: '文本无效' } };
      }
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: '复制文本失败' } };
    }
  });
}
