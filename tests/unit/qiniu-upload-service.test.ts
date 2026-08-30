import { describe, expect, it, vi } from 'vitest';

import { QiniuUploadService, makeUploadToken, type QiniuFetch } from '../../src/main/services/qiniu-upload-service';
import { QINIU_UPLOAD_HOSTS } from '../../src/main/qiniu/qiniu-hosts';
import type { QiniuCredential } from '../../src/domain/config';

const creds: QiniuCredential = {
  accessKey: 'ak',
  secretKey: 'sk',
  bucket: 'bkt',
  domain: 'https://cdn.example.com/',
  region: 'z0',
};

function fakeFetch(over: { ok?: boolean; status?: number; body?: string } = {}) {
  return vi.fn(async () => ({
    ok: over.ok ?? true,
    status: over.status ?? 200,
    text: async () => over.body ?? JSON.stringify({ key: 'mercado/p1/main-1.png', hash: 'h1' }),
  }));
}

describe('makeUploadToken', () => {
  it('builds a base64url token with the bucket:key scope and a 1h deadline', () => {
    const token = makeUploadToken(creds, 'mercado/p1/main-1.png', 1700000000);
    // token = b64policy:b64signature,均为 URL-safe base64(无 +/ 与 =),冒号分隔。
    expect(token).toMatch(/^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    const [policy] = token.split(':');
    const decoded = JSON.parse(Buffer.from(policy, 'base64').toString('utf8'));
    expect(decoded.scope).toBe('bkt:mercado/p1/main-1.png');
    expect(decoded.deadline).toBe(1700000000 + 3600);
  });
});

describe('QiniuUploadService', () => {
  const svc = (fetcher: ReturnType<typeof vi.fn>) => new QiniuUploadService(fetcher as unknown as QiniuFetch, () => 1700000000);

  it('posts a multipart form to the region upload host and returns domain/key', async () => {
    const fetcher = fakeFetch();
    const service = svc(fetcher);
    const url = await service.upload(creds, 'mercado/p1/main-1.png', Buffer.from('img'));

    expect(url).toBe('https://cdn.example.com/mercado/p1/main-1.png');
    const [input, init] = fetcher.mock.calls[0] as unknown as [string, { method: string; body: unknown }];
    expect(input).toBe('https://upload.qiniup.com/');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('maps region to the correct upload host', async () => {
    const fetcher = fakeFetch();
    await svc(fetcher).upload({ ...creds, region: 'z2' }, 'k', Buffer.from('img'));
    const [input] = fetcher.mock.calls[0] as unknown as [string];
    expect(input).toBe(`https://${QINIU_UPLOAD_HOSTS.z2}/`);
  });

  it('throws when the upload response is not ok or returns an error', async () => {
    const failing = fakeFetch({ ok: false, status: 403, body: '{"error":"bad token"}' });
    await expect(svc(failing).upload(creds, 'k', Buffer.from('x'))).rejects.toThrow(/七牛/);
  });
});
