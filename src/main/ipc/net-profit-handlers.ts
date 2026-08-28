import { z, ZodError } from 'zod';

import { IPC_CHANNELS, type IpcRegistrar } from '../../shared/ipc-contract';
import { netProfitConfigSchema } from '../../shared/net-profit-schemas';
import type {
  FxRateRepository,
  FxRates,
  NetProfitSettingsRepository,
} from '../../domain/net-profit';

const saveConfigSchema = z.strictObject({ config: netProfitConfigSchema });

type NetProfitHandlerDependencies = {
  settings: NetProfitSettingsRepository;
  fxRates: FxRateRepository;
  refreshRates: () => Promise<FxRates>;
};

export function registerNetProfitHandlers(
  registrar: IpcRegistrar,
  dependencies: NetProfitHandlerDependencies,
): void {
  registrar.handle(IPC_CHANNELS.netProfitGetConfig, async () => {
    try {
      return {
        ok: true as const,
        data: {
          config: dependencies.settings.getNetProfitConfig(),
          fxRates: dependencies.fxRates.getFxRates(),
        },
      };
    } catch (error) {
      return {
        ok: false as const,
        error: {
          code: 'INTERNAL_ERROR' as const,
          message: error instanceof Error ? error.message : '净收益配置读取失败',
        },
      };
    }
  });

  registrar.handle(IPC_CHANNELS.netProfitSaveConfig, async (_event, payload) => {
    try {
      const { config } = saveConfigSchema.parse(payload);
      dependencies.settings.saveNetProfitConfig(config);
      return { ok: true as const, data: config };
    } catch (error) {
      if (error instanceof ZodError) {
        return {
          ok: false as const,
          error: { code: 'VALIDATION_ERROR' as const, message: '净收益配置无效' },
        };
      }
      return {
        ok: false as const,
        error: {
          code: 'INTERNAL_ERROR' as const,
          message: error instanceof Error ? error.message : '净收益配置保存失败',
        },
      };
    }
  });

  registrar.handle(IPC_CHANNELS.netProfitRefreshRates, async () => {
    try {
      const rates = await dependencies.refreshRates();
      return { ok: true as const, data: rates };
    } catch (error) {
      return {
        ok: false as const,
        error: {
          code: 'INTERNAL_ERROR' as const,
          message: error instanceof Error ? error.message : '汇率刷新失败',
        },
      };
    }
  });
}
