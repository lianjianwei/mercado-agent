import type { ImageGenerationRequest, ImageModelProvider, ImageResult, ConnectionResult } from '../../../domain/providers';
import { ProviderAuthenticationError, ProviderRegionRestrictedError, ProviderUnavailableError } from '../../../domain/providers';
import type { ModelNetworkTransport } from '../../network/model-network-client';

export type OpenAiImageConfig = { baseUrl: string; apiKey: string; model: string };
type Download = (url: string, signal: AbortSignal) => Promise<Buffer>;

export class OpenAiImageProvider implements ImageModelProvider {
  constructor(
    private readonly configuration: OpenAiImageConfig,
    private readonly network: ModelNetworkTransport,
    private readonly download: Download,
  ) {}

  async testConnection(signal?: AbortSignal): Promise<ConnectionResult> {
    try {
      const response = await this.network.fetch(`${this.base()}/models`, {
        method: 'GET', headers: { Authorization: `Bearer ${this.configuration.apiKey}` }, signal,
      });
      if (response.status === 401 || response.status === 403) throw new ProviderAuthenticationError();
      if (response.status === 451) throw new ProviderRegionRestrictedError();
      if (!response.ok) throw new ProviderUnavailableError();
      return { ok: true, status: 'success', message: '生图模型连接成功。', latencyMs: 0, route: this.network.getRoute() };
    } catch (error) {
      if (error instanceof ProviderAuthenticationError || error instanceof ProviderRegionRestrictedError) throw error;
      if (signal?.aborted) throw error;
      throw new ProviderUnavailableError();
    }
  }

  async generate(request: ImageGenerationRequest, signal: AbortSignal): Promise<ImageResult[]> {
    const form = new FormData();
    form.set('model', this.configuration.model);
    form.set('prompt', request.prompt);
    form.set('size', '1024x1024');
    form.set('quality', 'high');
    form.set('output_format', 'png');
    form.set('n', '1');
    for (const url of request.referenceImageUrls ?? []) {
      const bytes = await this.download(url, signal);
      form.append('image', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'ref.png');
    }

    let response: Response;
    try {
      response = await this.network.fetch(`${this.base()}/images/edits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.configuration.apiKey}` },
        body: form,
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new ProviderUnavailableError();
    }
    if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    if (response.status === 401 || response.status === 403) throw new ProviderAuthenticationError();
    if (response.status === 451) throw new ProviderRegionRestrictedError();
    if (!response.ok) throw new ProviderUnavailableError();

    const payload = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
    return (payload.data ?? []).map((item) => ({ url: item.url ?? '', dataBase64: item.b64_json }));
  }

  private base(): string {
    return this.configuration.baseUrl.replace(/\/+$/, '');
  }
}
