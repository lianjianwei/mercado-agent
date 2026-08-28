import { describe, expect, it, vi } from 'vitest';
import { FxRateService, FX_API_URL, type JsonFetcher } from '../../src/main/services/fx-rate-service';
import { DEFAULT_FX_RATES, type FxRateRepository } from '../../src/domain/net-profit';
import type { FxRates } from '../../src/domain/net-profit';

function repo(): FxRateRepository {
  const saved: FxRates[] = [];
  return {
    getFxRates: vi.fn(() => saved[0] ?? { ...DEFAULT_FX_RATES }),
    saveFxRates: vi.fn((value: FxRates) => {
      saved[0] = value;
    }),
  };
}

describe('FxRateService', () => {
  it('fetches, persists and returns fresh rates', async () => {
    const fetcher: JsonFetcher = vi.fn(async (url: string) => {
      expect(url).toBe(FX_API_URL);
      return {
        json: async () => ({
          result: 'success',
          time_last_update_utc: '2026-08-29T00:00:00Z',
          rates: { USD: 1, CNY: 7.2, MXN: 17.5, BRL: 5.6, ARS: 1400 },
        }),
      };
    });
    const store = repo();
    const service = new FxRateService(store, fetcher);

    const rates = await service.refresh();

    expect(rates).toEqual({
      cny: 7.2,
      mxn: 17.5,
      brl: 5.6,
      ars: 1400,
      updatedAt: '2026-08-29T00:00:00Z',
    });
    expect(store.getFxRates().cny).toBe(7.2);
  });

  it('rejects a malformed response without persisting', async () => {
    const fetcher: JsonFetcher = vi.fn(async () => ({
      json: async () => ({ result: 'error', rates: {} }),
    }));
    const store = repo();
    const service = new FxRateService(store, fetcher);

    await expect(service.refresh()).rejects.toThrow();
    expect(store.getFxRates()).toEqual(DEFAULT_FX_RATES);
  });
});
