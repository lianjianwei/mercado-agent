import type { SkuEditField, EditDraft } from '../../domain/edit';
import {
  normalizeSiteKey,
  type FxRateRepository,
  type FxRates,
  type NetProfitConfig,
  type NetProfitSettingsRepository,
} from '../../domain/net-profit';
import { computeSkuNetProfit, formatNetProfit } from './net-profit-engine';

// Orchestrates the net-profit engine over a draft: parses each SKU's
// EditField values to numbers, computes per-site net profit + listing type,
// aggregates the product-level global (the max across every SKU × site), and
// writes the three fields back into the draft in Miaoshou's shape. It is
// called after AI generation and again when a draft is saved.

type SkuInputs = {
  sourcePriceCny: number;
  weightG: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
};

function toNumber(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return NaN;
  return Number(value);
}

function parseSkuInputs(sku: SkuEditField): SkuInputs | null {
  const sourcePriceCny = toNumber(sku.sourcePrice?.value);
  if (!Number.isFinite(sourcePriceCny)) return null;
  const weightG = toNumber(sku.package?.weight?.value);
  const lengthCm = toNumber(sku.package?.length?.value);
  const widthCm = toNumber(sku.package?.width?.value);
  const heightCm = toNumber(sku.package?.height?.value);
  return {
    sourcePriceCny,
    weightG: Number.isFinite(weightG) ? weightG : 0,
    lengthCm: Number.isFinite(lengthCm) ? lengthCm : 0,
    widthCm: Number.isFinite(widthCm) ? widthCm : 0,
    heightCm: Number.isFinite(heightCm) ? heightCm : 0,
  };
}

export class NetProfitCalculator {
  constructor(
    private readonly settings: NetProfitSettingsRepository,
    private readonly fxRates: FxRateRepository,
  ) {}

  computeForDraft(draft: EditDraft): EditDraft {
    const config: NetProfitConfig = this.settings.getNetProfitConfig();
    const fx: FxRates = this.fxRates.getFxRates();
    const sites = draft.sites ?? [];

    // 规则计算每个 SKU × 站点,再把用户手动覆盖的净收益/产品类型应用其上
    // (有覆盖的站点用覆盖值,其余沿用计算值)。「我编辑了按我编辑的」由此实现。
    const skus = draft.skus.map((sku) => {
      const inputs = parseSkuInputs(sku);
      if (!inputs) {
        return { ...sku, siteAndPriceMap: {}, siteAndListingTypeInfoMap: {}, siteNetProfitDetail: {} };
      }
      const result = computeSkuNetProfit({ ...inputs, sites, config, fx });
      const siteAndPriceMap = { ...result.siteAndPriceMap };
      const siteAndListingTypeInfoMap = { ...result.siteAndListingTypeInfoMap };
      for (const [code, override] of Object.entries(sku.siteNetProfitOverrides ?? {})) {
        if (override.netProfit != null && override.netProfit.trim() !== '') {
          const rawKey = Object.keys(siteAndPriceMap).find((key) => normalizeSiteKey(key) === code);
          if (rawKey) siteAndPriceMap[rawKey] = override.netProfit;
        }
        if (override.listingType) {
          siteAndListingTypeInfoMap[code] = { listingType: override.listingType };
        }
      }
      return { ...sku, siteAndPriceMap, siteAndListingTypeInfoMap, siteNetProfitDetail: result.siteNetProfitDetail };
    });

    // 产品级全球净收益:默认取所有 SKU × 站点的最大净收益;用户覆盖时用覆盖值。
    const siteAndPriceMap: Record<string, string> = {};
    const globalOverride = draft.globalNetProfitOverride;
    if (globalOverride !== undefined && globalOverride !== null && globalOverride.trim() !== '') {
      for (const site of sites) siteAndPriceMap[site] = globalOverride;
    } else {
      let globalMax = -Infinity;
      for (const sku of skus) {
        for (const value of Object.values(sku.siteAndPriceMap)) {
          const numeric = Number(value);
          if (Number.isFinite(numeric) && numeric > globalMax) {
            globalMax = numeric;
          }
        }
      }
      if (Number.isFinite(globalMax)) {
        const formatted = formatNetProfit(globalMax);
        for (const site of sites) siteAndPriceMap[site] = formatted;
      }
    }

    return { ...draft, sites, skus, siteAndPriceMap };
  }
}
