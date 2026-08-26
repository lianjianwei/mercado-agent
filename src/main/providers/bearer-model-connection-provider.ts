import {
  type ConnectionResult,
  type ModelConnectionProvider,
  ProviderAuthenticationError,
  ProviderRegionRestrictedError,
  ProviderUnavailableError,
} from '../../domain/providers';
import { ModelProxyConnectionError } from '../network/model-network-errors';
import type { ModelNetworkTransport } from '../network/model-network-client';

type BearerConfiguration = {
  baseUrl: string;
  apiKey: string;
};

export class BearerModelConnectionProvider
  implements ModelConnectionProvider
{
  constructor(
    private readonly configuration: BearerConfiguration,
    private readonly network: ModelNetworkTransport,
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

  private modelsUrl(): string {
    return `${this.configuration.baseUrl.replace(/\/+$/, '')}/models`;
  }
}
