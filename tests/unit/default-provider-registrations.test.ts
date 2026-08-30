import { describe, expect, it, vi } from 'vitest';

import { createDefaultProviderRegistrations } from '../../src/main/providers/default-provider-registrations';
import type { ProviderConfig } from '../../src/domain/config';

function mockTransport(route: 'direct' | 'http_proxy') {
  return {
    fetch: vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
    getRoute: () => route,
  } as never;
}

function config(provider: string): ProviderConfig {
  return {
    id: 'c1',
    kind: 'image',
    provider: provider as ProviderConfig['provider'],
    name: 'n',
    apiKey: 'k',
    baseUrl: 'https://api.example.com/v1',
    model: 'm',
    isActive: true,
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
  };
}

describe('createDefaultProviderRegistrations proxy routing', () => {
  it('routes Doubao / DeepSeek direct, OpenAI (text+image) through the proxy', async () => {
    const proxy = mockTransport('http_proxy');
    const direct = mockTransport('direct');
    const registrations = createDefaultProviderRegistrations(proxy, { direct });

    const expected: Array<[string, string, 'direct' | 'http_proxy']> = [
      ['text', 'doubao', 'direct'],
      ['text', 'deepseek', 'direct'],
      ['text', 'openai', 'http_proxy'],
      ['image', 'openai', 'http_proxy'],
    ];
    for (const [kind, provider, route] of expected) {
      const reg = registrations.find((r) => r.kind === kind && r.provider === provider);
      expect(reg, `missing registration ${kind}/${provider}`).toBeDefined();
      const instance = reg!.create(config(provider)) as unknown as {
        testConnection(signal: AbortSignal): Promise<{ route: string }>;
      };
      const result = await instance.testConnection(new AbortController().signal);
      expect(result.route, `${provider} should route ${route}`).toBe(route);
    }
  });
});
