// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  AppCredentials,
  ProviderConfig,
  ProviderConfigInput,
} from '../../src/domain/config';
import type { AppCredentialsInput } from '../../src/shared/config-schemas';
import type { ConfigApi, DiagnosticApi } from '../../src/shared/ipc-contract';
import { App } from '../../src/ui/App';
import { SettingsPage } from '../../src/ui/pages/SettingsPage';

function createFakeConfigApi(initial: ProviderConfig[] = []) {
  let configurations = [...initial];
  let credentials: AppCredentials = { miaoshou: null, qiniu: null };
  const activateCalls: string[] = [];

  const api: ConfigApi = {
    async listProviders(kind) {
      return configurations.filter((item) => item.kind === kind);
    },
    async saveProvider(input: ProviderConfigInput) {
      const existing = input.id
        ? configurations.find((item) => item.id === input.id)
        : undefined;
      const saved: ProviderConfig = {
        ...input,
        id: input.id ?? `config-${configurations.length + 1}`,
        isActive: existing?.isActive ?? false,
        createdAt: existing?.createdAt ?? '2026-08-27T00:00:00.000Z',
        updatedAt: '2026-08-27T00:00:00.000Z',
      };
      configurations = configurations.filter((item) => item.id !== saved.id);
      configurations.push(saved);
      return saved;
    },
    async activateProvider(id) {
      activateCalls.push(id);
      const target = configurations.find((item) => item.id === id);
      if (!target) return;
      configurations = configurations.map((item) => ({
        ...item,
        isActive: item.kind === target.kind ? item.id === id : item.isActive,
      }));
    },
    async deleteProvider(id) {
      configurations = configurations.filter((item) => item.id !== id);
    },
    async getCredentials() {
      return credentials;
    },
    async saveCredentials(input: AppCredentialsInput) {
      credentials = {
        miaoshou: input.miaoshou ?? credentials.miaoshou,
        qiniu: input.qiniu ?? credentials.qiniu,
      };
    },
  };

  return {
    api,
    getCredentials: () => credentials,
    activateCalls,
  };
}

afterEach(cleanup);

describe('settings page', () => {
  it('tests the active model connection from the configuration list', async () => {
    const user = userEvent.setup();
    const fake = createFakeConfigApi([
      {
        id: 'text-active',
        kind: 'text',
        provider: 'openai',
        name: '文本主配置',
        apiKey: 'text-secret',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5',
        isActive: true,
        createdAt: '2026-08-27T00:00:00.000Z',
        updatedAt: '2026-08-27T00:00:00.000Z',
      },
    ]);
    const diagnostics: DiagnosticApi = {
      getSnapshot: vi.fn(),
      testConnection: vi.fn<DiagnosticApi['testConnection']>(async () => ({
        ok: true,
        status: 'success' as const,
        message: '模型服务连接成功。',
        latencyMs: 18,
      })),
      cancelConnection: vi.fn(),
    };
    render(
      <SettingsPage
        api={fake.api}
        diagnosticsApi={diagnostics}
        onDirtyChange={() => undefined}
      />,
    );

    await user.click(
      await screen.findByRole('button', { name: '测试 文本主配置 连接' }),
    );
    expect(diagnostics.testConnection).toHaveBeenCalledWith('text');
    expect(await screen.findByText(/模型服务连接成功/)).toBeTruthy();
  });

  it('starts without credential defaults and allows secrets to be viewed', async () => {
    const user = userEvent.setup();
    const fake = createFakeConfigApi();
    render(<SettingsPage api={fake.api} onDirtyChange={() => undefined} />);

    expect(
      await screen.findByText(/凭证以明文保存在本机 SQLite/),
    ).toBeTruthy();
    const textApiKey = screen.getByLabelText('文本模型 API Key');
    const miaoshouSecret = screen.getByLabelText('妙手 App Secret');
    expect(textApiKey).toHaveProperty('value', '');
    expect(miaoshouSecret).toHaveProperty('value', '');
    expect(textApiKey.getAttribute('type')).toBe('password');

    await user.click(screen.getByRole('button', { name: '显示文本模型 API Key' }));
    expect(textApiKey.getAttribute('type')).toBe('text');
  });

  it('switches active text and image configurations independently', async () => {
    const user = userEvent.setup();
    const fake = createFakeConfigApi([
      {
        id: 'text-1',
        kind: 'text',
        provider: 'deepseek',
        name: '文本主配置',
        apiKey: 'text-secret',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        isActive: false,
        createdAt: '2026-08-27T00:00:00.000Z',
        updatedAt: '2026-08-27T00:00:00.000Z',
      },
      {
        id: 'image-1',
        kind: 'image',
        provider: 'openai',
        name: '生图主配置',
        apiKey: 'image-secret',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-image-1',
        isActive: false,
        createdAt: '2026-08-27T00:00:00.000Z',
        updatedAt: '2026-08-27T00:00:00.000Z',
      },
    ]);
    render(<SettingsPage api={fake.api} onDirtyChange={() => undefined} />);

    await user.click(
      await screen.findByRole('button', { name: '启用 文本主配置' }),
    );
    await user.click(
      await screen.findByRole('button', { name: '启用 生图主配置' }),
    );

    expect(fake.activateCalls).toEqual(['text-1', 'image-1']);
    expect(await screen.findAllByText('当前启用')).toHaveLength(2);
  });

  it('saves Miaoshou credentials without requiring Qiniu fields', async () => {
    const user = userEvent.setup();
    const fake = createFakeConfigApi();
    const onDirtyChange = vi.fn();
    render(
      <SettingsPage api={fake.api} onDirtyChange={onDirtyChange} />,
    );

    await screen.findByText('妙手 ERP');
    await user.type(screen.getByLabelText('妙手 App Key'), 'app-key');
    await user.type(screen.getByLabelText('妙手 App Secret'), 'app-secret');
    await user.type(
      screen.getByLabelText('妙手 Base URL'),
      'https://openapi.example.com',
    );
    await user.click(screen.getByRole('button', { name: '保存妙手凭证' }));

    await waitFor(() => {
      expect(fake.getCredentials().miaoshou).toEqual({
        appKey: 'app-key',
        appSecret: 'app-secret',
        baseUrl: 'https://openapi.example.com',
      });
    });
    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });

  it('asks before leaving when any configuration form has unsaved changes', async () => {
    const user = userEvent.setup();
    const fake = createFakeConfigApi();
    const confirm = vi.fn(() => false);
    Object.defineProperty(window, 'mercado', {
      configurable: true,
      value: {
        app: { getInfo: async () => ({ version: '0.1.0', platform: 'darwin' }) },
        config: fake.api,
      },
    });
    Object.defineProperty(window, 'confirm', {
      configurable: true,
      value: confirm,
    });
    render(<App />);

    await user.click(screen.getByRole('button', { name: '模型与凭证' }));
    await screen.findByText('平台与存储凭证');
    await user.type(screen.getByLabelText('文本模型 API Key'), 'unsaved');
    await user.click(screen.getByRole('button', { name: '工作台' }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('heading', { level: 1, name: '模型与凭证' }),
    ).toBeTruthy();
  });
});
