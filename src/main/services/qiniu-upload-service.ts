// 七牛云上传服务:直接用官方 qiniu SDK(认证、分片、域名解析都由 SDK 处理),
// 不再手写签名。返回公网 URL = {domain}/{key}。

import * as qiniu from 'qiniu';

import type { QiniuCredential } from '../../domain/config';

// 区域 → SDK 的 Zone 常量;缺省回退华东(浙江)。
const QINIU_ZONE: Record<string, qiniu.conf.Zone> = {
  z0: qiniu.zone.Zone_z0,
  'cn-east-2': qiniu.zone.Zone_cn_east_2,
  z1: qiniu.zone.Zone_z1,
  z2: qiniu.zone.Zone_z2,
  na0: qiniu.zone.Zone_na0,
  as0: qiniu.zone.Zone_as0,
};

export class QiniuUploadService {
  async upload(creds: QiniuCredential, key: string, file: Buffer): Promise<string> {
    const mac = new qiniu.auth.digest.Mac(creds.accessKey, creds.secretKey);
    const putPolicy = new qiniu.rs.PutPolicy({ scope: `${creds.bucket}:${key}`, expires: 3600 });
    const uploadToken = putPolicy.uploadToken(mac);

    const config = new qiniu.conf.Config();
    config.zone = QINIU_ZONE[creds.region] ?? qiniu.zone.Zone_z0;
    config.useHttpsDomain = true;

    const formUploader = new qiniu.form_up.FormUploader(config);
    const putExtra = new qiniu.form_up.PutExtra();

    await new Promise<void>((resolve, reject) => {
      formUploader.put(uploadToken, key, file, putExtra, (err, _body, info) => {
        if (err) return reject(err);
        const statusCode = info?.statusCode ?? 0;
        if (statusCode !== 200) return reject(new Error(`七牛上传失败(${statusCode})`));
        resolve();
      });
    });

    return `${creds.domain.replace(/\/+$/, '')}/${key}`;
  }
}
