import { describe, expect, it } from 'vitest';

import type { ModelConnectionProvider } from '../../src/domain/providers';
import { ProviderAuthenticationError } from '../../src/domain/providers';
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
        }),
      }),
      100,
    );

    await expect(service.test('text')).resolves.toMatchObject({
      ok: true,
      status: 'success',
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
