// Net-profit domain model: config, fx rates, and the built-in per-site
// shipping tier tables used by the local net-profit engine. The tiers are
// Cainiao pricing estimates (not live bills); MX/BR come from the reference
// calculator, AR from MercadoLibre's official table (see
// docs/美客多净利润计算器.md). Each tier is [minKg, maxKg, highPriceUsd,
// lowPriceUsd], where high/low is chosen by the buyer-facing price threshold.

export type MarginMode = 'income' | 'price';

export type NetProfitConfig = {
  targetMargin: number; // e.g. 20 = 20%
  marginMode: MarginMode; // income = 利润÷净收益; price = 利润÷平台发布价
  commission: {
    classic: number; // 经典 gold_special, %
    premium: number; // 铂金 gold_pro, %
  };
  packingCost: number; // 贴单打包费, CNY
};

export type FxRates = {
  cny: number; // USD → CNY
  mxn: number; // USD → MXN
  brl: number; // USD → BRL
  ars: number; // USD → ARS
  updatedAt: string; // ISO time of last fetch; '' = never fetched
};

export const DEFAULT_NET_PROFIT_CONFIG: NetProfitConfig = {
  targetMargin: 20,
  marginMode: 'price',
  commission: { classic: 12, premium: 20 },
  packingCost: 2.5,
};

// Offline fallback only; the app refreshes these from open.er-api.com at
// startup and on demand. ARS is a rough placeholder that refresh overwrites.
export const DEFAULT_FX_RATES: FxRates = {
  cny: 7.18,
  mxn: 17.35,
  brl: 5.5,
  ars: 1450,
  updatedAt: '',
};

export type SiteCode = 'MX' | 'BR' | 'AR';

export type ShippingTier = readonly [
  minKg: number,
  maxKg: number,
  highPriceUsd: number,
  lowPriceUsd: number,
];

export type SiteMeta = {
  code: SiteCode;
  currency: 'MXN' | 'BRL' | 'ARS';
  threshold: number; // buyer price threshold for the high-price shipping column
  tiers: readonly ShippingTier[];
};

