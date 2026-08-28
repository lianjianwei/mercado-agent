import type { FxRateRepository, FxRates } from '../../domain/net-profit';

export const FX_API_URL = 'https://open.er-api.com/v6/latest/USD';

export type JsonFetcher = (url: string) => Promise<{ json(): Promise<unknown> }>;

// Fetches USD reference rates from the free ExchangeRate-API endpoint and
// caches them locally. Callers fall back to the cached snapshot (or the
// built-in defaults) while offline.
export class FxRateService {
  private readonly fetcher: JsonFetcher;

  constructor(
    private readonly repo: FxRateRepository,
    fetcher?: JsonFetcher,
  ) {
    this.fetcher = fetcher ?? ((url: string) => fetch(url));
  }

  async refresh(): Promise<FxRates> {
    const response = await this.fetcher(FX_API_URL);
    const body = (await response.json()) as {
      result?: string;
      time_last_update_utc?: string;
      rates?: Record<string, number>;
    };
    if (body.result !== 'success' || !body.rates) {
      throw new Error('汇率接口返回异常');
    }
    const { CNY, MXN, BRL, ARS } = body.rates;
    if (!(CNY && MXN && BRL && ARS)) {
      throw new Error('汇率接口缺少所需币种');
    }
    const rates: FxRates = {
      cny: CNY,
      mxn: MXN,
      brl: BRL,
      ars: ARS,
      updatedAt: body.time_last_update_utc ?? new Date().toISOString(),
    };
    this.repo.saveFxRates(rates);
    return rates;
  }
}
