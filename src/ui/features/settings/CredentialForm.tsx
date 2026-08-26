import { useState } from 'react';

import type { AppCredentials } from '../../../domain/config';
import type { AppCredentialsInput } from '../../../shared/config-schemas';

type CredentialFormProps = {
  credentials: AppCredentials;
  onDirtyChange(dirty: boolean): void;
  onSave(input: AppCredentialsInput): Promise<void>;
};

const emptyMiaoshou = { appKey: '', appSecret: '', baseUrl: '' };
const emptyQiniu = {
  accessKey: '',
  secretKey: '',
  bucket: '',
  domain: '',
  region: '',
};

export function CredentialForm({
  credentials,
  onDirtyChange,
  onSave,
}: CredentialFormProps) {
  const [miaoshou, setMiaoshou] = useState(
    credentials.miaoshou ?? emptyMiaoshou,
  );
  const [qiniu, setQiniu] = useState(credentials.qiniu ?? emptyQiniu);
  const [showMiaoshouSecret, setShowMiaoshouSecret] = useState(false);
  const [showQiniuSecret, setShowQiniuSecret] = useState(false);
  const [status, setStatus] = useState('');

  function updateMiaoshou(field: keyof typeof miaoshou, value: string) {
    setMiaoshou((current) => ({ ...current, [field]: value }));
    onDirtyChange(true);
  }

  function updateQiniu(field: keyof typeof qiniu, value: string) {
    setQiniu((current) => ({ ...current, [field]: value }));
    onDirtyChange(true);
  }

  async function saveMiaoshou(event: React.FormEvent) {
    event.preventDefault();
    setStatus('');
    try {
      await onSave({ miaoshou });
      setStatus('妙手凭证已保存到本机。');
      onDirtyChange(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存妙手凭证失败。');
    }
  }

  async function saveQiniu(event: React.FormEvent) {
    event.preventDefault();
    setStatus('');
    try {
      await onSave({ qiniu });
      setStatus('七牛云凭证已保存到本机。');
      onDirtyChange(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存七牛云凭证失败。');
    }
  }

  return (
    <div className="credential-grid">
      <form className="credential-card" onSubmit={saveMiaoshou}>
        <div className="form-heading">
          <div>
            <h3>妙手 ERP</h3>
            <p>首版仅保存一套妙手开放平台凭证。</p>
          </div>
        </div>
        <label>
          妙手 App Key
          <input value={miaoshou.appKey} onChange={(event) => updateMiaoshou('appKey', event.target.value)} />
        </label>
        <label>
          妙手 App Secret
          <span className="secret-input">
            <input
              type={showMiaoshouSecret ? 'text' : 'password'}
              value={miaoshou.appSecret}
              onChange={(event) => updateMiaoshou('appSecret', event.target.value)}
              autoComplete="off"
            />
            <button
              type="button"
              aria-label={`${showMiaoshouSecret ? '隐藏' : '显示'}妙手 App Secret`}
              onClick={() => setShowMiaoshouSecret((visible) => !visible)}
            >
              {showMiaoshouSecret ? '隐藏' : '显示'}
            </button>
          </span>
        </label>
        <label>
          妙手 Base URL
          <input type="url" value={miaoshou.baseUrl} onChange={(event) => updateMiaoshou('baseUrl', event.target.value)} />
        </label>
        <button className="primary-button" type="submit">
          保存妙手凭证
        </button>
      </form>

      <form className="credential-card" onSubmit={saveQiniu}>
        <div className="form-heading">
          <div>
            <h3>七牛云</h3>
            <p>用于上传压缩后的商品图片并生成公开 URL。</p>
          </div>
        </div>
        <div className="form-grid">
          <label>
            七牛 Access Key
            <input value={qiniu.accessKey} onChange={(event) => updateQiniu('accessKey', event.target.value)} />
          </label>
          <label>
            七牛 Secret Key
            <span className="secret-input">
              <input
                type={showQiniuSecret ? 'text' : 'password'}
                value={qiniu.secretKey}
                onChange={(event) => updateQiniu('secretKey', event.target.value)}
                autoComplete="off"
              />
              <button
                type="button"
                aria-label={`${showQiniuSecret ? '隐藏' : '显示'}七牛 Secret Key`}
                onClick={() => setShowQiniuSecret((visible) => !visible)}
              >
                {showQiniuSecret ? '隐藏' : '显示'}
              </button>
            </span>
          </label>
          <label>
            Bucket
            <input value={qiniu.bucket} onChange={(event) => updateQiniu('bucket', event.target.value)} />
          </label>
          <label>
            区域
            <input value={qiniu.region} onChange={(event) => updateQiniu('region', event.target.value)} />
          </label>
          <label className="span-two">
            公开域名
            <input type="url" value={qiniu.domain} onChange={(event) => updateQiniu('domain', event.target.value)} />
          </label>
        </div>
        <button className="primary-button" type="submit">
          保存七牛云凭证
        </button>
      </form>
      {status && <p className="credential-status">{status}</p>}
    </div>
  );
}
