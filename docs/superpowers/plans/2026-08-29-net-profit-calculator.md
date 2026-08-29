# 净利润计算器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 AI 编辑草稿在生成和保存时,基于每个 SKU 的货源价/重量/尺寸、站点、目标利润率配置与汇率,本地计算出与妙手数据结构完全一致的净收益(`siteAndPriceMap`)与产品类型(`siteAndListingTypeInfoMap`),并随草稿落库、在草稿 SKU 卡片展示。

**Architecture:** 纯函数计算引擎(`net-profit-engine.ts`)负责单站点/单 SKU 的净收益反解与产品类型判定,内置 MX/BR/AR 三站运费阶梯表;`NetProfitCalculator` 服务把草稿里的 `EditField` 字符串解析成数值、调用引擎、汇总「全球净收益」并写回草稿字段。配置与汇率分别存 `app_settings` 与新增 `fx_rates` 表;`FxRateService` 从 `open.er-api.com` 拉取汇率并缓存。净收益在 `editGenerate` 后与 `editSaveDraft` 时计算,随草稿落库;UI 在工作台加「利润率配置」弹窗,在草稿 SKU 卡片只读展示产品类型/净收益/全球净收益。

**Tech Stack:** Electron + Vite + React 19 + zod 4 + node:sqlite(`DatabaseSync`),vitest(单测/组件测试用 `// @vitest-environment jsdom`)。

**Spec:** [docs/superpowers/specs/2026-08-29-net-profit-calculator-design.md](../specs/2026-08-29-net-profit-calculator-design.md) — 计算逻辑依据 [docs/美客多净利润计算器.md](../../美客多净利润计算器.md)。

## Global Constraints

- 净收益/产品类型字段名与结构**必须与妙手完全一致**:SKU 级 `siteAndPriceMap`(站点→净收益字符串)+ `siteAndListingTypeInfoMap`(站点→`{listingType}`);产品级顶层 `siteAndPriceMap` 存全球净收益。
- `listingType` 用妙手字符串:`gold_special`(经典)/ `gold_pro`(铂金)。
- 产品类型规则:货源价 <10 元 **且** 重量 <200g → 经典;否则铂金;**AR(阿根廷)强制经典**。
- 佣金映射:经典 → 配置 `commission.classic`;铂金 → `commission.premium`。
- 计算输入一律用**草稿里 AI 编辑后的值**(`EditField.value`),不用妙手原始值。
- 运费为内置阶梯表核价预估(非实时账单),UI 需保留提示。
- 汇率:`https://open.er-api.com/v6/latest/USD`,主进程启动拉取 + 本地缓存;失败用缓存/内置默认。
- 汇率站点键带 `(Up)` 后缀(`MX(Up)` 等);`siteAndPriceMap` 键用完整站点键,`siteAndListingTypeInfoMap` 键用去后缀裸码(`MX`)——与妙手真实数据一致。
- 所有数值字段校验用 zod strict schema;旧草稿缺新字段由 `normalizeDraft` 兜底。
- 测试用现有 vitest(`tests/**/*.test.ts`/`.tsx`);组件测试文件首行加 `// @vitest-environment jsdom`(根配置是 node 环境)。
- 不使用任何未引入的依赖;`fetch` 在 Electron 主进程可用(现有 gateway 已用)。

---

### Task 1: 净收益领域类型、默认值、运费阶梯表

**Files:**
- Create: `src/domain/net-profit.ts`
- Create: `tests/unit/net-profit-domain.test.ts`
- Modify: `src/domain/edit.ts`(给 `EditDraft`/`SkuEditField` 加**可选**新字段,保证后续任务逐步接入时全仓可编译)

**Interfaces:**
- Produces(供 Task 2+ 使用):
  - `type MarginMode = 'income' | 'price'`
  - `type NetProfitConfig = { targetMargin: number; marginMode: MarginMode; commission: { classic: number; premium: number }; packingCost: number }`
  - `type FxRates = { cny: number; mxn: number; brl: number; ars: number; updatedAt: string }`
  - `const DEFAULT_NET_PROFIT_CONFIG: NetProfitConfig`
  - `const DEFAULT_FX_RATES: FxRates`
  - `type SiteCode = 'MX' | 'BR' | 'AR'`
  - `type ShippingTier = readonly [minKg: number, maxKg: number, highPriceUsd: number, lowPriceUsd: number]`
  - `type SiteMeta = { code: SiteCode; currency: 'MXN' | 'BRL' | 'ARS'; threshold: number; tiers: readonly ShippingTier[] }`
  - `const SITE_META_BY_CODE: Record<SiteCode, SiteMeta>`
  - `function normalizeSiteKey(siteKey: string): string`(去 `(Up)` 后缀)
  - `function siteMetaFor(siteKey: string): SiteMeta | null`(不支持站点返回 null)
  - `const SITE_LABELS: Record<string, string>`(`MX: '墨西哥'` 等)
  - `const LISTING_TYPE_LABELS: Record<string, string>`(`gold_special: '经典'`, `gold_pro: '铂金'`)
  - `interface NetProfitSettingsRepository { getNetProfitConfig(): NetProfitConfig; saveNetProfitConfig(value: NetProfitConfig): void }`
  - `interface FxRateRepository { getFxRates(): FxRates; saveFxRates(value: FxRates): void }`

- [ ] **Step 1: 写失败测试**

创建 `src/domain/net-profit.ts` 与 `tests/unit/net-profit-domain.test.ts`:

```ts
// tests/unit/net-profit-domain.test.ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FX_RATES,
  DEFAULT_NET_PROFIT_CONFIG,
  SITE_META_BY_CODE,
  normalizeSiteKey,
  siteMetaFor,
} from '../../src/domain/net-profit';

describe('net-profit domain defaults', () => {
  it('provides a default config', () => {
    expect(DEFAULT_NET_PROFIT_CONFIG).toEqual({
      targetMargin: 20,
      marginMode: 'price',
      commission: { classic: 12, premium: 20 },
      packingCost: 2.5,
    });
  });

  it('provides default fx rates with an empty updatedAt', () => {
    expect(DEFAULT_FX_RATES.cny).toBeGreaterThan(0);
    expect(DEFAULT_FX_RATES.updatedAt).toBe('');
  });
});

describe('site meta', () => {
  it('covers MX/BR/AR with their thresholds', () => {
    expect(SITE_META_BY_CODE.MX.threshold).toBe(299);
    expect(SITE_META_BY_CODE.BR.threshold).toBe(79);
    expect(SITE_META_BY_CODE.AR.threshold).toBe(33000);
    expect(SITE_META_BY_CODE.MX.currency).toBe('MXN');
    expect(SITE_META_BY_CODE.BR.currency).toBe('BRL');
    expect(SITE_META_BY_CODE.AR.currency).toBe('ARS');
  });

  it('normalizes (Up)-suffixed site keys and looks the meta up', () => {
    expect(normalizeSiteKey('MX(Up)')).toBe('MX');
    expect(siteMetaFor('BR(Up)')?.code).toBe('BR');
    expect(siteMetaFor('US')).toBeNull();
  });

  it('keeps every shipping tier with a positive price', () => {
    for (const meta of Object.values(SITE_META_BY_CODE)) {
      expect(meta.tiers.length).toBeGreaterThan(0);
      for (const tier of meta.tiers) {
        expect(tier[2]).toBeGreaterThan(0);
        expect(tier[3]).toBeGreaterThan(0);
      }
    }
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npx vitest run tests/unit/net-profit-domain.test.ts`
Expected: FAIL(找不到 `src/domain/net-profit` 模块)。

- [ ] **Step 3: 写实现**

创建 `src/domain/net-profit.ts`(完整代码):

```ts
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
```

修改 `src/domain/edit.ts`:给 `SkuEditField` 加可选 `siteAndPriceMap` / `siteAndListingTypeInfoMap`,给 `EditDraft` 加可选 `sites` / `siteAndPriceMap`(顶层,全球净收益):

