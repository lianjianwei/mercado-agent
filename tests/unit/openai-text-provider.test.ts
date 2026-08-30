import { describe, expect, it, vi } from 'vitest';

import { OpenAiTextProvider } from '../../src/main/providers/text/openai';
import type { TextProviderConfiguration } from '../../src/main/providers/openai-compatible-text-provider';

function transport(capture: { url?: string; init?: RequestInit }) {
  return {
    fetch: vi.fn(async (url: string, init: RequestInit) => {
      capture.url = url;
      capture.init = init;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"title":"x","description":"d","model":"m","skus":[]}' } }] }),
        { status: 200 },
      );
    }),
    getRoute: () => 'direct' as const,
  };
}

const cfg: TextProviderConfiguration = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'k',
  model: 'gpt-5.6-terra',
};

describe('OpenAiTextProvider reasoning_effort', () => {
  it('includes reasoning_effort in the body when configured', async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const network = transport(capture);
    const provider = new OpenAiTextProvider({ ...cfg, reasoningEffort: 'high' }, network);

    await provider.generate({ prompt: 'p' }, new AbortController().signal);

    expect(capture.url).toBe('https://api.example.com/v1/chat/completions');
    const body = JSON.parse(String(capture.init?.body));
    expect(body.reasoning_effort).toBe('high');
  });

  it('omits reasoning_effort when not configured', async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const network = transport(capture);
    const provider = new OpenAiTextProvider(cfg, network);

    await provider.generate({ prompt: 'p' }, new AbortController().signal);

    const body = JSON.parse(String(capture.init?.body));
    expect(body.reasoning_effort).toBeUndefined();
  });
});
