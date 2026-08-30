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

function createFakeConfigApi(
  initial: ProviderConfig[] = [],
  initialCredentials: AppCredentials = { miaoshou: null, qiniu: null },
) {
  let configurations = [...initial];
  let credentials: AppCredentials = initialCredentials;
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
    async codexAvailable() {
      return { available: false };
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
  it('shows Qiniu regions as Chinese choices without selecting a default', async () => {
    const fake = createFakeConfigApi();
    render(<SettingsPage api={fake.api} onDirtyChange={() => undefined} />);

    const region = await screen.findByRole('combobox', { name: '区域' });
    expect(region).toHaveProperty('value', '');
    expect(screen.getByRole('option', { name: '华东-浙江（z0）' })).toBeTruthy();
    expect(
      screen.getByRole('option', { name: '亚太-新加坡（as0）' }),
    ).toBeTruthy();
  });

  it('saves the Qiniu region code and restores its Chinese selection', async () => {
    const user = userEvent.setup();
    const fake = createFakeConfigApi([], {
      miaoshou: null,
      qiniu: {
        accessKey: 'access-key',
        secretKey: 'secret-key',
        bucket: 'product-images',
        domain: 'https://images.example.com',
        region: 'as0',
      },
    });
    render(<SettingsPage api={fake.api} onDirtyChange={() => undefined} />);

    const region = await screen.findByRole('combobox', { name: '区域' });
    expect(region).toHaveProperty('value', 'as0');
    expect(screen.getByRole('option', { name: '亚太-新加坡（as0）' })).toHaveProperty(
      'selected',
      true,
    );

    await user.selectOptions(region, 'cn-east-2');
    await user.click(screen.getByRole('button', { name: '保存七牛云凭证' }));
    await waitFor(() => {
      expect(fake.getCredentials().qiniu?.region).toBe('cn-east-2');
    });
    expect(await screen.findByText('七牛云凭证已保存到本机。')).toBeTruthy();
  });

  it('shows Qiniu save confirmation after the first save', async () => {
    const user = userEvent.setup();
    const fake = createFakeConfigApi();
    render(<SettingsPage api={fake.api} onDirtyChange={() => undefined} />);

    await screen.findByText('七牛云');
    await user.type(screen.getByLabelText('七牛 Access Key'), 'access-key');
    await user.type(screen.getByLabelText('七牛 Secret Key'), 'secret-key');
    await user.type(screen.getByLabelText('Bucket'), 'product-images');
    await user.selectOptions(screen.getByRole('combobox', { name: '区域' }), 'z0');
    await user.type(
      screen.getByLabelText('公开域名'),
      'https://images.example.com',
    );
    await user.click(screen.getByRole('button', { name: '保存七牛云凭证' }));

    expect(await screen.findByText('七牛云凭证已保存到本机。')).toBeTruthy();
  });

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
        route: 'http_proxy',
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
    expect(await screen.findByText('妙手凭证已保存到本机。')).toBeTruthy();
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
        products: {
          page: async () => ({ items: [], offset: 0, limit: 20, total: 0 }),
          detail: async () => ({
            productId: '',
            title: null,
            description: null,
            itemNumber: null,
            category: null,
            sites: [],
            stock: null,
            netProfit: null,
            sourcePrice: null,
            mainImage: null,
            images: [],
            skuList: [],
          }),
          syncDefault: async () => ({ discovered: 0, succeeded: 0, failed: 0, missing: 0, failures: [], durationMs: 0 }),
          onSyncLog: () => () => undefined,
          syncOne: async () => ({ status: 'deleted' as const }),
          clear: async () => undefined,
        },
        infringement: {
          analyze: async () => { throw new Error('no provider'); },
          analyzeBatch: async () => ({ discovered: 0, succeeded: 0, failed: 0, failures: [] }),
          onBatchLog: () => () => undefined,
          history: async () => [],
          current: async () => null,
        },
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