```ts
export type SkuSiteAndPriceMap = Record<string, string>;
export type SkuSiteAndListingTypeInfoMap = Record<string, { listingType: string }>;

export type SkuEditField = {
  skuKey: string;
  name: EditField;
  stock: EditField;
  sourcePrice: EditField;
  package: PackageEditField;
  // 新增(对齐妙手 skuMap[key].siteAndPriceMap / siteAndListingTypeInfoMap)。
  // Task 8 会把它们变成必填并在生成/保存时写入。
  siteAndPriceMap?: SkuSiteAndPriceMap;
  siteAndListingTypeInfoMap?: SkuSiteAndListingTypeInfoMap;
};

export type EditDraft = {
  version: number;
  createdAt: string;
  title: EditField;
  description: EditField;
  brand: EditField;
  model: EditField;
  // 新增:发布站点(原始键,如 'MX(Up)')与产品级全球净收益(对齐
  // siteCollectItemInfo.siteAndPriceMap)。
  sites?: string[];
  siteAndPriceMap?: Record<string, string>;
  skus: SkuEditField[];
};
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `npx vitest run tests/unit/net-profit-domain.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/domain/net-profit.ts src/domain/edit.ts tests/unit/net-profit-domain.test.ts
git commit -m "feat: add net-profit domain types, defaults and shipping tier tables"
```

---

### Task 2: 净收益计算引擎(纯函数)

**Files:**
- Create: `src/main/services/net-profit-engine.ts`
- Create: `tests/unit/net-profit-engine.test.ts`

**Interfaces:**
- Consumes: `domain/net-profit.ts` 的 `NetProfitConfig`/`FxRates`/`ShippingTier`/`siteMetaFor`/`SITE_META_BY_CODE`。
- Produces:
  - `function billableWeightKg(weightG: number, lengthCm: number, widthCm: number, heightCm: number): number`
  - `function findTier(tiers: readonly ShippingTier[], billableKg: number): ShippingTier`
  - `function formatNetProfit(value: number): string`(四舍五入到 2 位并去掉尾零,如 `4.2845→'4.28'`、`15→'15'`、`15.2→'15.2'`)
  - `function listingTypeFor(siteCode: string, sourcePriceCny: number, weightG: number): 'gold_special' | 'gold_pro'`
  - `type SiteNetProfitResult = { siteKey: string; siteCode: string; listingType: 'gold_special' | 'gold_pro'; netProfit: number; netProfitFormatted: string; shipping: number; price: number; isHigh: boolean }`
  - `function computeSiteNetProfit(input: { siteKey: string; siteCode: string; sourcePriceCny: number; weightG: number; lengthCm: number; widthCm: number; heightCm: number; config: NetProfitConfig; fx: FxRates }): SiteNetProfitResult`
  - `type SkuNetProfitInput = { sourcePriceCny: number; weightG: number; lengthCm: number; widthCm: number; heightCm: number; sites: string[]; config: NetProfitConfig; fx: FxRates }`
  - `type SkuNetProfitResult = { siteAndPriceMap: Record<string, string>; siteAndListingTypeInfoMap: Record<string, { listingType: string }> }`
  - `function computeSkuNetProfit(input: SkuNetProfitInput): SkuNetProfitResult`

公式(见 `docs/美客多净利润计算器.md`):`baseCny = sourcePriceCny + packingCost`;模式一 `net = baseCny / (rCny * (1 - target))`;模式二两步求解 `net = (baseCny/rCny + target*shipping/(1-comm)) / (1 - target/(1-comm))`,先用低售价运费求 net → 反推 `price = (net+shipLow)/(1-comm)` → 若 `price*rLocal >= threshold` 改用高售价运费重解。

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/net-profit-engine.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FX_RATES,
  DEFAULT_NET_PROFIT_CONFIG,
  type NetProfitConfig,
  type FxRates,
} from '../../src/domain/net-profit';
import {
  billableWeightKg,
  computeSkuNetProfit,
  computeSiteNetProfit,
  findTier,
  formatNetProfit,
  listingTypeFor,
  siteMetaFor,
} from '../../src/main/services/net-profit-engine';
import { SITE_META_BY_CODE } from '../../src/domain/net-profit';

const FX: FxRates = { cny: 7.18, mxn: 17.35, brl: 5.5, ars: 1450, updatedAt: '2026-08-29' };

describe('billableWeightKg', () => {
  it('uses gross weight below 500g without comparing volume', () => {
    expect(billableWeightKg(320, 20, 20, 20)).toBe(0.32);
  });
  it('picks the max of gross and volume at/above 500g', () => {
    expect(billableWeightKg(800, 0, 0, 0)).toBe(0.8);
    // volume = 20*20*20/6000 ≈ 1.333
    expect(billableWeightKg(800, 20, 20, 20)).toBeCloseTo(1.3333, 3);
  });
});

describe('findTier', () => {
  it('finds the tier containing the billable weight and clamps past the last', () => {
    const mx = SITE_META_BY_CODE.MX;
    expect(findTier(mx.tiers, 0.32)).toEqual([0.3, 0.4, 6.31, 3.16]);
    expect(findTier(mx.tiers, 20)).toEqual([15, Infinity, 148.86, 148.86]);
  });
});

describe('formatNetProfit', () => {
  it('rounds to 2 decimals and strips trailing zeros', () => {
    expect(formatNetProfit(4.2845)).toBe('4.28');
    expect(formatNetProfit(15)).toBe('15');
    expect(formatNetProfit(15.2)).toBe('15.2');
  });
});

describe('listingTypeFor', () => {
  it('classic below 10 yuan AND 200g, else premium', () => {
    expect(listingTypeFor('MX', 9.99, 199)).toBe('gold_special');
    expect(listingTypeFor('MX', 10, 199)).toBe('gold_pro');
    expect(listingTypeFor('MX', 9, 200)).toBe('gold_pro');
  });
  it('forces classic in AR regardless of price/weight', () => {
    expect(listingTypeFor('AR', 20, 500)).toBe('gold_special');
  });
});

describe('computeSiteNetProfit', () => {
  it('solves mode-price premium on MX with the documented example', () => {
    // doc example: cost 14.90, packing 2.50, 320g, mode 2, comm 20%, target 20%
    const result = computeSiteNetProfit({
      siteKey: 'MX(Up)',
      siteCode: 'MX',
      sourcePriceCny: 14.9,
      weightG: 320,
      lengthCm: 0,
      widthCm: 0,
      heightCm: 0,
      config: DEFAULT_NET_PROFIT_CONFIG,
      fx: FX,
    });
    expect(result.listingType).toBe('gold_pro'); // 14.9 >= 10
    expect(result.netProfitFormatted).toBe('4.28');
    expect(result.isHigh).toBe(false);
    expect(result.shipping).toBe(3.16);
  });

  it('solves mode-income independently of shipping', () => {
    const result = computeSiteNetProfit({
      siteKey: 'MX(Up)',
      siteCode: 'MX',
      sourcePriceCny: 14.9,
      weightG: 320,
      lengthCm: 0,
      widthCm: 0,
      heightCm: 0,
      config: { ...DEFAULT_NET_PROFIT_CONFIG, marginMode: 'income' },
      fx: FX,
    });
    expect(result.netProfitFormatted).toBe('3.03');
  });

  it('flips to the high-price shipping column when the price crosses the threshold', () => {
    // 2000g premium on MX → derived price ≈ 347 MXN >= 299 → high column
    const result = computeSiteNetProfit({
      siteKey: 'MX(Up)',
      siteCode: 'MX',
      sourcePriceCny: 20,
      weightG: 2000,
      lengthCm: 0,
      widthCm: 0,
      heightCm: 0,
      config: DEFAULT_NET_PROFIT_CONFIG,
      fx: FX,
    });
    expect(result.isHigh).toBe(true);
    expect(result.shipping).toBe(14.46);
    expect(result.netProfitFormatted).toBe('9');
  });

  it('forces classic commission on AR and uses the ARS threshold', () => {
    const result = computeSiteNetProfit({
      siteKey: 'AR(Up)',
      siteCode: 'AR',
      sourcePriceCny: 20,
      weightG: 2000,
      lengthCm: 0,
      widthCm: 0,
      heightCm: 0,
      config: DEFAULT_NET_PROFIT_CONFIG,
      fx: FX,
    });
    expect(result.listingType).toBe('gold_special');
    expect(result.isHigh).toBe(true); // ≈ 35576 ARS >= 33000
    expect(result.netProfitFormatted).toBe('11.5');
  });
});

describe('computeSkuNetProfit', () => {
  it('fills per-site maps keyed like Miaoshou (price by full key, type by code)', () => {
    const result = computeSkuNetProfit({
      sourcePriceCny: 20,
      weightG: 2000,
      lengthCm: 0,
      widthCm: 0,
      heightCm: 0,
      sites: ['MX(Up)', 'AR(Up)'],
      config: DEFAULT_NET_PROFIT_CONFIG,
      fx: FX,
    });
    expect(result.siteAndPriceMap).toEqual({ 'MX(Up)': '9', 'AR(Up)': '11.5' });
    expect(result.siteAndListingTypeInfoMap).toEqual({
      MX: { listingType: 'gold_pro' },
      AR: { listingType: 'gold_special' },
    });
  });

  it('skips unsupported site keys', () => {
    const result = computeSkuNetProfit({
      sourcePriceCny: 20,
      weightG: 2000,
      lengthCm: 0,
      widthCm: 0,
      heightCm: 0,
      sites: ['MX(Up)', 'US(Up)'],
      config: DEFAULT_NET_PROFIT_CONFIG,
      fx: FX,
    });
    expect(result.siteAndPriceMap).toEqual({ 'MX(Up)': '9' });
    expect(result.siteAndListingTypeInfoMap).toEqual({ MX: { listingType: 'gold_pro' } });
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npx vitest run tests/unit/net-profit-engine.test.ts`
Expected: FAIL(找不到 `net-profit-engine` 模块)。

- [ ] **Step 3: 写实现**

创建 `src/main/services/net-profit-engine.ts`:

