import { useState } from 'react';

import type { ProviderConfig, ProviderKind } from '../../../domain/config';

type ConfigListProps = {
  kind: ProviderKind;
  configurations: ProviderConfig[];
  onActivate(id: string): Promise<void>;
  onEdit(configuration: ProviderConfig): void;
  onDelete(id: string): Promise<void>;
  onTest(kind: ProviderKind): Promise<void>;
  testing: boolean;
};

const providerLabels: Record<ProviderConfig['provider'], string> = {
  doubao: '豆包',
  deepseek: 'DeepSeek',
  openai: 'OpenAI',
};

function maskSecret(secret: string): string {
  if (secret.length <= 6) return '••••••';
  return `${secret.slice(0, 3)}••••••${secret.slice(-3)}`;
}

export function ConfigList({
  kind,
  configurations,
  onActivate,
  onEdit,
  onDelete,
  onTest,
  testing,
}: ConfigListProps) {
  const [visibleSecrets, setVisibleSecrets] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyErrorId, setCopyErrorId] = useState<string | null>(null);

  function toggleSecret(id: string) {
    setVisibleSecrets((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirmDelete(configuration: ProviderConfig) {
    if (window.confirm(`确定删除配置“${configuration.name}”吗？`)) {
      await onDelete(configuration.id);
    }
  }

  async function copySecret(configuration: ProviderConfig) {
    try {
      await navigator.clipboard.writeText(configuration.apiKey);
      setCopiedId(configuration.id);
      setCopyErrorId(null);
    } catch {
      setCopiedId(null);
      setCopyErrorId(configuration.id);
    }
  }

  if (configurations.length === 0) {
    return (
      <div className="empty-config-list">
        尚未保存{kind === 'text' ? '文本模型' : '生图模型'}配置
      </div>
    );
  }

  return (
    <div className="config-list">
      {configurations.map((configuration) => {
        const secretVisible = visibleSecrets.has(configuration.id);
        return (
          <article className="config-item" key={configuration.id}>
            <div className="config-item-heading">
              <div>
                <strong>{configuration.name}</strong>
                <span>{providerLabels[configuration.provider]}</span>
              </div>
              {configuration.isActive ? (
                <span className="active-badge">当前启用</span>
              ) : (
                <button
                  className="activate-button"
                  type="button"
                  aria-label={`启用 ${configuration.name}`}
                  onClick={() => void onActivate(configuration.id)}
                >
                  设为启用
                </button>
              )}
            </div>
            <dl>
              <div>
                <dt>模型</dt>
                <dd>{configuration.model}</dd>
              </div>
              <div>
                <dt>API Key</dt>
                <dd>{secretVisible ? configuration.apiKey : maskSecret(configuration.apiKey)}</dd>
              </div>
            </dl>
            <div className="config-item-actions">
              {configuration.isActive && (
                <button
                  className="connection-test-button"
                  type="button"
                  aria-label={`测试 ${configuration.name} 连接`}
                  disabled={testing}
                  onClick={() => void onTest(kind)}
                >
                  {testing ? '测试中…' : '测试连接'}
                </button>
              )}
              <button
                type="button"
                aria-label={`${secretVisible ? '隐藏' : '显示'} ${configuration.name} API Key`}
                onClick={() => toggleSecret(configuration.id)}
              >
                {secretVisible ? '隐藏密钥' : '查看密钥'}
              </button>
              <button
                type="button"
                aria-label={`复制 ${configuration.name} API Key`}
                onClick={() => void copySecret(configuration)}
              >
                {copiedId === configuration.id ? '已复制' : '复制密钥'}
              </button>
              <button type="button" onClick={() => onEdit(configuration)}>
                编辑
              </button>
              <button
                className="danger-text"
                type="button"
                onClick={() => void confirmDelete(configuration)}
              >
                删除
              </button>
            </div>
            {copyErrorId === configuration.id && (
              <p className="copy-error">复制失败，请查看密钥后手动复制。</p>
            )}
          </article>
        );
      })}
    </div>
  );
}
