import { describe, expect, it, vi } from 'vitest';
import {
  IPC_CHANNELS,
  type IpcListener,
  type IpcRegistrar,
} from '../../src/shared/ipc-contract';
import { registerNetProfitHandlers } from '../../src/main/ipc/net-profit-handlers';
import {
  DEFAULT_FX_RATES,
  DEFAULT_NET_PROFIT_CONFIG,
  type FxRateRepository,
  type NetProfitSettingsRepository,
} from '../../src/domain/net-profit';

function registrarOf(): { registrar: IpcRegistrar; handlers: Map<string, IpcListener> } {
  const handlers = new Map<string, IpcListener>();
  return { registrar: { handle: (channel, listener) => handlers.set(channel, listener) }, handlers };
}

describe('net-profit handlers', () => {
  it('serves the current config and fx snapshot', async () => {
    const { registrar, handlers } = registrarOf();
    registerNetProfitHandlers(registrar, {
      settings: { getNetProfitConfig: () => DEFAULT_NET_PROFIT_CONFIG, saveNetProfitConfig: vi.fn() },
      fxRates: { getFxRates: () => ({ ...DEFAULT_FX_RATES, cny: 7.3 }), saveFxRates: vi.fn() },
      refreshRates: vi.fn(),
    });

    const result = await handlers.get(IPC_CHANNELS.netProfitGetConfig)!({}, undefined);

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.data).toEqual({
        config: DEFAULT_NET_PROFIT_CONFIG,
        fxRates: { ...DEFAULT_FX_RATES, cny: 7.3 },
      });
    }
  });

  it('saves a config and returns it', async () => {
    const { registrar, handlers } = registrarOf();
    const save = vi.fn();
    registerNetProfitHandlers(registrar, {
      settings: { getNetProfitConfig: () => DEFAULT_NET_PROFIT_CONFIG, saveNetProfitConfig: save },
      fxRates: { getFxRates: () => ({ ...DEFAULT_FX_RATES }), saveFxRates: vi.fn() },
      refreshRates: vi.fn(),
    });

    const next = { ...DEFAULT_NET_PROFIT_CONFIG, targetMargin: 30 };
    const result = await handlers.get(IPC_CHANNELS.netProfitSaveConfig)!({}, { config: next });

    expect(save).toHaveBeenCalledWith(next);
    expect(result).toEqual({ ok: true, data: next });
  });

  it('refreshes rates through the injected function', async () => {
    const { registrar, handlers } = registrarOf();
    const refreshed = { ...DEFAULT_FX_RATES, cny: 7.4, updatedAt: '2026-08-29' };
    registerNetProfitHandlers(registrar, {
      settings: { getNetProfitConfig: () => DEFAULT_NET_PROFIT_CONFIG, saveNetProfitConfig: vi.fn() },
      fxRates: { getFxRates: () => ({ ...DEFAULT_FX_RATES }), saveFxRates: vi.fn() },
      refreshRates: vi.fn(async () => refreshed),
    });

    const result = await handlers.get(IPC_CHANNELS.netProfitRefreshRates)!({}, undefined);

    expect(result).toEqual({ ok: true, data: refreshed });
  });
});