```ts
import {
  SITE_META_BY_CODE,
  siteMetaFor,
  type FxRates,
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
  return sourcePriceCny < 10 && weightG < 200 ? 'gold_special' : 'gold_pro';
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
  const rLocal = input.fx[meta.currency.toLowerCase()];
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
};

export function computeSkuNetProfit(input: SkuNetProfitInput): SkuNetProfitResult {
  const siteAndPriceMap: Record<string, string> = {};
  const siteAndListingTypeInfoMap: Record<string, { listingType: string }> = {};
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
  }
  return { siteAndPriceMap, siteAndListingTypeInfoMap };
}

// Re-exported for callers that need the supported-site guard.
export { SITE_META_BY_CODE };
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `npx vitest run tests/unit/net-profit-engine.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/main/services/net-profit-engine.ts tests/unit/net-profit-engine.test.ts
git commit -m "feat: add pure net-profit calculation engine with per-site maps"
```

---

### Task 3: 配置/汇率 zod schema + 草稿 schema 扩展

**Files:**
- Create: `src/shared/net-profit-schemas.ts`
- Create: `tests/unit/net-profit-schemas.test.ts`
- Modify: `src/shared/edit-output-schema.ts`(给 `editDraftSchema` 加 `sites`/顶层 `siteAndPriceMap`/SKU 级 `siteAndPriceMap` + `siteAndListingTypeInfoMap`,用 `.default()` 兼容旧草稿)

**Interfaces:**
- Consumes: `domain/net-profit.ts` 类型。
- Produces:
  - `const netProfitConfigSchema: z.ZodType<NetProfitConfig>`(strict;targetMargin 0..100;marginMode enum;commission 各 0..100;packingCost ≥0)
  - `const fxRatesSchema: z.ZodType<FxRates>`(strict;四汇率 >0;updatedAt string)
  - `export type { NetProfitConfig, FxRates }` 再导出以便 handler/UI 复用

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/net-profit-schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fxRatesSchema, netProfitConfigSchema } from '../../src/shared/net-profit-schemas';
import { DEFAULT_FX_RATES, DEFAULT_NET_PROFIT_CONFIG } from '../../src/domain/net-profit';
import { editDraftSchema } from '../../src/shared/edit-output-schema';

describe('netProfitConfigSchema', () => {
  it('accepts the default config', () => {
    expect(netProfitConfigSchema.safeParse(DEFAULT_NET_PROFIT_CONFIG).success).toBe(true);
  });
  it('rejects a negative packing cost', () => {
    expect(
      netProfitConfigSchema.safeParse({ ...DEFAULT_NET_PROFIT_CONFIG, packingCost: -1 }).success,
    ).toBe(false);
  });
  it('rejects an unknown marginMode', () => {
    expect(
      netProfitConfigSchema.safeParse({ ...DEFAULT_NET_PROFIT_CONFIG, marginMode: 'net' }).success,
    ).toBe(false);
  });
});

describe('fxRatesSchema', () => {
  it('accepts the default rates', () => {
    expect(fxRatesSchema.safeParse(DEFAULT_FX_RATES).success).toBe(true);
  });
  it('rejects a non-positive rate', () => {
    expect(fxRatesSchema.safeParse({ ...DEFAULT_FX_RATES, cny: 0 }).success).toBe(false);
  });
});

describe('editDraftSchema extension', () => {
  const baseDraft = {
    version: 1,
    createdAt: '2026-08-29T00:00:00.000Z',
    title: { value: 'T', source: 'ai', confidence: 0.9 },
    description: { value: 'D', source: 'ai', confidence: 0.9 },
    brand: { value: 'Generic', source: 'fixed', confidence: 1 },
    model: { value: 'M', source: 'ai', confidence: 0.6 },
    skus: [
      {
        skuKey: ';a;',
        name: { value: 'A', source: 'ai', confidence: 0.9 },
        stock: { value: '2', source: 'ai', confidence: 1 },
        sourcePrice: { value: '20', source: 'remote', confidence: 1 },
        package: {
          length: { value: '20', source: 'ai', confidence: 0.7 },
          width: { value: '10', source: 'ai', confidence: 0.7 },
          height: { value: '8', source: 'ai', confidence: 0.7 },
          dimensionUnit: 'cm',
          weight: { value: '500', source: 'ai', confidence: 0.8 },
          weightUnit: 'g',
        },
      },
    ],
  };

  it('accepts a draft with the new net-profit fields', () => {
    const draft = {
      ...baseDraft,
      sites: ['MX(Up)'],
      siteAndPriceMap: { 'MX(Up)': '9' },
      skus: [
        {
          ...baseDraft.skus[0],
          siteAndPriceMap: { 'MX(Up)': '9' },
          siteAndListingTypeInfoMap: { MX: { listingType: 'gold_pro' } },
        },
      ],
    };
    expect(editDraftSchema.safeParse(draft).success).toBe(true);
  });

  it('defaults the new fields for a legacy draft', () => {
    const parsed = editDraftSchema.parse(baseDraft);
    expect(parsed.sites).toEqual([]);
    expect(parsed.siteAndPriceMap).toEqual({});
    expect(parsed.skus[0].siteAndPriceMap).toEqual({});
    expect(parsed.skus[0].siteAndListingTypeInfoMap).toEqual({});
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npx vitest run tests/unit/net-profit-schemas.test.ts`
Expected: FAIL(找不到 `net-profit-schemas`;`editDraftSchema` 未识别新字段)。

- [ ] **Step 3: 写实现**

创建 `src/shared/net-profit-schemas.ts`:

```ts
import { z } from 'zod';

// Runtime validation for the net-profit config and cached fx rates as
// exchanged over IPC and stored in app_settings / fx_rates.

export const netProfitConfigSchema = z.strictObject({
  targetMargin: z.number().min(0).max(100),
  marginMode: z.enum(['income', 'price']),
  commission: z.strictObject({
    classic: z.number().min(0).max(100),
    premium: z.number().min(0).max(100),
  }),
  packingCost: z.number().min(0),
});

export const fxRatesSchema = z.strictObject({
  cny: z.number().positive(),
  mxn: z.number().positive(),
  brl: z.number().positive(),
  ars: z.number().positive(),
  updatedAt: z.string(),
});

export type NetProfitConfig = z.infer<typeof netProfitConfigSchema>;
export type FxRates = z.infer<typeof fxRatesSchema>;
```

修改 `src/shared/edit-output-schema.ts`:在 `editDraftSchema` 顶层加 `sites`、`siteAndPriceMap`,在 `skus` 元素加 `siteAndPriceMap`、`siteAndListingTypeInfoMap`(全部 `.default(...)`,旧草稿兼容):

```ts
export const editDraftSchema = z.strictObject({
  version: z.number().int().positive(),
  createdAt: z.string(),
  title: draftFieldSchema,
  description: draftFieldSchema,
  brand: draftFieldSchema,
  model: draftFieldSchema,
  // 发布站点(原始键,如 'MX(Up)')与产品级全球净收益(对齐妙手顶层 siteAndPriceMap)。
  sites: z.array(z.string()).default([]),
  siteAndPriceMap: z.record(z.string(), z.string()).default({}),
  skus: z.array(
    z.strictObject({
      skuKey: z.string().min(1),
      name: draftFieldSchema,
      stock: draftFieldSchema,
      sourcePrice: draftFieldSchema,
      package: z.strictObject({
        length: draftFieldSchema,
        width: draftFieldSchema,
        height: draftFieldSchema,
        dimensionUnit: z.literal('cm'),
        weight: draftFieldSchema,
        weightUnit: z.literal('g'),
      }),
      // 对齐妙手 skuMap[key].siteAndPriceMap / siteAndListingTypeInfoMap。
      siteAndPriceMap: z.record(z.string(), z.string()).default({}),
      siteAndListingTypeInfoMap: z
        .record(z.string(), z.strictObject({ listingType: z.string() }))
        .default({}),
    }),
  ),
});
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `npx vitest run tests/unit/net-profit-schemas.test.ts tests/unit/edit-output-schema.test.ts`
Expected: 全部 PASS(现有 AI 输出 schema 测试不受影响)。

- [ ] **Step 5: 提交**

```bash
git add src/shared/net-profit-schemas.ts src/shared/edit-output-schema.ts tests/unit/net-profit-schemas.test.ts
git commit -m "feat: validate net-profit config/fx and extend the draft schema"
```

---

### Task 4: 配置与汇率的本地持久化(迁移 + 仓储)

**Files:**
- Create: `src/main/db/migrations/006_fx_rates.sql`
- Modify: `src/main/db/migrator.ts`(注册 006)
- Modify: `src/main/repositories/app-settings-repository.ts`(实现 `NetProfitSettingsRepository`)
- Create: `src/main/repositories/fx-rate-repository.ts`
- Create: `tests/unit/net-profit-repositories.test.ts`

**Interfaces:**
- Consumes: `domain/net-profit.ts` 的 `NetProfitSettingsRepository`/`FxRateRepository`;`shared/net-profit-schemas.ts` 的 schema。
- Produces:
  - `class SqliteAppSettingsRepository implements AppSettingsRepository, NetProfitSettingsRepository`(新增 `getNetProfitConfig()` / `saveNetProfitConfig(value)`,存 `app_settings` key=`net_profit_config`)
  - `class SqliteFxRateRepository implements FxRateRepository`(`getFxRates()` / `saveFxRates(value)`,存 `fx_rates` 表 key=`rates`)

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/net-profit-repositories.test.ts`:

```ts
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { applyMigrations } from '../../src/main/db/migrator';
import { SqliteAppSettingsRepository } from '../../src/main/repositories/app-settings-repository';
import { SqliteFxRateRepository } from '../../src/main/repositories/fx-rate-repository';
import { DEFAULT_FX_RATES, DEFAULT_NET_PROFIT_CONFIG } from '../../src/domain/net-profit';

function openDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  applyMigrations(db);
  return db;
}

describe('net-profit config repository', () => {
  it('returns the default config before anything is saved', () => {
    const repo = new SqliteAppSettingsRepository(openDb());
    expect(repo.getNetProfitConfig()).toEqual(DEFAULT_NET_PROFIT_CONFIG);
  });

  it('round-trips a saved config', () => {
    const db = openDb();
    const repo = new SqliteAppSettingsRepository(db);
    const next = { ...DEFAULT_NET_PROFIT_CONFIG, targetMargin: 30, packingCost: 3 };
    repo.saveNetProfitConfig(next);
    expect(repo.getNetProfitConfig()).toEqual(next);
  });
});

describe('fx rate repository', () => {
  it('returns the default rates before anything is saved', () => {
    const repo = new SqliteFxRateRepository(openDb());
    expect(repo.getFxRates()).toEqual(DEFAULT_FX_RATES);
  });

  it('round-trips a saved snapshot', () => {
    const db = openDb();
    const repo = new SqliteFxRateRepository(db);
    const next = { ...DEFAULT_FX_RATES, cny: 7.3, updatedAt: '2026-08-29T00:00:00.000Z' };
    repo.saveFxRates(next);
    expect(repo.getFxRates()).toEqual(next);
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npx vitest run tests/unit/net-profit-repositories.test.ts`
Expected: FAIL(迁移 006 未注册 → `fx_rates` 表不存在;`SqliteAppSettingsRepository` 缺新方法)。

- [ ] **Step 3: 写实现**

创建 `src/main/db/migrations/006_fx_rates.sql`:

