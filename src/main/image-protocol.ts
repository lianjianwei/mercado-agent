import { protocol } from 'electron';
import path from 'node:path';
import { readFileSync } from 'node:fs';

// 自定义协议 app-image://<productId>/<文件名>.png,用于渲染层展示「已生成但还没上传
// 到七牛」的本地 PNG(重生成只出本地预览时没有公网 URL,需要一条本地显示通道)。
// 用协议而非 data URL,既避免把 base64 塞进 SQLite 快照,也避免放开 webSecurity。
export const IMAGE_SCHEME = 'app-image';

// 必须在 app ready 之前调用一次,声明 scheme 具备标准 URL 行为(与 http 一致)。
export function registerImageScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: IMAGE_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

// app ready 后调用:把 app-image://<productId>/<文件名>.png 映射到 imagesDir 下对应文件。
// 路径段做白名单校验,避免被拼接逃逸到 imagesDir 之外。
// 注意:文件名带 .png 扩展名,白名单必须允许「.」;又不允许「/」,因此能挡住目录穿越。
function sanitizeSegment(segment: string): string | null {
  return /^[A-Za-z0-9._-]{1,128}$/.test(segment) ? segment : null;
}

export function registerImageProtocolHandler(imagesDir: string): void {
  protocol.handle(IMAGE_SCHEME, (request) => {
    try {
      const url = new URL(request.url);
      const productId = sanitizeSegment(url.hostname);
      const fileName = sanitizeSegment(decodeURIComponent(url.pathname.replace(/^\//, '')));
      if (!productId || !fileName || !fileName.endsWith('.png')) {
        return new Response('Bad request', { status: 400 });
      }
      const data = readFileSync(path.join(imagesDir, productId, fileName));
      return new Response(data, { headers: { 'Content-Type': 'image/png' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// 渲染层把 localPath(形如 {imagesDir}/{productId}/{文件名}.png)转成可加载的 app-image URL。
// 渲染层没有 node path,这里用字符串切分取最后一段作为文件名。
export function localPathToAppImageUrl(localPath: string, productId: string): string {
  const fileName = localPath.split(/[\\/]/).pop() ?? '';
  return fileName ? `${IMAGE_SCHEME}://${productId}/${fileName}` : '';
}
