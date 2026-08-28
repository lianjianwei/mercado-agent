import { describe, expect, it } from 'vitest';

import type { ModelSessionAdapter } from '../../src/main/network/model-network-client';
import { ModelNetworkClient } from '../../src/main/network/model-network-client';
import { ModelProxyConnectionError } from '../../src/main/network/model-network-errors';

class FakeSession implements ModelSessionAdapter {
  fetchCalls: string[] = [];
  fetchError?: Error;
  async setProxy() {}
  async closeAllConnections() {}
  async fetch(input: string) {
    this.fetchCalls.push(input);
    if (this.fetchError) throw this.fetchError;
    return new Response('{}', { status: 200 });
  }
}

describe('ModelNetworkClient', () => {
  it('uses only the dedicated session fetch implementation', async () => {
    const session = new FakeSession();
    const client = new ModelNetworkClient(session, () => 'http_proxy');
    const response = await client.fetch('https://models.example.com/v1/models', { method: 'GET' });
    expect(response.status).toBe(200);
    expect(session.fetchCalls).toEqual(['https://models.example.com/v1/models']);
  });

  it('reports the current route', () => {
    const client = new ModelNetworkClient(new FakeSession(), () => 'http_proxy');
    expect(client.getRoute()).toBe('http_proxy');
  });

  it('logs the request start and the response status and duration', async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (message: unknown) => {
      logs.push(String(message));
    };
    try {
      const client = new ModelNetworkClient(new FakeSession(), () => 'direct');
      await client.fetch('https://models.example.com/v1/chat/completions', {
        method: 'POST',
      });
    } finally {
      console.log = originalLog;
    }
    expect(logs[0]).toMatch(/\[model\] POST https:\/\/models\.example\.com\/v1\/chat\/completions …/);
    expect(logs[1]).toMatch(/\[model\] POST .*-> 200 \(\d+ms\)/);
  });

  it('logs a failed request with the error message', async () => {
    const session = new FakeSession();
    session.fetchError = new Error('net::CONNECTION_REFUSED');
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (message: unknown) => {
      errors.push(String(message));
    };
    try {
      const client = new ModelNetworkClient(session, () => 'direct');
      await client.fetch('https://models.example.com/v1/chat/completions', {
        method: 'POST',
      }).catch(() => undefined);
    } finally {
      console.error = originalError;
    }
    expect(errors[0]).toMatch(/\[model\] POST .*FAILED after \d+ms net::CONNECTION_REFUSED/);
  });

  it('maps an unreachable local proxy without falling back to direct fetch', async () => {
    const session = new FakeSession();
    session.fetchError = new Error('net::ERR_PROXY_CONNECTION_FAILED');
    const client = new ModelNetworkClient(session, () => 'http_proxy');
    await expect(client.fetch('https://models.example.com', {})).rejects.toBeInstanceOf(
      ModelProxyConnectionError,
    );
    expect(session.fetchCalls).toHaveLength(1);
  });
});
