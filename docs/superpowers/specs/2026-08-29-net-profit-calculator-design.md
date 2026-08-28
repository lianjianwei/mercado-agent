# 净利润计算器设计

> 日期:2026-08-29
> 状态:设计稿,待评审
> 计算逻辑参考:[docs/美客多净利润计算器.md](../../美客多净利润计算器.md) 与 [mercado-calculadora/index.html](../../../../mercado-calculadora/index.html)

## 1. 目标

AI 编辑生成草稿后,基于每个 SKU 的货源价、重量、尺寸,结合商品站点、全局配置(目标利润率、口径、佣金、打包费)与汇率,**算出每个 SKU × 每个站点的净收益与产品类型**,作为草稿的一部分随草稿落库,最终能写回妙手 ERP。

计算为**本地逻辑,不依赖 AI**。

## 2. 核心规则

| 项 | 规则 |
|---|---|
| 计算粒度 | 每 SKU × 每站点各算一个净收益 |
| 产品类型 | AI 编辑后按「货源价<10 元 且 重量<200g → 经典;否则铂金」判定;阿根廷(AR)强制经典 |
| 产品类型 ↔ 佣金 | 经典(gold_special)→ 配置「经典佣金%」;铂金(gold_pro)→ 配置「铂金佣金%」 |
| 净收益存储 | 扩展草稿结构,每 SKU 存 `siteAndPriceMap`(对齐妙手),随草稿落库 |
| 全球净收益 | 所有 SKU 所有站点净收益的最大值(妙手回退默认值) |
| 运费 | 内置阶梯表(MX/BR/AR 三站),按计费重 + 售价阈值自动查 |
| 站点 | 妙手 `sites` 字段(可能含 MX(Up)/BR(Up)/AR(Up)),每站点用对应汇率与运费表 |
| 汇率 | 主进程拉接口 + 本地缓存(带时间戳),失败用缓存/内置默认 |
| 呈现 | 编辑草稿 SKU 卡片内,展示算好的净收益(存草稿,非临时) |
| 计算时机 | AI 生成草稿后算一次;保存草稿时(货源价/重量/尺寸被改过)重算 |
| 妙手对齐 | **草稿净收益/产品类型字段与妙手完全一致**:SKU 的 `siteAndPriceMap` + `siteAndListingTypeInfoMap`;产品级 `siteAndPriceMap` 存全球值;`pricingMode='netProceeds'` |
| 计算输入 | **一律用草稿里 AI 编辑后的值**(货源价、重量、尺寸),不用妙手原始值。草稿是「AI 编辑后」的当前状态 |

## 3. 数据结构

### 3.1 草稿扩展(`EditDraft` / `SkuEditField`)——对齐妙手结构

**核心原则:草稿里净收益与产品类型的字段名/结构,与妙手完全一致,这样保存回妙手时逐字段直接映射,无需翻译。**

参照妙手真实结构(`siteCollectItemInfo.skuMap[skuKey].siteAndPriceMap` / `siteAndListingTypeInfoMap`):

每个 SKU 新增两个字段,结构与妙手一致:

```ts
// SKU 级站点净收益,键为站点,如 'MX(Up)' / 'BR(Up)' / 'AR(Up)'
// 值:该 SKU 在该站点的净收益(数字或字符串,与妙手一致)
type SkuSiteAndPriceMap = Record<string, number | string>;

// SKU 级站点产品类型,键为站点
// 值:该 SKU 在该站点的 listingType(经典 gold_special / 铂金 gold_pro),与妙手一致
type SkuSiteAndListingTypeInfoMap = Record<
  string,
  { listingType: string }
>;

// 加在 SkuEditField
type SkuEditField = {
  // ...现有字段(保留 EditField 包装,不写回妙手)
  siteAndPriceMap: SkuSiteAndPriceMap;              // 新增,对齐妙手
  siteAndListingTypeInfoMap: SkuSiteAndListingTypeInfoMap;  // 新增,对齐妙手
};
```

产品级(`EditDraft` 顶层)也新增,对齐妙手 `siteCollectItemInfo.siteAndPriceMap`(回退默认值):

```ts
type EditDraft = {
  // ...现有字段
  siteAndPriceMap: Record<string, number | string>;  // 产品级站点净收益(全球值),对齐妙手
};
```

- **净收益值直接存妙手格式**:妙手 `siteAndPriceMap` 值是字符串(`"15.47"`),草稿存同格式,写回时原样放回。
- **产品类型存 listingType 字符串**:`gold_special`(经典) / `gold_pro`(铂金),写回时直接映射。
- 草稿保存时(`editSaveDraft`)校验此结构(更新 `editDraftSchema`)。
- `normalizeDraft` 对旧草稿补默认空对象 `{}`,向后兼容。
- 产品级 `siteAndPriceMap` 存全球净收益(所有 SKU 所有站点最大值),妙手用它做回退默认。

