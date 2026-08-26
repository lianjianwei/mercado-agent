import type { ProviderKind } from '../../domain/config';
import {
  type ConnectionResult,
  type ModelConnectionProvider,
  ProviderAuthenticationError,
  ProviderRegionRestrictedError,
  ProviderUnavailableError,
} from '../../domain/providers';
import { ModelProxyConnectionError } from '../network/model-network-errors';
import type { NetworkRoute } from '../network/model-network-client';

type ActiveProviderResolver = {
  createActive(kind: ProviderKind): ModelConnectionProvider;
};

const DEFAULT_TIMEOUT_MS = 15_000;

export class ConnectionTestService {
  constructor(
    private readonly providers: ActiveProviderResolver,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
    private readonly getRoute: () => NetworkRoute = () => 'direct',
  ) {}

  async test(
    kind: ProviderKind,
    externalSignal?: AbortSignal,
  ): Promise<ConnectionResult> {
    const startedAt = performance.now();
    if (externalSignal?.aborted) {
      return this.failure('cancelled', '连接测试已取消。', startedAt);
    }

    let provider: ModelConnectionProvider;
    try {
      provider = this.providers.createActive(kind);
    } catch {
      return this.failure(
        'error',
        `${kind === 'text' ? '文本' : '生图'}模型没有可测试的启用配置。`,
        startedAt,
      );
    }

    const controller = new AbortController();
    let timeoutTriggered = false;
    const onExternalAbort = () => controller.abort();
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    const timeout = setTimeout(() => {
      timeoutTriggered = true;
      controller.abort();
    }, this.timeoutMs);

    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener(
        'abort',
        () => reject(new DOMException('aborted', 'AbortError')),
        { once: true },
      );
    });

    try {
      const result = await Promise.race([
        provider.testConnection(controller.signal),
        aborted,
      ]);
      return {
        ...result,
        latencyMs: this.elapsed(startedAt),
        route: this.getRoute(),
      };
    } catch (error) {
      if (controller.signal.aborted) {
        return timeoutTriggered
          ? this.failure(
              'timeout',
              '连接测试超时，请检查网络或 Base URL。',
              startedAt,
            )
          : this.failure('cancelled', '连接测试已取消。', startedAt);
      }
      if (error instanceof ProviderAuthenticationError) {
        return this.failure(
          'authentication_error',
          error.message,
          startedAt,
        );
      }
      if (error instanceof ProviderUnavailableError) {
        return this.failure('unavailable', error.message, startedAt);
      }
      if (
        error instanceof ProviderRegionRestrictedError ||
        error instanceof ModelProxyConnectionError
      ) {
        return this.failure('unavailable', error.message, startedAt);
      }
      return this.failure(
        'error',
        '连接测试失败，请检查配置后重试。',
        startedAt,
      );
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }
  }

  private failure(
    status: ConnectionResult['status'],
    message: string,
    startedAt: number,
  ): ConnectionResult {
    return {
      ok: false,
      status,
      message,
      latencyMs: this.elapsed(startedAt),
      route: this.getRoute(),
    };
  }

  private elapsed(startedAt: number): number {
    return Math.max(0, Math.round(performance.now() - startedAt));
  }
}
