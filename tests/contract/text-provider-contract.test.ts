import { describe, expect, it, vi } from 'vitest';

import type { MultimodalRequest } from '../../src/domain/providers';
import { DoubaoTextProvider } from '../../src/main/providers/text/doubao';
import { DeepSeekTextProvider } from '../../src/main/providers/text/deepseek';
import { OpenAiTextProvider } from '../../src/main/providers/text/openai';
import type { ModelNetworkTransport } from '../../src/main/network/model-network-client';

type ProviderConstructor = new (
  configuration: { baseUrl: string; apiKey: string; model: string },
  network: ModelNetworkTransport,
) => { generate(request: MultimodalRequest, signal: AbortSignal): Promise<unknown> };

const providers: Array<{ name: string; provider: ProviderConstructor; baseUrl: string }> = [
  { name: 'doubao', provider: DoubaoTextProvider, baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  { name: 'deepseek', provider: DeepSeekTextProvider, baseUrl: 'https://api.deepseek.com' },
  { name: 'openai', provider: OpenAiTextProvider, baseUrl: 'https://api.openai.com/v1' },
];

function fakeResponse(content: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

function requestBody(fetcher: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
  return { url, ...(init.body ? JSON.parse(String(init.body)) : {}) };
}

describe('text provider multimodal contract', () => {
  for (const { name, provider: Provider, baseUrl } of providers) {
    describe(`${name} text provider`, () => {
      it('sends an OpenAI-compatible multimodal request with text and image_url blocks', async () => {
        const fetcher = vi.fn(async () => fakeResponse({ level: 'low' }));
        const network = { fetch: fetcher, getRoute: () => 'direct' as const };
        const adapter = new Provider({ baseUrl, apiKey: 'ak-test', model: 'vision-model' }, network);

        const result = await adapter.generate(
          { prompt: 'Analyze this product for infringement', imageUrls: ['https://img.example/1.jpg'] },
          new AbortController().signal,
        );

        expect(result).toEqual({ level: 'low' });
        const { url, ...body } = requestBody(fetcher);
        expect(url).toBe(`${baseUrl}/chat/completions`);
        expect(body).toMatchObject({
          model: 'vision-model',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Analyze this product for infringement' },
                {
                  type: 'image_url',
                  image_url: { url: 'https://img.example/1.jpg', detail: 'low' },
                },
              ],
            },
          ],
        });
      });

      it('sends only text when no images are provided', async () => {
        const fetcher = vi.fn(async () => fakeResponse({ level: 'none' }));
        const adapter = new Provider(
          { baseUrl, apiKey: 'ak-test', model: 'vision-model' },
          { fetch: fetcher, getRoute: () => 'direct' as const },
        );

        await adapter.generate({ prompt: 'Only text' }, new AbortController().signal);
        const body = requestBody(fetcher);
        const content = body.messages as Array<{ content: unknown }>;
        expect(content[0]?.content).toEqual([{ type: 'text', text: 'Only text' }]);
      });

      it('maps a 401 to a typed authentication error', async () => {
        const adapter = new Provider(
          { baseUrl, apiKey: 'bad-key', model: 'vision-model' },
          {
            fetch: async () => new Response('unauthorized', { status: 401 }),
            getRoute: () => 'direct' as const,
          },
        );

        await expect(
          adapter.generate({ prompt: 'x' }, new AbortController().signal),
        ).rejects.toMatchObject({ name: 'ProviderAuthenticationError' });
      });

      it('maps a non-OK response to a typed unavailable error', async () => {
        const adapter = new Provider(
          { baseUrl, apiKey: 'ak-test', model: 'vision-model' },
          {
            fetch: async () => new Response('rate limited', { status: 429 }),
            getRoute: () => 'direct' as const,
          },
        );

        await expect(
          adapter.generate({ prompt: 'x' }, new AbortController().signal),
        ).rejects.toMatchObject({ name: 'ProviderUnavailableError' });
      });

      it('throws a structured-output error when content is not valid JSON', async () => {
        const adapter = new Provider(
          { baseUrl, apiKey: 'ak-test', model: 'vision-model' },
          {
            fetch: async () =>
              new Response(JSON.stringify({ choices: [{ message: { content: 'not-json' } }] })),
            getRoute: () => 'direct' as const,
          },
        );

        await expect(
          adapter.generate({ prompt: 'x' }, new AbortController().signal),
        ).rejects.toMatchObject({ name: 'ModelStructuredOutputError' });
      });

      it('propagates cancellation via the signal', async () => {
        const controller = new AbortController();
        const fetcher = vi.fn(
          async () =>
            new Promise<Response>((resolve) => {
              controller.signal.addEventListener('abort', () => {
                resolve(new Response('aborted', { status: 499 }));
              });
            }),
        );
        const adapter = new Provider(
          { baseUrl, apiKey: 'ak-test', model: 'vision-model' },
          { fetch: fetcher, getRoute: () => 'direct' as const },
        );

        const promise = adapter.generate({ prompt: 'x' }, controller.signal);
        controller.abort();
        await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
      });
    });
  }
});
