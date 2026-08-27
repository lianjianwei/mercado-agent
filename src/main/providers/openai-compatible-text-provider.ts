import type {
  ConnectionResult,
  MultimodalRequest,
  TextModelProvider,
} from '../../domain/providers';
import {
  ProviderAuthenticationError,
  ProviderRegionRestrictedError,
  ProviderUnavailableError,
} from '../../domain/providers';
import { ModelProxyConnectionError } from '../network/model-network-errors';
import type { ModelNetworkTransport } from '../network/model-network-client';

export type TextProviderConfiguration = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export class ModelStructuredOutputError extends Error {
  constructor(message = '模型返回内容不是有效的 JSON，无法解析结构化结果。') {
    super(message);
    this.name = 'ModelStructuredOutputError';
  }
}

export class OpenAiCompatibleTextProvider implements TextModelProvider {
  constructor(
    protected readonly configuration: TextProviderConfiguration,
    protected readonly network: ModelNetworkTransport,
  ) {}

  async testConnection(signal: AbortSignal): Promise<ConnectionResult> {
    let response: Response;
    try {
      response = await this.network.fetch(this.modelsUrl(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.configuration.apiKey}`,
        },
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof ModelProxyConnectionError) throw error;
      throw new ProviderUnavailableError();
    }

    if (response.status === 401 || response.status === 403) {
      throw new ProviderAuthenticationError();
    }
    if (response.status === 451) throw new ProviderRegionRestrictedError();
    if (!response.ok) throw new ProviderUnavailableError();

    return {
      ok: true,
      status: 'success',
      message: '模型服务连接成功。',
      latencyMs: 0,
      route: this.network.getRoute(),
    };
  }

  async generate(
    request: MultimodalRequest,
    signal: AbortSignal,
  ): Promise<unknown> {
    const content: Array<Record<string, unknown>> = [
      { type: 'text', text: request.prompt },
    ];
    for (const imageUrl of request.imageUrls ?? []) {
      content.push({
        type: 'image_url',
        image_url: { url: imageUrl, detail: 'low' },
      });
    }

    let response: Response;
    try {
      response = await this.network.fetch(this.chatUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.configuration.apiKey}`,
        },
        body: JSON.stringify({
          model: this.configuration.model,
          messages: [{ role: 'user', content }],
        }),
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof ModelProxyConnectionError) throw error;
      throw new ProviderUnavailableError();
    }

    if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    if (response.status === 401 || response.status === 403) {
      throw new ProviderAuthenticationError();
    }
    if (response.status === 451) throw new ProviderRegionRestrictedError();
    if (!response.ok) throw new ProviderUnavailableError();

    const text = await response.text();
    return this.parseStructuredContent(text);
  }

  private parseStructuredContent(text: string): unknown {
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ModelStructuredOutputError();
    }
    const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> })
      .choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new ModelStructuredOutputError();
    }
    try {
      return JSON.parse(content);
    } catch {
      throw new ModelStructuredOutputError();
    }
  }

  private chatUrl(): string {
    return `${this.configuration.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  }

  private modelsUrl(): string {
    return `${this.configuration.baseUrl.replace(/\/+$/, '')}/models`;
  }
}
