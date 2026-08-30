// 七牛云上传服务:本机用 AK/SK 生成上传 token(HMAC-SHA1 签名),再走表单上传
// multipart POST 到对应区域的上传域名。不引 qiniu npm 依赖,不泄漏 AK/SK。
// 返回公网 URL = {domain}/{key}。

import { createHmac } from 'node:crypto';

import type { QiniuCredential } from '../../domain/config';
import { QINIU_DEFAULT_UPLOAD_HOST, QINIU_UPLOAD_HOSTS } from '../qiniu/qiniu-hosts';

// URL-safe base64(无 padding):七牛签名字符计数法。
export function base64urlUtf8(value: string | Buffer): string {
  const buf = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 生成上传凭证:putPolicy(scope=bucket:key, deadline=now+1h) → 签名字符串 = b64policy+'\n',
// 用 secretKey 做 HMAC-SHA1,结果为 token = b64policy.b64sig。
export function makeUploadToken(
  creds: QiniuCredential,
  key: string,
  nowSec = Math.floor(Date.now() / 1000),
): string {
  const policy = JSON.stringify({ scope: `${creds.bucket}:${key}`, deadline: nowSec + 3600 });
  const b64Policy = base64urlUtf8(policy);
  const signature = base64urlUtf8(
    createHmac('sha1', creds.secretKey).update(`${b64Policy}\n`).digest(),
  );
  return `${b64Policy}.${signature}`;
}

export type QiniuFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class QiniuUploadService {
  constructor(
    private readonly fetcher: QiniuFetch = fetch,
    private readonly nowSec: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  async upload(creds: QiniuCredential, key: string, file: Buffer): Promise<string> {
    const host = QINIU_UPLOAD_HOSTS[creds.region] ?? QINIU_DEFAULT_UPLOAD_HOST;
    const token = makeUploadToken(creds, key, this.nowSec());

    const form = new FormData();
    form.append('token', token);
    form.append('key', key);
    form.append('file', new Blob([new Uint8Array(file)], { type: 'image/png' }), key);

    let response: Response;
    try {
      response = await this.fetcher(`https://${host}/`, { method: 'POST', body: form });
    } catch {
      throw new Error('七牛上传网络失败。');
    }
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`七牛上传失败(${response.status}):${text}`);
    }
    let json: { hash?: string; key?: string; error?: string };
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`七牛上传响应异常:${text}`);
    }
    if (json.error) throw new Error(`七牛上传失败:${json.error}`);
    return `${creds.domain.replace(/\/+$/, '')}/${key}`;
  }
}