```sql
-- USD reference-rate cache used by the net-profit calculator. Refreshed from
-- open.er-api.com on app start and on demand; the app falls back to the last
-- stored snapshot (or built-in defaults) while offline.
CREATE TABLE fx_rates (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
) STRICT;
```

修改 `src/main/db/migrator.ts`:

```ts
import fxRatesMigration from './migrations/006_fx_rates.sql?raw';
// ...
  {
    version: 6,
    name: 'fx_rates',
    sql: fxRatesMigration,
  },
```

修改 `src/main/repositories/app-settings-repository.ts`,实现 `NetProfitSettingsRepository`:

```ts
import {
  DEFAULT_NET_PROFIT_CONFIG,
  type NetProfitSettingsRepository,
} from '../../domain/net-profit';
import { netProfitConfigSchema } from '../../shared/net-profit-schemas';

export class SqliteAppSettingsRepository
  implements AppSettingsRepository, NetProfitSettingsRepository
{
  constructor(private readonly database: DatabaseSync) {}

  // ... 保留现有 getModelProxy / saveModelProxy ...

  getNetProfitConfig(): NetProfitConfig {
    const row = this.database
      .prepare('SELECT value_json FROM app_settings WHERE key = ?')
      .get('net_profit_config') as { value_json: string } | undefined;
    if (!row) return { ...DEFAULT_NET_PROFIT_CONFIG };
    return netProfitConfigSchema.parse(JSON.parse(row.value_json));
  }

  saveNetProfitConfig(value: NetProfitConfig): void {
    const normalized = netProfitConfigSchema.parse(value);
    this.database
      .prepare(
        `
          INSERT INTO app_settings (key, value_json)
          VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
        `,
      )
      .run('net_profit_config', JSON.stringify(normalized));
  }
}
```

(注意:该文件已有 `import type { DatabaseSync }`;`NetProfitConfig` 从 `shared/net-profit-schemas` 的 `NetProfitConfig` 类型导入,或从 domain 导入——保持一致用 `shared/net-profit-schemas` 导出的类型。)

创建 `src/main/repositories/fx-rate-repository.ts`:

```ts
import type { DatabaseSync } from 'node:sqlite';

import {
  DEFAULT_FX_RATES,
  type FxRateRepository,
  type FxRates,
} from '../../domain/net-profit';
import { fxRatesSchema } from '../../shared/net-profit-schemas';

export class SqliteFxRateRepository implements FxRateRepository {
  constructor(private readonly database: DatabaseSync) {}

  getFxRates(): FxRates {
    const row = this.database
      .prepare('SELECT value_json FROM fx_rates WHERE key = ?')
      .get('rates') as { value_json: string } | undefined;
    if (!row) return { ...DEFAULT_FX_RATES };
    return fxRatesSchema.parse(JSON.parse(row.value_json));
  }

  saveFxRates(value: FxRates): void {
    const normalized = fxRatesSchema.parse(value);
    this.database
      .prepare(
        `
          INSERT INTO fx_rates (key, value_json)
          VALUES ('rates', ?)
          ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
        `,
      )
      .run(JSON.stringify(normalized));
  }
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `npx vitest run tests/unit/net-profit-repositories.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/main/db/migrations/006_fx_rates.sql src/main/db/migrator.ts \
  src/main/repositories/app-settings-repository.ts src/main/repositories/fx-rate-repository.ts \
  tests/unit/net-profit-repositories.test.ts
git commit -m "feat: persist net-profit config and cached fx rates"
```

---

### Task 5: 汇率拉取服务

**Files:**
- Create: `src/main/services/fx-rate-service.ts`
- Create: `tests/unit/fx-rate-service.test.ts`

**Interfaces:**
- Consumes: `FxRateRepository`。
- Produces:
  - `export const FX_API_URL = 'https://open.er-api.com/v6/latest/USD'`
  - `export type JsonFetcher = (url: string) => Promise<{ json(): Promise<unknown> }>`
  - `class FxRateService { constructor(repo: FxRateRepository, fetcher?: JsonFetcher); async refresh(): Promise<FxRates> }`

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/fx-rate-service.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { FxRateService, FX_API_URL, type JsonFetcher } from '../../src/main/services/fx-rate-service';
import {
  DEFAULT_FX_RATES,
  type FxRateRepository,
  type FxRates,
} from '../../src/domain/net-profit';

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
```

(测试里需要 `import type { FxRates } from '../../src/domain/net-profit';`——补上。)

- [ ] **Step 2: 运行测试,确认失败**

Run: `npx vitest run tests/unit/fx-rate-service.test.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 写实现**

创建 `src/main/services/fx-rate-service.ts`:

```ts
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
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `npx vitest run tests/unit/fx-rate-service.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/main/services/fx-rate-service.ts tests/unit/fx-rate-service.test.ts
git commit -m "feat: fetch and cache USD fx rates for net-profit"
```

---

### Task 6: NetProfitCalculator 编排服务

**Files:**
- Create: `src/main/services/net-profit-calculator.ts`
- Create: `tests/unit/net-profit-calculator.test.ts`

**Interfaces:**
- Consumes: `NetProfitSettingsRepository` / `FxRateRepository`;`computeSkuNetProfit` / `formatNetProfit`;`EditDraft`/`SkuEditField`。
- Produces:
  - `class NetProfitCalculator { constructor(settings: NetProfitSettingsRepository, fxRates: FxRateRepository); computeForDraft(draft: EditDraft): EditDraft }`

行为:读配置与汇率;逐 SKU 把 `EditField.value` 解析成数值(`sourcePrice` 缺省/非数 → 该 SKU 净收益置空 `{}`;重量/尺寸非数按 0);调用 `computeSkuNetProfit`;全球净收益 = 所有 SKU 所有站点最大值,写入产品级 `siteAndPriceMap`(每个站点键都指向该值,与草稿 SKU 键一致)。

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/net-profit-calculator.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { EditDraft } from '../../src/domain/edit';
import {
  DEFAULT_FX_RATES,
  DEFAULT_NET_PROFIT_CONFIG,
  type FxRateRepository,
  type FxRates,
  type NetProfitSettingsRepository,
  type NetProfitConfig,
} from '../../src/domain/net-profit';
import { NetProfitCalculator } from '../../src/main/services/net-profit-calculator';

const FX: FxRates = { cny: 7.18, mxn: 17.35, brl: 5.5, ars: 1450, updatedAt: '' };

function settings(config: NetProfitConfig = DEFAULT_NET_PROFIT_CONFIG): NetProfitSettingsRepository {
  return { getNetProfitConfig: vi.fn(() => config), saveNetProfitConfig: vi.fn() };
}
function fxStore(rates: FxRates = FX): FxRateRepository {
  return { getFxRates: vi.fn(() => rates), saveFxRates: vi.fn() };
}

function draftWith(skus: EditDraft['skus']): EditDraft {
  return {
    version: 1,
    createdAt: '2026-08-29T00:00:00.000Z',
    title: { value: 'T', source: 'ai', confidence: 0.9 },
    description: { value: 'D', source: 'ai', confidence: 0.9 },
    brand: { value: 'Generic', source: 'fixed', confidence: 1 },
    model: { value: 'M', source: 'ai', confidence: 0.6 },
    sites: ['MX(Up)', 'AR(Up)'],
    siteAndPriceMap: {},
    skus,
  };
}

function sku(skuKey: string, sourcePrice: string, weight: string, dims: [string, string, string]): EditDraft['skus'][number] {
  return {
    skuKey,
    name: { value: skuKey, source: 'ai', confidence: 0.9 },
    stock: { value: '2', source: 'ai', confidence: 1 },
    sourcePrice: { value: sourcePrice, source: 'remote', confidence: 1 },
    package: {
      length: { value: dims[0], source: 'ai', confidence: 0.7 },
      width: { value: dims[1], source: 'ai', confidence: 0.7 },
      height: { value: dims[2], source: 'ai', confidence: 0.7 },
      dimensionUnit: 'cm',
      weight: { value: weight, source: 'ai', confidence: 0.8 },
      weightUnit: 'g',
    },
    // These are required after Task 8; keeping them here makes this helper
    // future-proof across the whole plan.
    siteAndPriceMap: {},
    siteAndListingTypeInfoMap: {},
  };
}