### 3.1.1 草稿其他字段与妙手的对照

现有草稿字段保持现状(带 EditField 包装,记录 AI 来源/置信度,不写回妙手),只保证净收益+产品类型对齐:

| 草稿字段 | 妙手字段 | 处理 |
|---|---|---|
| `sku.skuKey` | `skuMap.<key>` | 一致,不变 |
| `sku.name` (EditField) | `skuMap.<key>.itemNum` | 保留 EditField,写回时取 `.value` |
| `sku.stock` (EditField) | `skuMap.<key>.stock` | 保留 EditField |
| `sku.sourcePrice` (EditField) | `skuMap.<key>.originPrice` | 保留 EditField |
| `sku.package.*` (EditField) | `skuMap.<key>.length/width/height/weight` | 保留嵌套 EditField |
| `sku.siteAndPriceMap` | `skuMap.<key>.siteAndPriceMap` | **新增,直接对齐** |
| `sku.siteAndListingTypeInfoMap` | `skuMap.<key>.siteAndListingTypeInfoMap` | **新增,直接对齐** |
| 顶层 `siteAndPriceMap` | `siteCollectItemInfo.siteAndPriceMap` | **新增,直接对齐** |

### 3.2 全局配置(利润率配置)

存 `app_settings` 表(现有 key-value,key = `net_profit_config`):

```ts
type NetProfitConfig = {
  targetMargin: number;              // 目标利润率,如 20 = 20%
  marginMode: 'income' | 'price';   // 模式一(利润÷净收益) / 模式二(利润÷发布价)
  commission: {
    classic: number;                 // 经典 %,gold_special
    premium: number;                 // 铂金 %,gold_pro
  };
  packingCost: number;              // 贴单打包费,CNY
};
```

### 3.3 汇率存储

`app_settings` 表新 key(`fx_rates`),或独立轻量表。倾向独立表 `fx_rates`:

```ts
type FxRates = {
  cny: number;   // USD→CNY
  mxn: number;   // USD→MXN
  brl: number;   // USD→BRL
  ars: number;   // USD→ARS
  updatedAt: string;
};
```

- 主进程启动时拉 `https://open.er-api.com/v6/latest/USD`,存本地;失败用缓存或内置默认。

## 4. 计算引擎

`src/main/services/net-profit-engine.ts`(纯函数,无副作用),输入 SKU 参数 + 站点 + 配置 + 汇率,输出结果。

```
输入: {
  sourcePriceCny: number;          // 货源价, CNY
  weightG: number;                 // 重量, g
  lengthCm: number; widthCm: number; heightCm: number;  // 尺寸, cm
  sites: SiteKey[];                // 商品站点
  config: NetProfitConfig;
  fxRates: FxRates;
}
输出: {
  // 站点 → 净收益(直接写入草稿/妙手的 SKU.siteAndPriceMap,值保留字符串格式)
  siteAndPriceMap: Record<SiteKey, string>;
  // 站点 → 产品类型(直接写入草稿/妙手的 SKU.siteAndListingTypeInfoMap)
  siteAndListingTypeInfoMap: Record<SiteKey, { listingType: string }>;
  // 产品级全球净收益(所有 SKU 所有站点最大值,写入草稿/妙手顶层 siteAndPriceMap)
  globalNetProfit: string;
}
```

> 引擎输出直接对接妙手字段:`siteAndPriceMap` / `siteAndListingTypeInfoMap` 原样写入草稿对应字段,保存到妙手时无需翻译。`listingType` 用妙手的字符串(`gold_special` 经典 / `gold_pro` 铂金)。
>
> 运费、平台发布价、佣金等中间值为计算过程内部值,不落入草稿存储(后续「净收益计算逻辑显示」需要展示时,可再扩展引擎返回明细)。

计算步骤(与参考计算器一致,见 `docs/美客多净利润计算器.md`):

1. **产品类型判定**:每站点,`sourcePriceCny < 10 && weightG < 200` → 经典,否则铂金;AR 强制经典。
2. **取佣金率**:按判定的产品类型取 `config.commission`。
3. **计费重**:毛重 `= weightG/1000` kg;体积重 `= L×W×H/6000`;毛重<500g 用毛重,否则取较大。
4. **查运费档位**:按计费重落在阶梯表档位;档位给高/低售价两价;按「反推售价 ≥ 阈值」两步求解选列。
5. **反推净收益**:
   - 模式一:`net = baseCny / (r_cny × (1 - target))`。
   - 模式二:两步(先用低售价运费解,再按阈值决定是否用高售价运费重解)。
