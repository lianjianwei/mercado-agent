import { describe, expect, it, vi } from 'vitest';

import {
  ProviderAuthenticationError,
  ProviderRegionRestrictedError,
} from '../../src/domain/providers';
import { ModelProxyConnectionError } from '../../src/main/network/model-network-errors';
import { BearerModelConnectionProvider } from '../../src/main/providers/bearer-model-connection-provider';

describe('BearerModelConnectionProvider', () => {
  it('checks the models endpoint with bearer authentication', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    const network = { fetch: fetcher, getRoute: () => 'http_proxy' as const };
    const provider = new BearerModelConnectionProvider(
      {
        baseUrl: 'https://api.example.test/v1/',
        apiKey: 'private-key',
      },
      network,
    );

    await expect(
      provider.testConnection(new AbortController().signal),
    ).resolves.toMatchObject({ ok: true, status: 'success' });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.test/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer private-key' },
      }),
    );
  });

  it('maps 401 and 403 responses to a safe authentication error', async () => {
    const provider = new BearerModelConnectionProvider(
      { baseUrl: 'https://api.example.test/v1', apiKey: 'private-key' },
      {
        fetch: async () =>
          new Response('secret key private-key is invalid', { status: 401 }),
        getRoute: () => 'direct',
      },
    );

    await expect(
      provider.testConnection(new AbortController().signal),
    ).rejects.toBeInstanceOf(ProviderAuthenticationError);
  });

  it('reports a region-restricted upstream without exposing its body', async () => {
    const provider = new BearerModelConnectionProvider(
      { baseUrl: 'https://api.example.test/v1', apiKey: 'private-key' },
      {
        fetch: async () => new Response('blocked response secret', { status: 451 }),
        getRoute: () => 'direct',
      },
    );

    await expect(
      provider.testConnection(new AbortController().signal),
    ).rejects.toBeInstanceOf(ProviderRegionRestrictedError);
  });

  it('preserves a typed local proxy connection error', async () => {
    const provider = new BearerModelConnectionProvider(
      { baseUrl: 'https://api.example.test/v1', apiKey: 'private-key' },
      {
        fetch: async () => {
          throw new ModelProxyConnectionError();
        },
        getRoute: () => 'http_proxy',
      },
    );

    await expect(
      provider.testConnection(new AbortController().signal),
    ).rejects.toBeInstanceOf(ModelProxyConnectionError);
  });
});
