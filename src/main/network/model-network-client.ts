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
    const startedAt = Date.now();
    // Model calls run in the main process, so they never appear in the
    // renderer's DevTools Network panel; log them to the terminal instead so
    // a generate/regenerate can be confirmed at a glance.
    const method = init?.method ?? 'GET';
    console.log(`[model] ${method} ${input} …`);
    try {
      const response = await this.session.fetch(input, init);
      const durationMs = Date.now() - startedAt;
      console.log(
        `[model] ${method} ${input} -> ${response.status} (${durationMs}ms)`,
      );
      return response;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[model] ${method} ${input} FAILED after ${durationMs}ms ${detail}`);
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