6. **衍生**:发布价 `price = (net + ship)/(1-comm)`,佣金、利润、实际利润率。
7. **全球净收益** = 各站点净收益最大值,写入产品级 `siteAndPriceMap`(妙手回退默认)。

## 5. IPC 接线

- 新增 IPC channels:
  - `netProfit:getConfig` / `netProfit:saveConfig`
  - `netProfit:refreshRates`(手动刷新汇率)
- 新增 handler `src/main/ipc/net-profit-handlers.ts`,注册进 `register-handlers.ts`。
- `preload.ts` 暴露 `window.mercado.netProfit`。
- `ipc-contract.ts` 增加 `NetProfitApi`。

## 6. UI

### 6.1 工作台「利润率配置」按钮

工作台页面(`WorkbenchPage`)工具栏新增「利润率配置」按钮,点开为弹窗,配置:

- 目标利润率(%)数字输入
- 利润率口径:模式一(利润÷净收益)/ 模式二(利润÷发布价)
- 佣金:经典 % / 铂金 %(两输入)
- 贴单打包费(CNY)

弹窗内可查看/手动刷新汇率(显示 USD→CNY/MXN/BRL/ARS 当前值及更新时间)。

### 6.2 编辑草稿 SKU 卡片展示

`EditDraftModal` / `EditPanel` 的每个 SKU 卡片内新增「净收益」区块,展示草稿里存的 `siteAndPriceMap` + `siteAndListingTypeInfoMap`。**只显示三项:产品类型、净收益、全球净收益。**

- 每个站点一行:站点名、产品类型(经典/铂金,由 `listingType` 映射)、净收益(USD)。
- 卡片/弹窗顶部或底部显示**全球净收益**(产品级 `siteAndPriceMap` 值)。
- **不展示发布价、运费**(这些是净收益的推导过程,属于后续「净收益计算逻辑显示」)。
- 只读展示(存储值),不提供手改。
- 若 SKU 缺净收益(旧草稿),显示「—」。

> **净收益计算逻辑显示(后续,本次不做)**:参考某个页面设计一个「为什么是这个净收益」的展示,包含运费、平台发布价、对应的运费阶梯。届时再增加相关 UI 与展示字段。

## 7. 计算时机

- `editGenerate` 生成草稿后:用生成后的 SKU 货源价/重量/尺寸算净收益、判定产品类型,写入草稿。
- `editSaveDraft` 保存草稿时:重新计算净收益(因货源价/重量/尺寸可能被人工改过),写入后再存。
- 草稿展示:直接读草稿里存的净收益。

## 8. 妙手写回(后续阶段,本次不做)

草稿净收益/产品类型字段**已与妙手完全一致**,保存时**逐字段原样映射,无需翻译**:

- 草稿 `sku.siteAndPriceMap` → `skuMap[skuKey].siteAndPriceMap`。
- 草稿 `sku.siteAndListingTypeInfoMap` → `skuMap[skuKey].siteAndListingTypeInfoMap`。
- 草稿顶层 `siteAndPriceMap`(全球值)→ 产品级 `siteCollectItemInfo.siteAndPriceMap`。
- `pricingMode = 'netProceeds'`。

## 9. 测试

- `tests/unit/net-profit-engine.test.ts`:纯函数,覆盖
  - 两种口径(模式一/模式二)× 三站(MX/BR/AR)
  - 产品类型判定(经典/铂金/AR 强制经典)
  - 计费重边界(毛重 vs 体积重、500g 阈值)
  - 反推净收益正确性(与参考计算器示例对照)
  - 全球净收益取最大值
  - 输出 `siteAndPriceMap` / `siteAndListingTypeInfoMap` 与妙手字段一致
- `editDraftSchema` 扩展后校验测试(新增 `siteAndPriceMap` / `siteAndListingTypeInfoMap`)。
- 配置/汇率 IPC handler 测试。
- UI 组件测试(利润率配置弹窗、草稿净收益展示)。

## 10. 依赖与风险

- 依赖 `open.er-api.com` 可用性;失败降级到缓存/内置默认。
- 运费为内置阶梯表核价预估,非实时账单,需在 UI 保留提示。
- 旧草稿(无净收益字段)通过 `normalizeDraft` 兜底。
- 妙手写回字段(`siteAndPriceMap` 等)已从真实接口确认,结构对齐。
