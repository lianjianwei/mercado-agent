import { describe, expect, it, vi } from 'vitest';

import { ProviderAuthenticationError } from '../../src/domain/providers';
import { BearerModelConnectionProvider } from '../../src/main/providers/bearer-model-connection-provider';

describe('BearerModelConnectionProvider', () => {
  it('checks the models endpoint with bearer authentication', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    const provider = new BearerModelConnectionProvider(
      {
        baseUrl: 'https://api.example.test/v1/',
        apiKey: 'private-key',
      },
      fetcher,
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
      async () =>
        new Response('secret key private-key is invalid', { status: 401 }),
    );

    await expect(
      provider.testConnection(new AbortController().signal),
    ).rejects.toBeInstanceOf(ProviderAuthenticationError);
  });
});
