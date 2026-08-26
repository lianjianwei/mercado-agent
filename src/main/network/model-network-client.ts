import { ModelProxyConnectionError } from './model-network-errors';

export type NetworkRoute = 'direct' | 'http_proxy';

export type ElectronProxyConfig =
  | { mode: 'direct' }
  | { mode: 'fixed_servers'; proxyRules: string };

export interface ModelSessionAdapter {
  setProxy(config: ElectronProxyConfig): Promise<void>;
  closeAllConnections(): Promise<void>;
  fetch(input: string, init: RequestInit): Promise<Response>;
}

export interface ModelNetworkTransport {
  fetch(input: string, init: RequestInit): Promise<Response>;
  getRoute(): NetworkRoute;
}

export class ModelNetworkClient implements ModelNetworkTransport {
  constructor(
    private readonly session: ModelSessionAdapter,
    private readonly route: () => NetworkRoute,
  ) {}

  async fetch(input: string, init: RequestInit): Promise<Response> {
    try {
      return await this.session.fetch(input, init);
    } catch (error) {
      if (
        this.getRoute() === 'http_proxy' &&
        error instanceof Error &&
        error.message.includes('ERR_PROXY_CONNECTION_FAILED')
      ) {
        throw new ModelProxyConnectionError();
      }
      throw error;
    }
  }

  getRoute(): NetworkRoute {
    return this.route();
  }
}
