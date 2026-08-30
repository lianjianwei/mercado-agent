import { describe, expect, it, vi } from 'vitest';

import { QiniuUploadService } from '../../src/main/services/qiniu-upload-service';
import type { QiniuCredential } from '../../src/domain/config';

// 用普通构造函数 mock qiniu SDK,并记录调用,便于断言服务是否正确接线。
const { calls, Mac, PutPolicy, Config, FormUploader, PutExtra } = vi.hoisted(() => {
  const calls: Record<string, unknown> = {};
  type Cb = (err?: unknown, body?: unknown, info?: { statusCode: number }) => void;

  function Mac(this: unknown, ak: string, sk: string) {
    calls.mac = [ak, sk];
  }
  function PutPolicy(this: { uploadToken: () => string }, opts: unknown) {
    calls.putPolicy = opts;
    this.uploadToken = () => 'mock:token';
  }
  function Config(this: { zone: unknown; useHttpsDomain: boolean }) {
    this.zone = null;
    this.useHttpsDomain = false;
    calls.config = this;
  }
  function FormUploader(this: unknown, cfg: unknown) {
    (this as { cfg: unknown }).cfg = cfg;
    (this as { put: (t: string, k: string, f: Buffer, e: unknown, cb: Cb) => void }).put = (t, k, f, _e, cb) => {
      calls.put = [t, k, f];
      const status = (calls.putStatus as number | undefined) ?? 200;
      cb(undefined, {}, { statusCode: status });
    };
  }
  function PutExtra(this: unknown) {
    return {};
  }

  return { calls, Mac, PutPolicy, Config, FormUploader, PutExtra };
});

vi.mock('qiniu', () => ({
  auth: { digest: { Mac } },
  rs: { PutPolicy },
  conf: { Config },
  form_up: { FormUploader, PutExtra },
  zone: {
    Zone_z0: { id: 'z0' },
    Zone_cn_east_2: { id: 'cn-east-2' },
    Zone_z1: { id: 'z1' },
    Zone_z2: { id: 'z2' },
    Zone_na0: { id: 'na0' },
    Zone_as0: { id: 'as0' },
  },
}));

const creds: QiniuCredential = {
  accessKey: 'ak', secretKey: 'sk', bucket: 'bkt',
  domain: 'https://cdn.example.com/', region: 'z0',
};

describe('QiniuUploadService', () => {
  it('uploads via the qiniu SDK and returns the domain/key URL', async () => {
    const url = await new QiniuUploadService().upload(creds, 'mercado/p1/main-1.png', Buffer.from('img'));

    expect(url).toBe('https://cdn.example.com/mercado/p1/main-1.png');
    expect(calls.mac).toEqual(['ak', 'sk']);
    expect(calls.putPolicy).toEqual({ scope: 'bkt:mercado/p1/main-1.png', expires: 3600 });
    expect((calls.config as { zone: unknown }).zone).toEqual({ id: 'z0' });
    expect((calls.config as { useHttpsDomain: boolean }).useHttpsDomain).toBe(true);
    expect(calls.put).toEqual(['mock:token', 'mercado/p1/main-1.png', expect.any(Buffer)]);
  });

  it('maps the region to the SDK zone', async () => {
    await new QiniuUploadService().upload({ ...creds, region: 'z2' }, 'k', Buffer.from('x'));
    expect((calls.config as { zone: unknown }).zone).toEqual({ id: 'z2' });
  });

  it('throws when the upload status code is not 200', async () => {
    calls.putStatus = 401;
    await expect(new QiniuUploadService().upload(creds, 'k', Buffer.from('x'))).rejects.toThrow(/七牛上传失败\(401\)/);
  });
});
