import { useEffect, useState } from 'react';

import type { ModelProxyConfig } from '../../../domain/proxy';
import type { ProxyConfigApi } from '../../../shared/ipc-contract';

type ProxyConfigFormProps = {
  api: ProxyConfigApi;
  onDirtyChange(dirty: boolean): void;
};

const emptyConfig: ModelProxyConfig = {
  enabled: false,
  protocol: 'http',
  host: '',
  port: null,
};

export function ProxyConfigForm({ api, onDirtyChange }: ProxyConfigFormProps) {
  const [config, setConfig] = useState<ModelProxyConfig>(emptyConfig);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void api
      .get()
      .then((value) => {
        if (!cancelled) setConfig(value);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '读取代理配置失败。');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  function update(value: Partial<ModelProxyConfig>) {
    setConfig((current) => ({ ...current, ...value }));
    setStatus('');
    setError('');
    onDirtyChange(true);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus('');
    setError('');
    if (config.enabled && (!config.host.trim() || config.port === null)) {
      setError('启用代理时必须填写主机和端口。');
      return;
    }
    setSaving(true);
    try {
      const saved = await api.save(config);
      setConfig(saved);
      setStatus('模型网络代理配置已保存并生效。');
      onDirtyChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存代理配置失败。');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="settings-loading">正在读取代理配置…</div>;

  return (
    <form className="proxy-config-form" onSubmit={submit}>
      <label className="proxy-toggle">
        <input
          type="checkbox"
          aria-label="启用 HTTP 代理"
          checked={config.enabled}
          onChange={(event) => update({ enabled: event.target.checked })}
        />
        <span>
          <strong>启用 HTTP 代理</strong>
          <small>仅文本和生图模型使用；妙手与七牛保持直连。</small>
        </span>
      </label>
      <div className="form-grid proxy-fields">
        <label>
          代理主机
          <input
            value={config.host}
            placeholder="127.0.0.1"
            onChange={(event) => update({ host: event.target.value })}
          />
        </label>
        <label>
          代理端口
          <input
            type="number"
            min="1"
            max="65535"
            value={config.port ?? ''}
            placeholder="7890"
            onChange={(event) =>
              update({ port: event.target.value ? Number(event.target.value) : null })
            }
          />
        </label>
      </div>
      {error && <p className="form-error">{error}</p>}
      {status && <p className="credential-status">{status}</p>}
      <button className="primary-button" type="submit" disabled={saving}>
        {saving ? '正在保存…' : '保存代理配置'}
      </button>
    </form>
  );
}
