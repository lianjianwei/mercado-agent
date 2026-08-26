import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  AppCredentials,
  ProviderConfig,
  ProviderConfigInput,
  ProviderKind,
} from '../../domain/config';
import type { AppCredentialsInput } from '../../shared/config-schemas';
import type { ConfigApi, DiagnosticApi } from '../../shared/ipc-contract';
import { ConfigList } from '../features/settings/ConfigList';
import { CredentialForm } from '../features/settings/CredentialForm';
import { ProviderConfigForm } from '../features/settings/ProviderConfigForm';
import '../features/settings/settings.css';

type SettingsPageProps = {
  api?: ConfigApi;
  diagnosticsApi?: DiagnosticApi;
  onDirtyChange(dirty: boolean): void;
};

export function SettingsPage({ api, diagnosticsApi, onDirtyChange }: SettingsPageProps) {
  const configApi = api ?? window.mercado.config;
  const diagnosticApi = diagnosticsApi ?? window.mercado?.diagnostics;
  const [textConfigs, setTextConfigs] = useState<ProviderConfig[]>([]);
  const [imageConfigs, setImageConfigs] = useState<ProviderConfig[]>([]);
  const [credentials, setCredentials] = useState<AppCredentials>({
    miaoshou: null,
    qiniu: null,
  });
  const [editingText, setEditingText] = useState<ProviderConfig | null>(null);
  const [editingImage, setEditingImage] = useState<ProviderConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const [testingKind, setTestingKind] = useState<ProviderKind | null>(null);
  const [connectionMessages, setConnectionMessages] = useState<
    Partial<Record<ProviderKind, string>>
  >({});
  const dirtySections = useRef(new Set<string>());

  const updateDirtySection = useCallback(
    (section: string, dirty: boolean) => {
      if (dirty) dirtySections.current.add(section);
      else dirtySections.current.delete(section);
      onDirtyChange(dirtySections.current.size > 0);
    },
    [onDirtyChange],
  );

  const load = useCallback(async () => {
    try {
      const [text, image, storedCredentials] = await Promise.all([
        configApi.listProviders('text'),
        configApi.listProviders('image'),
        configApi.getCredentials(),
      ]);
      setTextConfigs(text);
      setImageConfigs(image);
      setCredentials(storedCredentials);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '读取本地配置失败。');
    } finally {
      setLoading(false);
    }
  }, [configApi]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      configApi.listProviders('text'),
      configApi.listProviders('image'),
      configApi.getCredentials(),
    ])
      .then(([text, image, storedCredentials]) => {
        if (cancelled) return;
        setTextConfigs(text);
        setImageConfigs(image);
        setCredentials(storedCredentials);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPageError(
          error instanceof Error ? error.message : '读取本地配置失败。',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [configApi]);

  async function saveProvider(input: ProviderConfigInput) {
    await configApi.saveProvider(input);
    setSavedMessage('模型配置已保存到本机。');
    setEditingText(null);
    setEditingImage(null);
    await load();
  }

  async function activateProvider(id: string) {
    try {
      setPageError('');
      await configApi.activateProvider(id);
      setSavedMessage('启用配置已切换。');
      await load();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '切换启用配置失败。');
    }
  }

  async function deleteProvider(id: string) {
    try {
      setPageError('');
      await configApi.deleteProvider(id);
      setSavedMessage('模型配置已删除。');
      await load();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '删除模型配置失败。');
    }
  }

  async function saveCredentials(input: AppCredentialsInput) {
    await configApi.saveCredentials(input);
    await load();
  }

  async function testConnection(kind: ProviderKind) {
    setTestingKind(kind);
    setPageError('');
    try {
      if (!diagnosticApi) throw new Error('诊断服务尚未就绪。');
      const result = await diagnosticApi.testConnection(kind);
      setConnectionMessages((current) => ({
        ...current,
        [kind]: `${result.message}（${result.latencyMs} ms）`,
      }));
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '连接测试失败。');
    } finally {
      setTestingKind(null);
    }
  }

  function configsFor(kind: ProviderKind) {
    return kind === 'text' ? textConfigs : imageConfigs;
  }

  return (
    <section className="settings-page">
      <div className="plaintext-warning" role="note">
        <strong>本地明文存储</strong>
        <span>凭证以明文保存在本机 SQLite，仅供当前设备上的本地应用使用。</span>
      </div>

      {pageError && <div className="page-error">{pageError}</div>}
      {savedMessage && <div className="saved-message">{savedMessage}</div>}

      <section className="settings-section">
        <div className="settings-section-heading">
          <div>
            <span className="section-kicker">AI PROVIDERS</span>
            <h2>模型配置</h2>
            <p>文本与生图配置相互独立，每种用途只能启用一套。</p>
          </div>
        </div>

        {loading ? (
          <div className="settings-loading">正在读取本地配置…</div>
        ) : (
          <div className="provider-columns">
            {(['text', 'image'] as const).map((kind) => (
              <div className="provider-panel" key={kind}>
                <ProviderConfigForm
                  key={`${kind}-${kind === 'text' ? editingText?.id ?? 'new' : editingImage?.id ?? 'new'}`}
                  kind={kind}
                  editing={kind === 'text' ? editingText : editingImage}
                  onDirtyChange={(dirty) =>
                    updateDirtySection(`provider-${kind}`, dirty)
                  }
                  onSave={saveProvider}
                  onCancelEdit={() => {
                    updateDirtySection(`provider-${kind}`, false);
                    if (kind === 'text') setEditingText(null);
                    else setEditingImage(null);
                  }}
                />
                <ConfigList
                  kind={kind}
                  configurations={configsFor(kind)}
                  onActivate={activateProvider}
                  onDelete={deleteProvider}
                  onTest={testConnection}
                  testing={testingKind === kind}
                  onEdit={(configuration) =>
                    kind === 'text'
                      ? setEditingText(configuration)
                      : setEditingImage(configuration)
                  }
                />
                {connectionMessages[kind] && (
                  <p className="connection-result" role="status">
                    {connectionMessages[kind]}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="settings-section">
        <div className="settings-section-heading">
          <div>
            <span className="section-kicker">LOCAL CREDENTIALS</span>
            <h2>平台与存储凭证</h2>
            <p>妙手和七牛云可以分别填写、保存和修改。</p>
          </div>
        </div>
        {!loading && (
          <CredentialForm
            key={`${credentials.miaoshou?.appKey ?? 'no-miaoshou'}-${credentials.qiniu?.accessKey ?? 'no-qiniu'}`}
            credentials={credentials}
            onDirtyChange={(dirty) => updateDirtySection('credentials', dirty)}
            onSave={saveCredentials}
          />
        )}
      </section>
    </section>
  );
}
