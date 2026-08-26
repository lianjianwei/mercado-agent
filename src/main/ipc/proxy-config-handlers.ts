import { ZodError } from 'zod';

import type { ModelProxyConfig } from '../../domain/proxy';
import { modelProxyConfigSchema } from '../../shared/config-schemas';
import { IPC_CHANNELS, type IpcRegistrar } from '../../shared/ipc-contract';

type ProxyConfigService = {
  get(): ModelProxyConfig;
  save(input: ModelProxyConfig): Promise<ModelProxyConfig>;
};

export function registerProxyConfigHandlers(
  registrar: IpcRegistrar,
  service: ProxyConfigService,
): void {
  registrar.handle(IPC_CHANNELS.proxyGet, async () => ({
    ok: true,
    data: service.get(),
  }));
  registrar.handle(IPC_CHANNELS.proxySave, async (_event, payload) => {
    try {
      const input = modelProxyConfigSchema.parse(payload);
      return { ok: true, data: await service.save(input) };
    } catch (error) {
      if (error instanceof ZodError) {
        return {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR' as const,
            message: 'The submitted proxy configuration is invalid',
          },
        };
      }
      return {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR' as const,
          message: error instanceof Error ? error.message : '代理配置无法保存。',
        },
      };
    }
  });
}