export const SITE_META_BY_CODE: Record<SiteCode, SiteMeta> = {
  MX: {
    code: 'MX',
    currency: 'MXN',
    threshold: 299,
    tiers: [
      [0, 0.1, 3.46, 1.46], [0.1, 0.2, 4.76, 1.86], [0.2, 0.3, 5.76, 2.61],
      [0.3, 0.4, 6.31, 3.16], [0.4, 0.5, 6.71, 4.21], [0.5, 0.6, 7.16, 4.71],
      [0.6, 0.7, 7.56, 5.46], [0.7, 0.8, 8.06, 5.81], [0.8, 0.9, 8.56, 6.31],
      [0.9, 1, 9.06, 6.71], [1, 1.5, 10.31, 7.06], [1.5, 2, 12.46, 7.51],
      [2, 2.5, 14.46, 8.86], [2.5, 3, 16.26, 11.21], [3, 3.5, 17.96, 17.96],
      [3.5, 4, 20.06, 20.06], [4, 4.5, 22.26, 22.46], [4.5, 5, 25.76, 25.76],
      [5, 5.5, 28.21, 28.21], [5.5, 6, 29.76, 29.76], [6, 6.5, 32.36, 32.36],
      [6.5, 7, 34.81, 34.81], [7, 7.5, 39.11, 39.11], [7.5, 8, 41.96, 41.96],
      [8, 8.5, 47.36, 47.36], [8.5, 9, 53.16, 53.16], [9, 9.5, 54.96, 54.96],
      [9.5, 10, 60.06, 60.06], [10, 10.5, 79.86, 79.86], [10.5, 11, 88.36, 88.36],
      [11, 11.5, 101.86, 101.86], [11.5, 12, 109.21, 109.21], [12, 12.5, 111.41, 111.41],
      [12.5, 13, 119.41, 119.41], [13, 13.5, 120.86, 120.86], [13.5, 14, 129.51, 129.51],
      [14, 14.5, 130.36, 130.36], [14.5, 15, 139.66, 139.66], [15, Infinity, 148.86, 148.86],
    ],
  },
  BR: {
    code: 'BR',
    currency: 'BRL',
    threshold: 79,
    tiers: [
      [0, 0.1, 4.65, 1.6], [0.1, 0.2, 5.7, 2.25], [0.2, 0.3, 8.1, 2.75],
      [0.3, 0.4, 8.35, 3.6], [0.4, 0.5, 8.9, 3.75], [0.5, 0.6, 9.15, 4.4],
      [0.6, 0.7, 9.6, 4.6], [0.7, 0.8, 10.1, 5.1], [0.8, 0.9, 10.75, 6.15],
      [0.9, 1, 11, 8.2], [1, 1.5, 12.5, 9.1], [1.5, 2, 14.7, 11.4],
      [2, 2.5, 17.1, 14], [2.5, 3, 21.35, 21.35], [3, 3.5, 23.75, 23.75],
      [3.5, 4, 26.1, 26.1], [4, 4.5, 29.95, 29.95], [4.5, 5, 32.45, 32.45],
      [5, 5.5, 38.25, 38.25], [5.5, 6, 45.9, 45.9], [6, 6.5, 48.6, 48.6],
      [6.5, 7, 56.05, 56.05], [7, 7.5, 58.45, 58.45], [7.5, 8, 63.75, 63.75],
      [8, 8.5, 66.7, 66.7], [8.5, 9, 70, 70], [9, 9.5, 80.8, 80.8],
      [9.5, 10, 86.55, 86.55], [10, 10.5, 102.5, 102.5], [10.5, 11, 110.1, 110.1],
      [11, 11.5, 118.4, 118.4], [11.5, 12, 125.8, 125.8], [12, 12.5, 128, 128],
      [12.5, 13, 136, 136], [13, 13.5, 140, 140], [13.5, 14, 146.2, 146.2],
      [14, 14.5, 150, 150], [14.5, 15, 156.4, 156.4], [15, Infinity, 165.6, 165.6],
    ],
  },
  AR: {
    code: 'AR',
    currency: 'ARS',
    threshold: 33000,
    tiers: [
      [0, 0.1, 10.25, 3.85], [0.1, 0.2, 11.4, 4.2], [0.2, 0.3, 12.05, 4.5],
      [0.3, 0.4, 12.5, 4.95], [0.4, 0.5, 13.5, 5.4], [0.5, 0.6, 14.4, 5.95],
      [0.6, 0.7, 14.75, 6.1], [0.7, 0.8, 15.6, 6.5], [0.8, 0.9, 16.55, 7.35],
      [0.9, 1, 17.5, 7.7], [1, 1.5, 20.1, 8.1], [1.5, 2, 23.1, 9.9],
      [2, 2.5, 25.3, 13.55], [2.5, 3, 29.3, 18.95], [3, 3.5, 33.75, 33.75],
      [3.5, 4, 37.6, 37.6], [4, 4.5, 41.3, 41.3], [4.5, 5, 46.5, 46.5],
      [5, 5.5, 49.8, 49.8], [5.5, 6, 53.5, 53.5], [6, 6.5, 57.75, 57.75],
      [6.5, 7, 61.8, 61.8], [7, 7.5, 66.2, 66.2], [7.5, 8, 69.35, 69.35],
      [8, 8.5, 73.5, 73.5], [8.5, 9, 78, 78], [9, 9.5, 82.5, 82.5],
      [9.5, 10, 85.95, 85.95], [10, 10.5, 118.5, 118.5], [10.5, 11, 130, 130],
      [11, 11.5, 134.8, 134.8], [11.5, 12, 137.5, 137.5], [12, 12.5, 140, 140],
      [12.5, 13, 144.55, 144.55], [13, 13.5, 151.75, 151.75], [13.5, 14, 156.3, 156.3],
      [14, 14.5, 160.2, 160.2], [14.5, 15, 162, 162], [15, Infinity, 162.8, 162.8],
    ],
  },
};

// Miaoshou site keys arrive as 'MX(Up)' / 'BR(Up)' / 'AR(Up)'. Strip the
// parenthetical suffix to get the bare code used for tables and the
// siteAndListingTypeInfoMap keys.
export function normalizeSiteKey(siteKey: string): string {
  return siteKey.replace(/\s*\([^)]*\)$/, '');
}

export function siteMetaFor(siteKey: string): SiteMeta | null {
  const code = normalizeSiteKey(siteKey) as SiteCode;
  return SITE_META_BY_CODE[code] ?? null;
}

export const SITE_LABELS: Record<string, string> = {
  MX: '墨西哥',
  BR: '巴西',
  AR: '阿根廷',
};

export const LISTING_TYPE_LABELS: Record<string, string> = {
  gold_special: '经典',
  gold_pro: '铂金',
};

export interface NetProfitSettingsRepository {
  getNetProfitConfig(): NetProfitConfig;
  saveNetProfitConfig(value: NetProfitConfig): void;
}

export interface FxRateRepository {
  getFxRates(): FxRates;
  saveFxRates(value: FxRates): void;
}