describe('NetProfitCalculator', () => {
  it('fills per-SKU maps and the global maximum into the draft', () => {
    const draft = draftWith([
      sku(';heavy;', '20', '2000', ['0', '0', '0']), // MX 9, AR 11.5
      sku(';light;', '5', '150', ['0', '0', '0']), // MX classic 1.9
    ]);
    const calculator = new NetProfitCalculator(settings(), fxStore());

    const result = calculator.computeForDraft(draft);

    expect(result.skus[0].siteAndPriceMap).toEqual({ 'MX(Up)': '9', 'AR(Up)': '11.5' });
    expect(result.skus[0].siteAndListingTypeInfoMap).toEqual({
      MX: { listingType: 'gold_pro' },
      AR: { listingType: 'gold_special' },
    });
    expect(result.skus[1].siteAndPriceMap).toEqual({ 'MX(Up)': '1.9' });
    // global = max(9, 11.5, 1.9)
    expect(result.siteAndPriceMap).toEqual({ 'MX(Up)': '11.5', 'AR(Up)': '11.5' });
  });

  it('leaves a SKU with no source price empty and still aggregates the rest', () => {
    const draft = draftWith([
      sku(';heavy;', '20', '2000', ['0', '0', '0']),
      sku(';no-price;', '', '150', ['0', '0', '0']),
    ]);
    const calculator = new NetProfitCalculator(settings(), fxStore());

    const result = calculator.computeForDraft(draft);

    expect(result.skus[1].siteAndPriceMap).toEqual({});
    expect(result.skus[1].siteAndListingTypeInfoMap).toEqual({});
    // 全球 = 所有存活 SKU 的最大值(heavy 的 MX 9 / AR 11.5 → 11.5),应用到所有站点键。
    expect(result.siteAndPriceMap).toEqual({ 'MX(Up)': '11.5', 'AR(Up)': '11.5' });
  });

  it('treats missing weight/dimensions as zero instead of failing', () => {
    const draft = draftWith([sku(';a;', '20', '', ['', '', ''])]);
    const calculator = new NetProfitCalculator(settings(), fxStore());

    const result = calculator.computeForDraft(draft);

    expect(result.skus[0].siteAndPriceMap['MX(Up)']).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npx vitest run tests/unit/net-profit-calculator.test.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 写实现**

创建 `src/main/services/net-profit-calculator.ts`:

```ts
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
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `npx vitest run tests/unit/net-profit-calculator.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/main/services/net-profit-calculator.ts tests/unit/net-profit-calculator.test.ts
git commit -m "feat: orchestrate net-profit computation over a draft"
```

---

### Task 7: IPC 接线(contract + handlers + preload + main 装配)

**Files:**
- Modify: `src/shared/ipc-contract.ts`(channels + `NetProfitApi` + `DesktopApi`)
- Create: `src/main/ipc/net-profit-handlers.ts`
- Modify: `src/main/ipc/register-handlers.ts`(注册)
- Modify: `src/preload.ts`(暴露 `window.mercado.netProfit`)
- Modify: `src/main.ts`(装配 `fxRateRepository`/`fxRateService`,给 registerHandlers 传 `netProfitSettings`/`fxRates`/`refreshRates`)
- Create: `tests/unit/net-profit-handlers.test.ts`

**Interfaces:**
- Consumes: `NetProfitSettingsRepository` / `FxRateRepository` / `NetProfitConfig` / `FxRates` / `NetProfitSnapshot`;`SqliteFxRateRepository` / `FxRateService`。
- Produces:
  - `IPC_CHANNELS.netProfitGetConfig = 'netProfit:get-config'`、`netProfitSaveConfig = 'netProfit:save-config'`、`netProfitRefreshRates = 'netProfit:refresh-rates'`
  - `type NetProfitSnapshot = { config: NetProfitConfig; fxRates: FxRates }`
  - `interface NetProfitApi { getConfig(): Promise<NetProfitSnapshot>; saveConfig(config: NetProfitConfig): Promise<NetProfitConfig>; refreshRates(): Promise<FxRates> }`
  - `function registerNetProfitHandlers(registrar: IpcRegistrar, deps: { settings: NetProfitSettingsRepository; fxRates: FxRateRepository; refreshRates: () => Promise<FxRates> }): void`
  - **main.ts 已装配**:`fxRateRepository: SqliteFxRateRepository`(复用同一 `appDatabase`)、`fxRateService: FxRateService`,启动时 `void fxRateService.refresh().catch(() => {})`;`registerHandlers` 依赖对象含 `netProfitSettings: appSettings`(即 `SqliteAppSettingsRepository`,已实现 `NetProfitSettingsRepository`)、`fxRates: fxRateRepository`、`refreshRates: () => fxRateService.refresh()`。→ 保证 Task 7 结束时分支可编译,Task 8 只追加 calculator。

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/net-profit-handlers.test.ts`:

```ts
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
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npx vitest run tests/unit/net-profit-handlers.test.ts`
Expected: FAIL(channels / handlers 不存在)。

- [ ] **Step 3: 写实现**

修改 `src/shared/ipc-contract.ts`:

```ts
import type { FxRates, NetProfitConfig } from '../domain/net-profit';
// ...
export const IPC_CHANNELS = {
  // ...
  netProfitGetConfig: 'netProfit:get-config',
  netProfitSaveConfig: 'netProfit:save-config',
  netProfitRefreshRates: 'netProfit:refresh-rates',
} as const;
```

在 `IpcErrorCode` 后、`IpcResult` 前插入(或文件合适处):

```ts
export type NetProfitSnapshot = {
  config: NetProfitConfig;
  fxRates: FxRates;
};
```

在 `EditApi` 后加:

```ts
export interface NetProfitApi {
  getConfig(): Promise<NetProfitSnapshot>;
  saveConfig(config: NetProfitConfig): Promise<NetProfitConfig>;
  refreshRates(): Promise<FxRates>;
}
```

在 `DesktopApi` 加字段:

```ts
export interface DesktopApi {
  app: { getInfo(): Promise<AppInfo> };
  config: ConfigApi;
  diagnostics: DiagnosticApi;
  proxy: ProxyConfigApi;
  products: ProductApi;
  edit: EditApi;
  netProfit: NetProfitApi;
  infringement: InfringementApi;
}
```

创建 `src/main/ipc/net-profit-handlers.ts`:

```ts
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
```

修改 `src/main/ipc/register-handlers.ts`:

- 导入 `registerNetProfitHandlers`、`NetProfitSettingsRepository`、`FxRateRepository`、`type NetProfitConfig`(用于 refreshRates 返回)。
- `HandlerDependencies` 加:

```ts
  netProfitSettings: NetProfitSettingsRepository;
  fxRates: FxRateRepository;
  refreshRates: () => Promise<FxRates>;
```

- `registerHandlers` 里调用:

```ts
  registerNetProfitHandlers(registrar, {
    settings: dependencies.netProfitSettings,
    fxRates: dependencies.fxRates,
    refreshRates: dependencies.refreshRates,
  });
```

(Task 8 再往 `HandlerDependencies` 加 `netProfitCalculator` 并传给 `registerEditHandlers`。)

修改 `src/preload.ts`,在 `desktopApi` 加:

```ts
netProfit: {
  getConfig: () => invoke(IPC_CHANNELS.netProfitGetConfig),
  saveConfig: (config) => invoke(IPC_CHANNELS.netProfitSaveConfig, { config }),
  refreshRates: () => invoke(IPC_CHANNELS.netProfitRefreshRates),
},
```

修改 `src/main.ts`(装配汇率仓储/服务,并把依赖传给 registerHandlers):

```ts
import { FxRateService } from './main/services/fx-rate-service';
import { SqliteFxRateRepository } from './main/repositories/fx-rate-repository';
// app.whenReady 内,appSettings 之后:
const fxRateRepository = new SqliteFxRateRepository(appDatabase);
const fxRateService = new FxRateService(fxRateRepository);
void fxRateService.refresh().catch(() => { /* 离线时用缓存/默认 */ });
```

`registerHandlers(...)` 依赖对象加:

```ts
      netProfitSettings: appSettings,
      fxRates: fxRateRepository,
      refreshRates: () => fxRateService.refresh(),
```

`register-handlers.ts` 的 `HandlerDependencies` 增加并转发(见下方实现段落)。

- [ ] **Step 4: 运行测试,确认通过**

Run: `npx vitest run tests/unit/net-profit-handlers.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/shared/ipc-contract.ts src/main/ipc/net-profit-handlers.ts \
  src/main/ipc/register-handlers.ts src/preload.ts tests/unit/net-profit-handlers.test.ts
git commit -m "feat: wire net-profit config/fx IPC across main and preload"
```

---

### Task 8: 接入生成与保存(草稿字段必填、normalize 兜底、主进程装配)

**Files:**
- Modify: `src/domain/edit.ts`(把 Task 1 的可选新字段改为**必填**)
- Modify: `src/main/services/edit-generation-service.ts`(构造选项加 `netProfit`;`toDraft` 写空字段;`generate` 里带 sites 并调用 calculator)
- Modify: `src/main/ipc/edit-handlers.ts`(`normalizeDraft` 兜底;`editSaveDraft` 保存前重算)
- Modify: `src/main/ipc/register-handlers.ts`(把 calculator 传给 edit handlers)
- Modify: `src/main.ts`(构造 calculator / fx service,启动时刷新汇率,装配)
- Modify: `tests/unit/edit-generation-service.test.ts`(更新 `toEqual` 期望 + 新增净收益集成用例)

**Interfaces:**
- Consumes: `NetProfitCalculator`;`FxRateService`;`EditDraft`/`SkuEditField` 必填字段。
- Produces:
  - `EditGenerationServiceOptions` 增加 `netProfit?: Pick<NetProfitCalculator, 'computeForDraft'>`
  - `registerEditHandlers(registrar, deps)` 的 `deps` 增加 `netProfit: Pick<NetProfitCalculator, 'computeForDraft'>`

- [ ] **Step 1: 写失败测试(先加集成用例)**

在 `tests/unit/edit-generation-service.test.ts` 顶部 import 加:

```ts
import { NetProfitCalculator } from '../../src/main/services/net-profit-calculator';
import {
  DEFAULT_FX_RATES,
  DEFAULT_NET_PROFIT_CONFIG,
  type FxRateRepository,
  type NetProfitSettingsRepository,
} from '../../src/domain/net-profit';

const realCalculator = new NetProfitCalculator(
  { getNetProfitConfig: () => DEFAULT_NET_PROFIT_CONFIG, saveNetProfitConfig: vi.fn() } as NetProfitSettingsRepository,
  { getFxRates: () => ({ ...DEFAULT_FX_RATES }), saveFxRates: vi.fn() } as FxRateRepository,
);
```

在 `describe('EditGenerationService', ...)` 内新增用例:

```ts
it('computes net profit on the generated draft when a calculator is wired', async () => {
  const withSitesDetail: CollectBoxDetailDto = {
    siteCollectItemInfo: {
      ...detail().siteCollectItemInfo,
      sites: ['MX(Up)', 'AR(Up)'],
    },
  };
  const provider = fakeProvider(validOutput());
  const service = new EditGenerationService(
    { getById: vi.fn() },
    fakeSnapshots(withSitesDetail),
    () => provider,
    { now: () => '2026-08-28T01:00:00.000Z', netProfit: realCalculator },
  );

  const draft = await service.generate('90001');

  expect(draft.sites).toEqual(['MX(Up)', 'AR(Up)']);
  // 66 元 / 500g → 铂金;MX 与 AR 均有净收益。
  expect(draft.skus[0].siteAndPriceMap['MX(Up)']).toBeTruthy();
  expect(draft.skus[0].siteAndListingTypeInfoMap.MX).toEqual({ listingType: 'gold_pro' });
  expect(draft.skus[0].siteAndListingTypeInfoMap.AR).toEqual({ listingType: 'gold_special' });
  // 全球净收益 = 所有 SKU × 所有站点的最大值,不必然等于第一个 SKU 的 MX 值。
  const maxAcross = Math.max(
    ...draft.skus.flatMap((sku) =>
      Object.values(sku.siteAndPriceMap ?? {}).map(Number),
    ),
  );
  expect(Number(Object.values(draft.siteAndPriceMap ?? {})[0])).toBe(maxAcross);
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npx vitest run tests/unit/edit-generation-service.test.ts`
Expected: FAIL(`EditGenerationServiceOptions` 无 `netProfit`;`generate` 返回草稿无 `sites`/净收益字段;`toEqual` 用例因新增必填字段而不匹配)。

- [ ] **Step 3: 写实现**

改 `src/domain/edit.ts`:把 Task 1 加的可选字段改为必填(去掉 `?`),类型不变。

改 `src/main/services/edit-generation-service.ts`:

```ts
// 构造选项加:
export type EditGenerationServiceOptions = {
  now?: () => string;
  netProfit?: Pick<NetProfitCalculator, 'computeForDraft'>;
};
// constructor 里存:
private readonly netProfit?: Pick<NetProfitCalculator, 'computeForDraft'>;
// constructor 体内:
this.netProfit = options.netProfit;
```

`toDraft` 返回值加空字段(在 `skus: skuFields` 前加顶层字段;并给 `skuFields` 每个元素加两个空 map):

```ts
    return {
      version: 1,
      createdAt: this.now(),
      title: this.aiField(output.title),
      description: this.aiField(output.description),
      brand: GENERIC_FIELD,
      model: output.model.value.trim() ? this.aiField(output.model) : GENERIC_FIELD,
      sites: [],
      siteAndPriceMap: {},
      skus: skuFields,
    };
```

`skuFields` map 里每个元素加:

```ts
        siteAndPriceMap: {},
        siteAndListingTypeInfoMap: {},
```

`generate` 末尾改为:

```ts
    const draft = this.toDraft(detail, parsed.data, skus);
    const withSites = { ...draft, sites: detail.siteCollectItemInfo.sites ?? [] };
    return this.netProfit ? this.netProfit.computeForDraft(withSites) : withSites;
```

(顶部 import `NetProfitCalculator` 类型。)

改 `src/main/ipc/edit-handlers.ts`:

- `EditHandlerDependencies` 加 `netProfit: Pick<NetProfitCalculator, 'computeForDraft'>`;顶部 import `NetProfitCalculator`。
- `normalizeDraft` 返回对象加兜底:

```ts
  return {
    ...draft,
    brand: { value: 'Generic', source: 'fixed', confidence: 1 },
    sites: draft.sites ?? [],
    siteAndPriceMap: draft.siteAndPriceMap ?? {},
    skus: (legacy.skus ?? []).map((sku) => ({
      ...sku,
      stock: sku.stock ?? emptyField,
      sourcePrice: sku.sourcePrice ?? emptyField,
      package: normalizePackage(sku.package),
      siteAndPriceMap: sku.siteAndPriceMap ?? {},
      siteAndListingTypeInfoMap: sku.siteAndListingTypeInfoMap ?? {},
    })),
  };
```

- `editSaveDraft` handler 里在 bump version 前重算:

```ts
      const { productId, draft } = saveDraftSchema.parse(payload);
      const recomputed = dependencies.netProfit.computeForDraft(draft);
      const saved = {
        ...recomputed,
        version: nextVersion(dependencies.snapshots, productId, recomputed),
      };
      appendDraft(dependencies.snapshots, productId, saved);
```

改 `src/main/ipc/register-handlers.ts`(在 Task 7 基础上):`HandlerDependencies` 加 `netProfitCalculator: Pick<NetProfitCalculator, 'computeForDraft'>`;`registerEditHandlers` 调用处传 `netProfit: dependencies.netProfitCalculator`(Task 7 已传 `settings`/`fxRates`/`refreshRates` 给 `registerNetProfitHandlers`)。

改 `src/main.ts`(复用 Task 7 已装配的 `fxRateRepository`/`fxRateService`):

```ts
import { NetProfitCalculator } from './main/services/net-profit-calculator';
// fxRateRepository / fxRateService 已在 Task 7 装配,此处仅追加 calculator。
const netProfitCalculator = new NetProfitCalculator(appSettings, fxRateRepository);
```

`editService` 构造加第 4 个 options 参数:

```ts
  const editService = new EditGenerationService(
    products,
    snapshots,
    () => { /* ... */ },
    { netProfit: netProfitCalculator },
  );
```

`registerHandlers` 依赖对象在 Task 7 已有的基础上再加:

```ts
      netProfitCalculator,
```

- [ ] **Step 4: 运行测试,确认通过**

先更新 `tests/unit/edit-generation-service.test.ts` 的主 `toEqual` 用例(第 ~140 行)期望对象,加入新字段(该用例未接 calculator,故为默认空值):

```ts
    expect(draft).toEqual({
      version: 1,
      createdAt: '2026-08-28T01:00:00.000Z',
      title: { value: 'Molinillo de café con muela de cerámica', source: 'ai', confidence: 0.95 },
      description: { value: 'Muele café en grano con muela de cerámica ajustable.', source: 'ai', confidence: 0.88 },
      brand: { value: 'Generic', source: 'fixed', confidence: 1 },
      model: { value: 'CM-100', source: 'ai', confidence: 0.6 },
      sites: [],
      siteAndPriceMap: {},
      skus: [
        {
          skuKey: ';white;',
          name: { value: 'Blanco', source: 'ai', confidence: 0.9 },
          stock: { value: '2', source: 'ai', confidence: 1 },
          sourcePrice: { value: '66', source: 'remote', confidence: 1 },
          package: {
            length: { value: '20', source: 'ai', confidence: 0.7 },
            width: { value: '10', source: 'ai', confidence: 0.7 },
            height: { value: '8', source: 'ai', confidence: 0.7 },
            dimensionUnit: 'cm',
            weight: { value: '500', source: 'ai', confidence: 0.8 },
            weightUnit: 'g',
          },
          siteAndPriceMap: {},
          siteAndListingTypeInfoMap: {},
        },
        {
          skuKey: ';black;',
          name: { value: 'Negro', source: 'ai', confidence: 0.9 },
          stock: { value: '2', source: 'ai', confidence: 1 },
          sourcePrice: { value: '68', source: 'remote', confidence: 1 },
          package: {
            length: { value: '20', source: 'ai', confidence: 0.7 },
            width: { value: '10', source: 'ai', confidence: 0.7 },
            height: { value: '8', source: 'ai', confidence: 0.7 },
            dimensionUnit: 'cm',
            weight: { value: '500', source: 'ai', confidence: 0.8 },
            weightUnit: 'g',
          },
          siteAndPriceMap: {},
          siteAndListingTypeInfoMap: {},
        },
      ],
    });
```

(其余用 `toMatchObject`/定向断言的用例不受新增字段影响。)

Run: `npx vitest run tests/unit/edit-generation-service.test.ts tests/unit/net-profit-repositories.test.ts tests/unit/net-profit-handlers.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: 全量测试 + 提交**

Run: `npx vitest run`
Expected: 全部 PASS。

```bash
git add src/domain/edit.ts src/main/services/edit-generation-service.ts \
  src/main/ipc/edit-handlers.ts src/main/ipc/register-handlers.ts src/main.ts \
  tests/unit/edit-generation-service.test.ts
git commit -m "feat: compute net profit on generate and recompute on save"
```

---

### Task 9: 工作台「利润率配置」弹窗

**Files:**
- Create: `src/ui/features/netprofit/NetProfitConfigModal.tsx`
- Create: `tests/unit/net-profit-config-modal.test.tsx`
- Modify: `src/ui/pages/WorkbenchPage.tsx`(api prop + ssr stub + 工具栏按钮 + 弹窗)
- Modify: `src/ui/pages/workbench.css`(弹窗样式)

**Interfaces:**
- Consumes: `NetProfitApi`;`DEFAULT_NET_PROFIT_CONFIG` / `DEFAULT_FX_RATES`。
- Produces: `function NetProfitConfigModal({ api, onClose }: { api: NetProfitApi; onClose: () => void }): JSX.Element`(开弹窗即拉 `getConfig()` 填充表单;保存走 `saveConfig`;汇率区块可刷新)。

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/net-profit-config-modal.test.tsx`(首行必须加 jsdom 环境声明):

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NetProfitConfigModal } from '../../src/ui/features/netprofit/NetProfitConfigModal';
import { DEFAULT_FX_RATES, DEFAULT_NET_PROFIT_CONFIG } from '../../src/domain/net-profit';
import type { NetProfitApi } from '../../src/shared/ipc-contract';

function api(): NetProfitApi {
  return {
    getConfig: vi.fn(async () => ({
      config: { ...DEFAULT_NET_PROFIT_CONFIG },
      fxRates: { ...DEFAULT_FX_RATES, updatedAt: '2026-08-29T00:00:00.000Z' },
    })),
    saveConfig: vi.fn(async (config) => config),
    refreshRates: vi.fn(async () => ({ ...DEFAULT_FX_RATES, cny: 7.4, updatedAt: '2026-08-29T01:00:00.000Z' })),
  };
}

describe('NetProfitConfigModal', () => {
  it('loads the current config and renders the rate block', async () => {
    const a = api();
    render(<NetProfitConfigModal api={a} onClose={vi.fn()} />);

    // 目标利润率输入框(带 label 定位,避免匹配到同值的铂金佣金输入框)。
    await screen.findByLabelText('目标利润率（%）');
    expect((screen.getByLabelText('目标利润率（%）') as HTMLInputElement).value).toBe('20');
    // 汇率区块四个货币 + 更新时间。
    expect(screen.getByText(/CNY/)).toBeTruthy();
    expect(screen.getByText(/2026-08-29T00:00:00.000Z/)).toBeTruthy();
  });

  it('saves a new target margin and closes', async () => {
    const a = api();
    const onClose = vi.fn();
    render(<NetProfitConfigModal api={a} onClose={onClose} />);

    const margin = await screen.findByLabelText('目标利润率（%）');
    fireEvent.change(margin, { target: { value: '30' } });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => expect(a.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ targetMargin: 30 }),
    ));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('refreshes the fx rates in place', async () => {
    const a = api();
    render(<NetProfitConfigModal api={a} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('刷新汇率'));

    await waitFor(() => expect(a.refreshRates).toHaveBeenCalled());
    expect(await screen.findByText(/2026-08-29T01:00:00.000Z/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npx vitest run tests/unit/net-profit-config-modal.test.tsx`
Expected: FAIL(组件不存在)。

- [ ] **Step 3: 写实现**

创建 `src/ui/features/netprofit/NetProfitConfigModal.tsx`:

```tsx
import { useEffect, useState } from 'react';

import type { FxRates, NetProfitConfig } from '../../../domain/net-profit';
import type { NetProfitApi } from '../../../shared/ipc-contract';

type NetProfitConfigModalProps = {
  api: NetProfitApi;
  onClose: () => void;
};

export function NetProfitConfigModal({ api, onClose }: NetProfitConfigModalProps) {
  const [loaded, setLoaded] = useState(false);
  const [targetMargin, setTargetMargin] = useState('20');
  const [marginMode, setMarginMode] = useState<'income' | 'price'>('price');
  const [classicComm, setClassicComm] = useState('12');
  const [premiumComm, setPremiumComm] = useState('20');
  const [packingCost, setPackingCost] = useState('2.5');
  const [fx, setFx] = useState<FxRates | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .getConfig()
      .then((snapshot) => {
        if (cancelled) return;
        const c: NetProfitConfig = snapshot.config;
        setTargetMargin(String(c.targetMargin));
        setMarginMode(c.marginMode);
        setClassicComm(String(c.commission.classic));
        setPremiumComm(String(c.commission.premium));
        setPackingCost(String(c.packingCost));
        setFx(snapshot.fxRates);
        setLoaded(true);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '配置读取失败。');
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function runSave() {
    setSaving(true);
    setError('');
    try {
      await api.saveConfig({
        targetMargin: Number(targetMargin),
        marginMode,
        commission: { classic: Number(classicComm), premium: Number(premiumComm) },
        packingCost: Number(packingCost),
      });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '配置保存失败。');
      setSaving(false);
    }
  }

  async function runRefresh() {
    setRefreshing(true);
    setError('');
    try {
      setFx(await api.refreshRates());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '汇率刷新失败。');
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="detail-modal-overlay" onClick={onClose} role="presentation">
      <div
        aria-label="利润率配置"
        aria-modal="true"
        className="detail-modal net-profit-config-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="detail-modal-header">
          <div>
            <span className="section-kicker">NET PROFIT</span>
            <h2>利润率配置</h2>
          </div>
          <button className="secondary-button" onClick={onClose} type="button">关闭</button>
        </div>

        {error && <div className="page-error">{error}</div>}
        {!loaded && !error && <p className="detail-loading">正在读取配置…</p>}

        {loaded && (
          <>
            <div className="net-profit-form">
              <div className="edit-draft-field">
                <label htmlFor="np-target">目标利润率（%）</label>
                <input
                  id="np-target"
                  onChange={(event) => setTargetMargin(event.target.value)}
                  value={targetMargin}
                />
              </div>

              <div className="net-profit-mode">
                <span className="net-profit-mode-label">利润率口径</span>
                <label>
                  <input
                    checked={marginMode === 'income'}
                    name="np-mode"
                    onChange={() => setMarginMode('income')}
                    type="radio"
                  />
                  模式一（利润 ÷ 净收益）
                </label>
                <label>
                  <input
                    checked={marginMode === 'price'}
                    name="np-mode"
                    onChange={() => setMarginMode('price')}
                    type="radio"
                  />
                  模式二（利润 ÷ 平台发布价）
                </label>
              </div>

              <div className="net-profit-commissions">
                <div className="edit-draft-field">
                  <label htmlFor="np-classic">经典佣金（%）</label>
                  <input
                    id="np-classic"
                    onChange={(event) => setClassicComm(event.target.value)}
                    value={classicComm}
                  />
                </div>
                <div className="edit-draft-field">
                  <label htmlFor="np-premium">铂金佣金（%）</label>
                  <input
                    id="np-premium"
                    onChange={(event) => setPremiumComm(event.target.value)}
                    value={premiumComm}
                  />
                </div>
              </div>

              <div className="edit-draft-field">
                <label htmlFor="np-packing">贴单打包费（CNY）</label>
                <input
                  id="np-packing"
                  onChange={(event) => setPackingCost(event.target.value)}
                  value={packingCost}
                />
              </div>
            </div>

            {fx && (
              <section className="net-profit-rates">
                <h3>汇率（1 USD 兑换）</h3>
                <div className="net-profit-rates-grid">
                  <span>CNY {fx.cny.toFixed(4)}</span>
                  <span>MXN {fx.mxn.toFixed(4)}</span>
                  <span>BRL {fx.brl.toFixed(4)}</span>
                  <span>ARS {fx.ars.toFixed(4)}</span>
                </div>
                <p className="net-profit-rates-meta">
                  更新时间：{fx.updatedAt || '尚未刷新'}
                  <button
                    className="secondary-button"
                    disabled={refreshing}
                    onClick={() => void runRefresh()}
                    type="button"
                  >
                    {refreshing ? '刷新中…' : '刷新汇率'}
                  </button>
                </p>
                <p className="edit-note">
                  运费为内置阶梯表核价预估，非平台实时账单，正式上架前请用卖家后台实际运费复核。
                </p>
              </section>
            )}

            <div className="edit-actions">
              <button className="secondary-button" disabled={saving} onClick={onClose} type="button">
                取消
              </button>
              <button className="primary-button" disabled={saving} onClick={() => void runSave()} type="button">
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

修改 `src/ui/pages/WorkbenchPage.tsx`:

- import 加:
```ts
import type { NetProfitApi } from '../../shared/ipc-contract';
import { DEFAULT_FX_RATES, DEFAULT_NET_PROFIT_CONFIG } from '../../domain/net-profit';
import { NetProfitConfigModal } from '../features/netprofit/NetProfitConfigModal';
```
- `WorkbenchPageProps` 的 `api` 类型加 `netProfit?: NetProfitApi`。
- 加 ssr stub(放在其他 ssr stub 旁):
```ts
const ssrNetProfitApi: NetProfitApi = {
  async getConfig() {
    return { config: { ...DEFAULT_NET_PROFIT_CONFIG }, fxRates: { ...DEFAULT_FX_RATES } };
  },
  async saveConfig(config) {
    return config;
  },
  async refreshRates() {
    return { ...DEFAULT_FX_RATES };
  },
};
```
- 组件内解析:
```ts
const netProfitApi =
  api?.netProfit ??
  (typeof window === 'undefined' ? ssrNetProfitApi : window.mercado.netProfit);
```
- state:`const [netProfitConfigOpen, setNetProfitConfigOpen] = useState(false);`
- 工具栏 `.toolbar-actions` 最前面加按钮:
```tsx
<button
  className="secondary-button"
  onClick={() => setNetProfitConfigOpen(true)}
  type="button"
>
  利润率配置
</button>
```
- 弹窗渲染(工具栏按钮附近或返回末尾):
```tsx
{netProfitConfigOpen && (
  <NetProfitConfigModal
    api={netProfitApi}
    onClose={() => setNetProfitConfigOpen(false)}
  />
)}
```

`src/ui/pages/workbench.css` 加样式(`.net-profit-config-modal .net-profit-form` 用 flex/grid 纵向排列;`.net-profit-rates-grid` 用 4 列 grid;`@media` 窄屏降列)。复用现有 `.edit-draft-field`/`.edit-actions`/`.page-error`/`.edit-note` 类。

- [ ] **Step 4: 运行测试,确认通过**

Run: `npx vitest run tests/unit/net-profit-config-modal.test.tsx`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/ui/features/netprofit/NetProfitConfigModal.tsx \
  src/ui/pages/WorkbenchPage.tsx src/ui/pages/workbench.css \
  tests/unit/net-profit-config-modal.test.tsx
git commit -m "feat: add net-profit margin config modal to the workbench"
```

---

### Task 10: 草稿 SKU 卡片净收益展示

**Files:**
- Modify: `src/ui/features/editor/EditPanel.tsx`(aiDraft 视图:全球净收益区块 + 每个 SKU 卡片的净收益行)
- Modify: `src/ui/pages/workbench.css`(净收益展示样式)
- Create: `tests/unit/edit-panel-net-profit.test.tsx`

**Interfaces:**
- Consumes: `draft.sites` / `sku.siteAndPriceMap` / `sku.siteAndListingTypeInfoMap` / 顶层 `draft.siteAndPriceMap`;`normalizeSiteKey` / `SITE_LABELS` / `LISTING_TYPE_LABELS`。
- Produces: 只读展示,不提供手改。只显示**产品类型、净收益、全球净收益**,不显示发布价/运费。

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/edit-panel-net-profit.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EditPanel } from '../../src/ui/features/editor/EditPanel';
import type { EditDraft } from '../../src/domain/edit';
import type { Product, ProductDetail } from '../../src/domain/product';
import type { EditApi } from '../../src/shared/ipc-contract';

const draft: EditDraft = {
  version: 1,
  createdAt: '2026-08-29T00:00:00.000Z',
  title: { value: 'Título', source: 'ai', confidence: 0.9 },
  description: { value: 'Descripción', source: 'ai', confidence: 0.9 },
  brand: { value: 'Generic', source: 'fixed', confidence: 1 },
  model: { value: 'M', source: 'ai', confidence: 0.6 },
  sites: ['MX(Up)', 'AR(Up)'],
  siteAndPriceMap: { 'MX(Up)': '11.5', 'AR(Up)': '11.5' },
  skus: [
    {
      skuKey: ';a;',
      name: { value: 'Blanco', source: 'ai', confidence: 0.9 },
      stock: { value: '2', source: 'ai', confidence: 1 },
      sourcePrice: { value: '20', source: 'remote', confidence: 1 },
      package: {
        length: { value: '20', source: 'ai', confidence: 0.7 },
        width: { value: '10', source: 'ai', confidence: 0.7 },
        height: { value: '8', source: 'ai', confidence: 0.7 },
        dimensionUnit: 'cm',
        weight: { value: '500', source: 'ai', confidence: 0.8 },
        weightUnit: 'g',
      },
      siteAndPriceMap: { 'MX(Up)': '9', 'AR(Up)': '11.5' },
      siteAndListingTypeInfoMap: {
        MX: { listingType: 'gold_pro' },
        AR: { listingType: 'gold_special' },
      },
    },
  ],
};

function api(): EditApi {
  return {
    draft: vi.fn(async () => draft),
    generate: vi.fn(async () => draft),
    saveDraft: vi.fn(async (_id, value) => value),
  };
}

const product = { id: 'p1', title: 'Metrónomo' } as Product;

function detail(): ProductDetail {
  return {
    productId: 'p1',
    title: 'Metrónomo',
    description: 'Afinador',
    itemNumber: null,
    category: null,
    sites: ['MX(Up)', 'AR(Up)'],
    stock: null,
    netProfit: null,
    sourcePrice: null,
    mainImage: null,
    images: [],
    skuList: [],
    brand: null,
    model: null,
  };
}

describe('EditPanel net profit display', () => {
  it('shows the global net profit and per-site type + net profit on each SKU card', async () => {
    render(<EditPanel api={api()} loadDetail={async () => detail()} product={product} />);

    // 草稿存在 → 出现「AI 编辑详情」页签
    fireEvent.click(await screen.findByText('AI 编辑详情'));

    expect(screen.getByText('全球净收益')).toBeTruthy();
    // 全球净收益渲染为 '$11.5 USD'(整段文本,不拆开)。
    expect(screen.getByText('$11.5 USD')).toBeTruthy();
    // 站点行:墨西哥(铂金, 9)+ 阿根廷(经典, 11.5)
    expect(screen.getByText('墨西哥')).toBeTruthy();
    expect(screen.getByText('阿根廷')).toBeTruthy();
    expect(screen.getByText('铂金')).toBeTruthy();
    expect(screen.getByText('经典')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npx vitest run tests/unit/edit-panel-net-profit.test.tsx`
Expected: FAIL(`全球净收益` 文案不存在)。

- [ ] **Step 3: 写实现**

修改 `src/ui/features/editor/EditPanel.tsx`:

- 顶部 import 加:
```ts
import {
  LISTING_TYPE_LABELS,
  SITE_LABELS,
  normalizeSiteKey,
} from '../../../domain/net-profit';
```
- 加两个展示辅助函数(文件底部 `FieldMeta` 旁):
```tsx
function siteLabel(siteKey: string): string {
  return SITE_LABELS[normalizeSiteKey(siteKey)] ?? siteKey;
}

function listingTypeLabel(listingType: string | undefined): string {
  return listingType ? (LISTING_TYPE_LABELS[listingType] ?? listingType) : '—';
}
```
- aiDraft 视图,`model` 字段(第 ~325 行)之后插入全球净收益区块:
```tsx
{Object.values(draft.siteAndPriceMap ?? {})[0] !== undefined && (
  <div className="edit-draft-field edit-global-net-profit">
    <label>全球净收益</label>
    <span className="edit-readonly-value">
      ${Object.values(draft.siteAndPriceMap ?? {})[0]} USD
    </span>
  </div>
)}
```
- SKU 卡片 `draft.skus.map(...)` 内,`edit-package-grid` 之后追加净收益区块:
```tsx
<div className="edit-net-profit">
  <h4>净收益</h4>
  {Object.entries(sku.siteAndPriceMap ?? {}).map(([siteKey, value]) => {
    const siteCode = normalizeSiteKey(siteKey);
    const listingType = sku.siteAndListingTypeInfoMap?.[siteCode]?.listingType;
    return (
      <div className="edit-net-profit-row" key={siteKey}>
        <span className="net-profit-site">{siteLabel(siteKey)}</span>
        <span className="net-profit-type">{listingTypeLabel(listingType)}</span>
        <span className="net-profit-value">${value}</span>
      </div>
    );
  })}
  {Object.keys(sku.siteAndPriceMap ?? {}).length === 0 && (
    <p className="empty-risk">暂无净收益数据。</p>
  )}
</div>
```

`src/ui/pages/workbench.css` 加样式(复用 `.edit-sku-card` 内联展示习惯):

```css
.edit-sku-card .edit-net-profit { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border-weak, rgba(0,0,0,.08)); }
.edit-sku-card .edit-net-profit h4 { margin: 0 0 8px; font-size: 12px; letter-spacing: .04em; text-transform: uppercase; opacity: .6; }
.edit-net-profit-row { display: flex; align-items: baseline; gap: 10px; padding: 3px 0; }
.net-profit-site { min-width: 64px; font-weight: 600; }
.net-profit-type { color: var(--text-muted, #777); flex: 1; }
.net-profit-value { font-variant-numeric: tabular-nums; font-weight: 600; }
.edit-global-net-profit { margin-top: 4px; }
.edit-global-net-profit .edit-readonly-value { font-weight: 700; }
```

(若项目 CSS 已有 `--border-weak` 等变量则直接用;无则用兜底值,或按现有配色习惯写。)

- [ ] **Step 4: 运行测试,确认通过**

Run: `npx vitest run tests/unit/edit-panel-net-profit.test.tsx`
Expected: PASS。

- [ ] **Step 5: 全量测试 + 手动验证 + 提交**

Run: `npx vitest run`
Expected: 全部 PASS。

手动验证(可选,运行 `npm start`):
1. 同步一个商品 → AI 编辑生成草稿 → 「AI 编辑详情」页签里每个 SKU 卡片出现站点行(产品类型 + 净收益),顶部出现全球净收益。
2. 改货源价/重量 → 保存草稿 → 净收益随新值更新。
3. 工作台点「利润率配置」→ 改目标利润率/口径/佣金/打包费 → 保存;刷新汇率;重开草稿验证净收益按新配置变化。

```bash
git add src/ui/features/editor/EditPanel.tsx src/ui/pages/workbench.css \
  tests/unit/edit-panel-net-profit.test.tsx
git commit -m "feat: show net profit and product type in draft SKU cards"
```

---

## Self-Review

**Spec coverage:**
- §3.1 草稿扩展(对齐妙手)→ Task 1(类型)+ Task 3(schema)+ Task 8(必填/写入)。
- §3.1.1 字段对照 → Task 8 写回口径一致(`siteAndPriceMap` 用完整站点键、`siteAndListingTypeInfoMap` 用裸码,与妙手真实数据一致)。
- §3.2 配置存储 → Task 1(类型)+ Task 4(`app_settings` key=`net_profit_config`)。
- §3.3 汇率存储 → Task 4(`fx_rates` 独立表,按 spec 倾向)+ Task 5(拉取/缓存)。
- §4 计算引擎 → Task 2(纯函数)+ Task 6(编排/全球净收益聚合)。
- §5 IPC → Task 7。
- §6.1 利润率配置弹窗 → Task 9。
- §6.2 草稿 SKU 卡片展示(仅产品类型/净收益/全球净收益,不含发布价/运费)→ Task 10。
- §7 计算时机(生成后 + 保存时)→ Task 8。
- §8 妙手写回 → 明确为后续阶段,不在本计划内;本计划仅保证字段结构一致。
- §9 测试 → 每个任务自带测试 + 组件测试。

**Placeholder scan:** 无 TBD/TODO;所有步骤含可直接执行的代码与运行命令。

**Type consistency:**
- `computeSkuNetProfit` 返回 `{ siteAndPriceMap: Record<string,string>, siteAndListingTypeInfoMap: Record<string,{listingType:string}> }`;Task 6/8 原样写入草稿同名字段。
- `NetProfitCalculator.computeForDraft(draft: EditDraft): EditDraft` 在 Task 6 定义、Task 8 注入 `EditGenerationServiceOptions.netProfit` 与 `registerEditHandlers` deps、main.ts 装配——签名一致。
- `NetProfitSettingsRepository` / `FxRateRepository` 在 Task 1 定义、Task 4 由 `SqliteAppSettingsRepository` / `SqliteFxRateRepository` 实现、Task 5/6/7 消费——一致。
- 站点键约定(价格 map 用 `MX(Up)`,listingType map 用 `MX`)贯穿 Task 2 引擎、Task 6 聚合、Task 10 展示。

**已知取舍(记入计划,后续阶段处理):**
- 产品级 `siteAndPriceMap` 的「全球净收益」以每个站点键指向同一全局值的方式存储(`Record<string,string>`,键与 SKU 站点键一致)。妙手产品级字段的确切序列化(真实数据里该字段为空)留待妙手写回阶段再与真实接口核对。
- ARS 内置默认 1450 仅为离线兜底,联网刷新覆盖。
- UI 组件测试用 `@testing-library/react`(已装),断言避免 jest-dom matcher(未装)。
