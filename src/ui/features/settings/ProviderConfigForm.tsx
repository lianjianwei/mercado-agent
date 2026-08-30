import { useId, useState } from 'react';

import type {
  ImageProviderName,
  ProviderConfig,
  ProviderConfigInput,
  ProviderKind,
  TextProviderName,
} from '../../../domain/config';

type ProviderConfigFormProps = {
  kind: ProviderKind;
  editing: ProviderConfig | null;
  codexAvailable: boolean;
  onDirtyChange(dirty: boolean): void;
  onSave(input: ProviderConfigInput): Promise<void>;
  onCancelEdit(): void;
};

const providerOptions = {
  text: [
    { value: 'doubao', label: '豆包' },
    { value: 'deepseek', label: 'DeepSeek' },
    { value: 'openai', label: 'OpenAI' },
  ],
  image: [
    { value: 'doubao', label: '豆包' },
    { value: 'openai', label: 'OpenAI' },
  ],
} as const;

const emptyForm = {
  provider: '',
  name: '',
  apiKey: '',
  baseUrl: '',
  model: '',
};

function formFromConfiguration(editing: ProviderConfig | null) {
  return editing
    ? {
        provider: editing.provider,
        name: editing.name,
        apiKey: editing.apiKey,
        baseUrl: editing.baseUrl,
        model: editing.model,
      }
    : emptyForm;
}

export function ProviderConfigForm({
  kind,
  editing,
  codexAvailable,
  onDirtyChange,
  onSave,
  onCancelEdit,
}: ProviderConfigFormProps) {
  const id = useId();
  const [form, setForm] = useState(() => formFromConfiguration(editing));
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const title = kind === 'text' ? '文本/多模态模型' : '生图模型';
  const isCodex = form.provider === 'codex';

  function update(field: keyof typeof form, value: string) {
    setForm((current) => {
      const next = { ...current, [field]: value };
      // 切换到 codex 时清空无需配置的字段。
      if (value === 'codex') {
        next.apiKey = '';
        next.baseUrl = '';
        next.model = '';
      }
      return next;
    });
    onDirtyChange(true);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!form.provider) {
      setError('请选择提供商。');
      return;
    }
    if (!form.name.trim()) {
      setError('请填写配置名称。');
      return;
    }
    if (!isCodex && Object.values(form).some((value) => !value.trim())) {
      setError('请填写全部模型配置字段。');
      return;
    }

    setSaving(true);
    try {
      const common = {
        id: editing?.id,
        name: form.name,
        apiKey: form.apiKey,
        baseUrl: form.baseUrl,
        model: form.model,
      };
      const input: ProviderConfigInput =
        kind === 'text'
          ? {
              ...common,
              kind,
              provider: form.provider as TextProviderName,
            }
          : {
              ...common,
              kind,
              provider: form.provider as ImageProviderName,
            };
      await onSave(input);
      setForm(emptyForm);
      setShowSecret(false);
      onDirtyChange(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : '保存模型配置失败。',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="settings-form" onSubmit={submit}>
      <div className="form-heading">
        <div>
          <h3>{editing ? `编辑${title}` : `新增${title}`}</h3>
          <p>配置不会预填默认密钥或默认服务地址。</p>
        </div>
        {editing && (
          <button className="text-button" type="button" onClick={onCancelEdit}>
            取消编辑
          </button>
        )}
      </div>

      <div className="form-grid">
        <label htmlFor={`${id}-provider`}>
          提供商
          <select
            id={`${id}-provider`}
            value={form.provider}
            onChange={(event) => update('provider', event.target.value)}
          >
            <option value="">请选择提供商</option>
            {providerOptions[kind].map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
            {/* codex 走本机 CLI, 仅当本机检测到 codex 命令时可选。 */}
            {kind === 'image' && codexAvailable && (
              <option value="codex">codex（本机 CLI）</option>
            )}
          </select>
        </label>
        <label htmlFor={`${id}-name`}>
          配置名称
          <input
            id={`${id}-name`}
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
            placeholder="例如：日常编辑主配置"
          />
        </label>
        {!isCodex && (
          <>
            <label className="span-two" htmlFor={`${id}-key`}>
              {kind === 'text' ? '文本模型 API Key' : '生图模型 API Key'}
              <span className="secret-input">
                <input
                  id={`${id}-key`}
                  type={showSecret ? 'text' : 'password'}
                  value={form.apiKey}
                  onChange={(event) => update('apiKey', event.target.value)}
                  autoComplete="off"
                />
                <button
                  type="button"
                  aria-label={`${showSecret ? '隐藏' : '显示'}${kind === 'text' ? '文本模型' : '生图模型'} API Key`}
                  onClick={() => setShowSecret((visible) => !visible)}
                >
                  {showSecret ? '隐藏' : '显示'}
                </button>
              </span>
            </label>
            <label htmlFor={`${id}-base-url`}>
              Base URL
              <input
                id={`${id}-base-url`}
                type="url"
                value={form.baseUrl}
                onChange={(event) => update('baseUrl', event.target.value)}
                placeholder="https://"
              />
            </label>
            <label htmlFor={`${id}-model`}>
              模型名称
              <input
                id={`${id}-model`}
                value={form.model}
                onChange={(event) => update('model', event.target.value)}
                placeholder="填写接口实际模型名"
              />
            </label>
          </>
        )}
        {isCodex && (
          <p className="span-two form-hint">
            codex 使用本机登录的 CLI 生图，无需 Base URL / API Key / 模型名称。
          </p>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={saving}>
          {saving ? '正在保存…' : editing ? '保存修改' : '保存模型配置'}
        </button>
      </div>
    </form>
  );
}
