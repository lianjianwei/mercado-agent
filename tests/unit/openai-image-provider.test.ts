import { describe, expect, it, vi } from 'vitest';
import { OpenAiImageProvider } from '../../src/main/providers/image/openai';
import { ProviderAuthenticationError } from '../../src/domain/providers';

const cfg = { baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'gpt-image-2' };

function transport(responseFactory: () => Response) {
  return {
    fetch: vi.fn(async (url: string, init: RequestInit) => {
      // assert url + method + multipart body has image; return the factory response
      void url; void init;
      return responseFactory();
    }),
    getRoute: () => 'direct' as const,
  };
}

describe('OpenAiImageProvider', () => {
  it('posts multipart to /images/edits and returns base64 from data[0].b64_json', async () => {
    const download = vi.fn(async () => Buffer.from('refbytes'));
    const network = transport(() =>
      new Response(JSON.stringify({ data: [{ b64_json: 'B64DATA' }] }), { status: 200 }),
    );
    const provider = new OpenAiImageProvider(cfg, network, download);
    const results = await provider.generate({ prompt: 'white bg main', referenceImageUrls: ['https://x/ref.png'] }, new AbortController().signal);
    expect(results[0].dataBase64).toBe('B64DATA');
    expect(network.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (network.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/images/edits');
    expect(String(init.method)).toBe('POST');
    const body = init.body as FormData;
    expect(body.get('prompt')).toBe('white bg main');
    expect(body.get('model')).toBe('gpt-image-2');
    expect(body.get('size')).toBe('1024x1024');
    expect(download).toHaveBeenCalledWith('https://x/ref.png', expect.anything());
  });

  it('throws ProviderAuthenticationError on 401', async () => {
    const network = transport(() => new Response('', { status: 401 }));
    const provider = new OpenAiImageProvider(cfg, network, async () => Buffer.from('x'));
    await expect(provider.generate({ prompt: 'p', referenceImageUrls: ['https://x/r.png'] }, new AbortController().signal))
      .rejects.toThrow(ProviderAuthenticationError);
  });
});
