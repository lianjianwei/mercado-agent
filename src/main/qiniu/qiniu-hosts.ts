// 七牛区域 → 上传域名。与设置页的 QINIU_REGIONS(value)一一对应。
// 缺失时回退到华东(默认)上传域名。
export const QINIU_UPLOAD_HOSTS: Record<string, string> = {
  z0: 'upload.qiniup.com',
  'cn-east-2': 'upload-cn-east-2.qiniup.com',
  z1: 'upload-z1.qiniup.com',
  z2: 'upload-z2.qiniup.com',
  na0: 'upload-na0.qiniup.com',
  as0: 'upload-as0.qiniup.com',
};

export const QINIU_DEFAULT_UPLOAD_HOST = 'upload.qiniup.com';
