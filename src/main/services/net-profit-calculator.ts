import type { SkuEditField, EditDraft } from '../../domain/edit';
import type {
  FxRateRepository,
  FxRates,
  NetProfitConfig,
  NetProfitSettingsRepository,
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

    let globalMax = -Infinity;
    const skus = draft.skus.map((sku) => {
      const inputs = parseSkuInputs(sku);
      if (!inputs) {
        return { ...sku, siteAndPriceMap: {}, siteAndListingTypeInfoMap: {} };
      }
      const result = computeSkuNetProfit({ ...inputs, sites, config, fx });
      for (const value of Object.values(result.siteAndPriceMap)) {
        const numeric = Number(value);
        if (Number.isFinite(numeric) && numeric > globalMax) {
          globalMax = numeric;
        }
      }
      return {
        ...sku,
        siteAndPriceMap: result.siteAndPriceMap,
        siteAndListingTypeInfoMap: result.siteAndListingTypeInfoMap,
      };
    });

    const siteAndPriceMap: Record<string, string> = {};
    if (Number.isFinite(globalMax)) {
      const formatted = formatNetProfit(globalMax);
      for (const site of sites) siteAndPriceMap[site] = formatted;
    }

    return { ...draft, sites, skus, siteAndPriceMap };
  }
}
