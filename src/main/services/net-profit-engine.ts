import {
  SITE_META_BY_CODE,
  siteMetaFor,
  type FxRates,
  type NetProfitBreakdown,
  type NetProfitConfig,
  type ShippingTier,
} from '../../domain/net-profit';

// Local net-profit calculation engine (pure functions, no side effects).
//
// Given a SKU's source price / weight / dimensions, the publish sites, the
// target-margin config and fx rates, it solves the net proceeds (净收益) a
// seller must enter so the platform's added commission + shipping yield the
// target margin. Output field names match Miaoshou 1:1: per-site
// siteAndPriceMap (net profit, keyed by full site key like 'MX(Up)') and
// siteAndListingTypeInfoMap (product type, keyed by bare code like 'MX').

export function billableWeightKg(
  weightG: number,
  lengthCm: number,
  widthCm: number,
  heightCm: number,
): number {
  const actual = weightG / 1000;
  if (actual < 0.5) return actual;
  const volume = (lengthCm * widthCm * heightCm) / 6000;
  return Math.max(actual, volume);
}

export function findTier(
  tiers: readonly ShippingTier[],
  billableKg: number,
): ShippingTier {
  // 上限含界:重量正好落在两档边界(如 0.2)时归入较低档([0.1, 0.2]),
  // 与参考计算器 `billable <= r[1]` 一致。
  const tier = tiers.find((candidate) => billableKg <= candidate[1]);
  return tier ?? tiers[tiers.length - 1];
}

export function formatNetProfit(value: number): string {
  return String(Math.round(value * 100) / 100);
}

export function listingTypeFor(
  siteCode: string,
  sourcePriceCny: number,
  weightG: number,
): 'gold_special' | 'gold_pro' {
  if (siteCode === 'AR') return 'gold_special';
  // 经典:货源价 ≤ 10 元 且 重量 ≤ 200g;否则铂金。边界含界(10 / 200 都算经典)。
  return sourcePriceCny <= 10 && weightG <= 200 ? 'gold_special' : 'gold_pro';
}

export type SiteNetProfitResult = {
  siteKey: string;
  siteCode: string;
  listingType: 'gold_special' | 'gold_pro';
  netProfit: number;
  netProfitFormatted: string;
  shipping: number;
  price: number;
  isHigh: boolean;
  breakdown: NetProfitBreakdown;
};

export type SiteNetProfitInput = {
  siteKey: string;
  siteCode: string;
  sourcePriceCny: number;
  weightG: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  config: NetProfitConfig;
  fx: FxRates;
};

export function computeSiteNetProfit(input: SiteNetProfitInput): SiteNetProfitResult {
  const meta = siteMetaFor(input.siteKey);
  if (!meta) {
    throw new Error(`不支持的站点:${input.siteKey}`);
  }
  const baseCny = input.sourcePriceCny + input.config.packingCost;
  const rCny = input.fx.cny;
  const rLocal =
    meta.currency === 'MXN' ? input.fx.mxn
    : meta.currency === 'BRL' ? input.fx.brl
    : input.fx.ars;
  const target = input.config.targetMargin / 100;
  const listingType = listingTypeFor(input.siteCode, input.sourcePriceCny, input.weightG);
  const commissionPct =
    listingType === 'gold_pro' ? input.config.commission.premium : input.config.commission.classic;
  const comm = commissionPct / 100;
  const billable = billableWeightKg(
    input.weightG,
    input.lengthCm,
    input.widthCm,
    input.heightCm,
  );
  const tier = findTier(meta.tiers, billable);
  const shipHigh = tier[2];
  const shipLow = tier[3];
  // 体积重口径:实际重 ≥ 500g 时与体积重比较取大者,命中体积重时标记。
  const actualKg = input.weightG / 1000;
  const volumeKg = (input.lengthCm * input.widthCm * input.heightCm) / 6000;
  const isVolumeWeight = actualKg >= 0.5 && volumeKg > actualKg;

  const solveMode2 = (shipping: number): number => {
    const numerator = baseCny / rCny + (target * shipping) / (1 - comm);
    const denominator = 1 - target / (1 - comm);
    return numerator / denominator;
  };

  let net: number;
  if (input.config.marginMode === 'income') {
    net = baseCny / (rCny * (1 - target));
  } else {
    net = solveMode2(shipLow);
  }

  const belowPrice = (net + shipLow) / (1 - comm);
  const isHigh = belowPrice * rLocal >= meta.threshold;
  const shipping = isHigh ? shipHigh : shipLow;

  if (input.config.marginMode === 'price' && isHigh) {
    net = solveMode2(shipHigh);
  }

  const price = (net + shipping) / (1 - comm);
  return {
    siteKey: input.siteKey,
    siteCode: input.siteCode,
    listingType,
    netProfit: net,
    netProfitFormatted: formatNetProfit(net),
    shipping,
    price,
    isHigh,
    breakdown: {
      siteKey: input.siteKey,
      siteCode: input.siteCode,
      currency: meta.currency,
      sourcePriceCny: input.sourcePriceCny,
      packingCostCny: input.config.packingCost,
      weightG: input.weightG,
      lengthCm: input.lengthCm,
      widthCm: input.widthCm,
      heightCm: input.heightCm,
      billableKg: billable,
      isVolumeWeight,
      targetMargin: input.config.targetMargin,
      marginMode: input.config.marginMode,
      listingType,
      commissionPct,
      fxCny: rCny,
      fxLocal: rLocal,
      siteThreshold: meta.threshold,
      isHigh,
      tier: {
        minKg: tier[0],
        maxKg: tier[1],
        highPriceUsd: shipHigh,
        lowPriceUsd: shipLow,
      },
      shippingUsd: shipping,
      priceUsd: price,
      netProfitUsd: net,
    },
  };
}

export type SkuNetProfitInput = {
  sourcePriceCny: number;
  weightG: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  sites: string[];
  config: NetProfitConfig;
  fx: FxRates;
};

export type SkuNetProfitResult = {
  siteAndPriceMap: Record<string, string>;
  siteAndListingTypeInfoMap: Record<string, { listingType: string }>;
  // 每个站点的计算明细,按裸站点码索引(对齐 siteAndListingTypeInfoMap)。
  siteNetProfitDetail: Record<string, NetProfitBreakdown>;
};

export function computeSkuNetProfit(input: SkuNetProfitInput): SkuNetProfitResult {
  const siteAndPriceMap: Record<string, string> = {};
  const siteAndListingTypeInfoMap: Record<string, { listingType: string }> = {};
  const siteNetProfitDetail: Record<string, NetProfitBreakdown> = {};
  for (const siteKey of input.sites) {
    const meta = siteMetaFor(siteKey);
    if (!meta) continue;
    const result = computeSiteNetProfit({
      siteKey,
      siteCode: meta.code,
      sourcePriceCny: input.sourcePriceCny,
      weightG: input.weightG,
      lengthCm: input.lengthCm,
      widthCm: input.widthCm,
      heightCm: input.heightCm,
      config: input.config,
      fx: input.fx,
    });
    siteAndPriceMap[siteKey] = result.netProfitFormatted;
    siteAndListingTypeInfoMap[result.siteCode] = { listingType: result.listingType };
    siteNetProfitDetail[result.siteCode] = result.breakdown;
  }
  return { siteAndPriceMap, siteAndListingTypeInfoMap, siteNetProfitDetail };
}

// Re-exported for callers that need the supported-site guard.
export { SITE_META_BY_CODE };
