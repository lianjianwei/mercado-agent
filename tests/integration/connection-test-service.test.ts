import { describe, expect, it } from 'vitest';

import type { ModelConnectionProvider } from '../../src/domain/providers';
import { ProviderAuthenticationError } from '../../src/domain/providers';
import { ProviderRegionRestrictedError } from '../../src/domain/providers';
import { ModelProxyConnectionError } from '../../src/main/network/model-network-errors';
import { ConnectionTestService } from '../../src/main/services/connection-test-service';

function resolver(provider: ModelConnectionProvider) {
  return { createActive: () => provider };
}

function waitsForAbort(): ModelConnectionProvider {
  return {
    testConnection: (signal) =>
      new Promise((_, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        );
      }),
  };
}

describe('ConnectionTestService', () => {
  it('returns the provider success result', async () => {
    const service = new ConnectionTestService(
      resolver({
        testConnection: async () => ({
          ok: true,
          status: 'success',
          message: '连接成功。',
          latencyMs: 0,
          route: 'direct',
        }),
      }),
      100,
    );

    await expect(service.test('text')).resolves.toMatchObject({
      ok: true,
      status: 'success',
      route: 'direct',
    });
  });

  it('reports which route was used for the test', async () => {
    const service = new ConnectionTestService(
      resolver({
        testConnection: async () => ({
          ok: true,
          status: 'success',
          message: '连接成功。',
          latencyMs: 0,
          route: 'http_proxy',
        }),
      }),
      100,
      () => 'http_proxy',
    );

    await expect(service.test('image')).resolves.toMatchObject({ route: 'http_proxy' });
  });

  it('returns a clear local proxy error', async () => {
    const service = new ConnectionTestService(
      resolver({
        testConnection: async () => {
          throw new ModelProxyConnectionError();
        },
      }),
      100,
      () => 'http_proxy',
    );

    await expect(service.test('text')).resolves.toMatchObject({
      status: 'unavailable',
      route: 'http_proxy',
      message: '无法连接本地 HTTP 代理，请确认代理应用已启动且端口正确。',
    });
  });

  it('returns a safe region restriction error', async () => {
    const service = new ConnectionTestService(
      resolver({
        testConnection: async () => {
          throw new ProviderRegionRestrictedError();
        },
      }),
    );

    await expect(service.test('text')).resolves.toMatchObject({
      status: 'unavailable',
      message: '模型服务拒绝当前网络地区访问，请启用可用的 HTTP 代理后重试。',
    });
  });

  it('aborts a provider that exceeds the configured timeout', async () => {
    const service = new ConnectionTestService(resolver(waitsForAbort()), 10);

    await expect(service.test('text')).resolves.toMatchObject({
      ok: false,
      status: 'timeout',
      message: '连接测试超时，请检查网络或 Base URL。',
    });
  });

  it('distinguishes user cancellation from timeout', async () => {
    const controller = new AbortController();
    const service = new ConnectionTestService(resolver(waitsForAbort()), 1_000);
    controller.abort();

    await expect(service.test('image', controller.signal)).resolves.toMatchObject({
      ok: false,
      status: 'cancelled',
      message: '连接测试已取消。',
    });
  });

  it('returns a clear authentication error', async () => {
    const service = new ConnectionTestService(
      resolver({
        testConnection: async () => {
          throw new ProviderAuthenticationError();
        },
      }),
    );

    await expect(service.test('text')).resolves.toMatchObject({
      ok: false,
      status: 'authentication_error',
      message: '模型服务拒绝了当前凭证，请检查 API Key。',
    });
  });

  it('never exposes an upstream error body or secret', async () => {
    const service = new ConnectionTestService(
      resolver({
        testConnection: async () => {
          throw new Error('upstream said API key sk-private-secret is invalid');
        },
      }),
    );

    const result = await service.test('text');
    expect(result).toMatchObject({
      ok: false,
      status: 'error',
      message: '连接测试失败，请检查配置后重试。',
    });
    expect(JSON.stringify(result)).not.toContain('sk-private-secret');
    expect(JSON.stringify(result)).not.toContain('upstream said');
  });
});
