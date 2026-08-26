import {
  type ConnectionResult,
  type ModelConnectionProvider,
  ProviderAuthenticationError,
  ProviderUnavailableError,
} from '../../domain/providers';

type BearerConfiguration = {
  baseUrl: string;
  apiKey: string;
};

type Fetcher = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export class BearerModelConnectionProvider
  implements ModelConnectionProvider
{
  constructor(
    private readonly configuration: BearerConfiguration,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async testConnection(signal: AbortSignal): Promise<ConnectionResult> {
    let response: Response;
    try {
      response = await this.fetcher(this.modelsUrl(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.configuration.apiKey}`,
        },
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new ProviderUnavailableError();
    }

    if (response.status === 401 || response.status === 403) {
      throw new ProviderAuthenticationError();
    }
    if (!response.ok) throw new ProviderUnavailableError();

    return {
      ok: true,
      status: 'success',
      message: '模型服务连接成功。',
      latencyMs: 0,
    };
  }

  private modelsUrl(): string {
    return `${this.configuration.baseUrl.replace(/\/+$/, '')}/models`;
  }
}
