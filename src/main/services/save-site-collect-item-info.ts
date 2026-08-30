// Build the `siteCollectItemInfo` body for the Miaoshou save endpoint as a
// minimal overlay over the original Miaoshou data.
//
// 妙手的保存接口要求整包 siteCollectItemInfo(price/cid/title/warrantyType/
// warrantyTime/warrantyTimeUnit/shopId/sites/siteAndPriceMap 均必填),因此这里
// 的做法是「从妙手原始数据克隆一份完整体,再把草稿拥有的字段覆盖上去」。只改草稿
// 实际拥有的字段:标题/描述/品牌/型号/SKU 名称/包裹尺寸重量/站点净收益/产品类型/
// 图片。其它(保修、类目、货源来源、saleAttributes 结构、pricingMode、库存、货源价、
// 价格等)一律保留妙手原值。这样既满足接口必传,又只写用户真正编辑过的内容,降低
// 把平台数据写坏的风险。

import type { EditDraft, SkuEditField } from '../../domain/edit';
import { normalizeSiteKey } from '../../domain/net-profit';

// 妙手把品牌/型号放在 attributes:[{ name, valueType?, values:[{ name }] }]。
// 按名字(含英文/西语/中文别名)定位已有项并更新其 values[0].name;不存在则追加。
const BRAND_NAMES = ['brand', 'marca', '品牌', 'Brand', 'Marca'];
const MODEL_NAMES = ['model', 'modelo', '型号', 'Model', 'Modelo'];
const APPEND_BRAND_NAME = 'Brand';
const APPEND_MODEL_NAME = 'Model';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// 妙手保存时每个规格属性带其规则 id(如 Color → "COLOR"、Size → "SIZE";GET 返回的
// saleAttributes 不含 id,故从 saleAttributeRules 按 name/displayName 匹配补上,不是写死
// 某个值)。values[].skuKey 保持字符串(妙手自己就发字符串)。
function buildSaleAttributes(
  saleAttributes: unknown[],
  rules: unknown[],
): unknown[] {
  const idByName = new Map<string, string>();
  for (const rule of rules) {
    const r = asRecord(rule);
    const id = typeof r.id === 'string' && r.id ? r.id : '';
    if (!id) continue;
    if (typeof r.name === 'string' && r.name) idByName.set(r.name.toLowerCase(), id);
    if (typeof r.displayName === 'string' && r.displayName) {
      idByName.set(r.displayName.toLowerCase(), id);
    }
  }
  return saleAttributes.map((attr) => {
    const a = asRecord(attr);
    const name = typeof a.name === 'string' ? a.name : '';
    const id = idByName.get(name.toLowerCase()) ?? (typeof a.id === 'string' ? a.id : undefined);
    const values = asArray(a.values).map((value) => {
      // 保留 skuKey 字符串与 name;
      return { ...asRecord(value) };
    });
    return { ...a, ...(id ? { id } : {}), values };
  });
}

// 草稿的净收益值是字符串(如 "8.50"),妙手 siteAndPriceMap 要求数字。转成 number,
// 无法解析的项丢弃,避免把 NaN 写上去。
function toNumberMap(map: Record<string, string> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(map ?? {})) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) out[key] = numeric;
  }
  return out;
}

function upsertAttribute(
  attributes: unknown[],
  names: string[],
  value: string,
  appendName: string,
): unknown[] {
  const list = attributes.map((item) => ({ ...asRecord(item) }));
  const lower = names.map((name) => name.toLowerCase());
  const existing = list.find((item) => {
    const name = typeof item.name === 'string' ? item.name.toLowerCase() : '';
    return lower.some((wanted) => name === wanted || name.includes(wanted));
  });
  if (existing) {
    // 找到已有属性:替换其 values 首项的名称,保留其余字段(valueType 等)。
    const values = asArray(existing.values).map((val) => ({ ...asRecord(val) }));
    if (values.length > 0) values[0].name = value;
    else values.push({ name: value });
    existing.values = values;
  } else {
    list.push({ name: appendName, valueType: 'string', values: [{ name: value }] });
  }
  return list;
}

// 合并草稿各 SKU 站点产品类型,生成产品级 siteAndListingTypeList:[{ site, listingType }]。
// 同一站点多个 SKU 用第一个(妙手以 firstSkuKey 为权威);匹配用 normalizeSiteKey 兼容
// "MX"/"MX(Up)" 等不同键格式;站点不在原有列表时追加。
function overlayListingTypeList(existing: unknown[], draft: EditDraft): unknown[] {
  const typedBySite: Record<string, string> = {};
  for (const sku of draft.skus ?? []) {
    for (const [siteCode, value] of Object.entries(sku.siteAndListingTypeInfoMap ?? {})) {
      const listingType = value?.listingType;
      if (listingType && !(siteCode in typedBySite)) typedBySite[siteCode] = listingType;
    }
  }
  if (Object.keys(typedBySite).length === 0) return existing;

  const list = existing.map((item) => ({ ...asRecord(item) }));
  for (const [site, listingType] of Object.entries(typedBySite)) {
    const match = list.find((item) => normalizeSiteKey(String(item.site ?? '')) === site);
    if (match) match.listingType = listingType;
    else list.push({ site, listingType });
  }
  return list;
}

function overlaySku(
  target: Record<string, unknown>,
  sku: SkuEditField,
  sharedDetailUrls: string[],
): Record<string, unknown> {
  const result = { ...target };

  const name = sku.name?.value?.trim();
  if (name) result.skuName = name;

  const pkg = sku.package;
  if (pkg) {
    if (pkg.length?.value?.trim()) result.length = pkg.length.value;
    if (pkg.width?.value?.trim()) result.width = pkg.width.value;
    if (pkg.height?.value?.trim()) result.height = pkg.height.value;
    if (pkg.weight?.value?.trim()) result.weight = pkg.weight.value;
    if (pkg.dimensionUnit) result.lengthWidthHeightUnit = pkg.dimensionUnit;
    if (pkg.weightUnit) result.weightUnit = pkg.weightUnit;
  }

  // 站点净收益(站点价格),转 number 写入 skuMap[key].siteAndPriceMap。
  if (Object.keys(sku.siteAndPriceMap ?? {}).length > 0) {
    result.siteAndPriceMap = toNumberMap(sku.siteAndPriceMap);
  }

  // 产品类型,按裸站点码写入 skuMap[key].siteAndListingTypeInfoMap。
  if (Object.keys(sku.siteAndListingTypeInfoMap ?? {}).length > 0) {
    result.siteAndListingTypeInfoMap = { ...sku.siteAndListingTypeInfoMap };
  }

  // 图片:该 SKU 自己的已生成图 + 全部共用详情图(从草稿产品级 images 里取,排除各
  // SKU 主图)。草稿的 sku.imageUrls 常只含主图,详情图在草稿产品级 images;这里两者
  // 都并进去,保证妙手 SKU 图片 = 主图 + 全部详情图。任一有 AI 生成图才覆盖,否则保留
  // 妙手原图(防止误清平台图片)。
  const ownUrls = Array.isArray(sku.imageUrls) ? sku.imageUrls : [];
  const urls = [...new Set([...ownUrls, ...sharedDetailUrls])];
  if (urls.length > 0) {
    result.imgUrls = urls;
  }

  // 货源价(originPrice)跟随 SKU:草稿默认值就是妙手原值,写入时与妙手原值相同则不
  // 重复写;仅当用户改过(值不同)时才真正更新。妙手 originPrice 是字符串。
  const sourcePrice = sku.sourcePrice?.value?.trim();
  if (sourcePrice && String(target.originPrice ?? '') !== sourcePrice) {
    result.originPrice = sku.sourcePrice.value;
  }

  // 库存(stock)跟随 SKU:以 AI 编辑详情里的库存值为准(通常即草稿里的低库存值,
  // 用户用来控制库存)。草稿库存与妙手原值不同时才更新。
  const stockValue = sku.stock?.value?.trim();
  if (stockValue && String(target.stock ?? '') !== stockValue) {
    result.stock = sku.stock.value;
  }

  // 注意:不写 price / itemNum / upc / sizeGridRowId / isDelete ——产品级价格等不在
  // 本次回写范围,保留妙手原值。

  return result;
}

export function buildSiteCollectItemInfo(
  original: Record<string, unknown>,
  draft: EditDraft,
  saleAttributeRules: unknown[] = [],
): Record<string, unknown> {
  const info: Record<string, unknown> = { ...original };

  // 妙手保存接口要求 warrantyTime 必填(integer);无保修商品的妙手详情返回 null/S'',
  // 原样提交会让妙手报「siteCollectItemInfo.warrantyTime 必填」。为缺失/空值填 0。
  if (info.warrantyTime === null || info.warrantyTime === undefined || info.warrantyTime === '') {
    info.warrantyTime = 0;
  }

  // 妙手自己的保存请求里 saleAttributes[].values[].skuKey 就是字符串(不是整数),
  // 且每个规格属性会带其规则 id(如 Color → "COLOR";妙手 GET 返回的 saleAttributes
  // 不含 id)。这里补上 id(从 saleAttributeRules 按 name 匹配),并原样保留 skuKey 字符串。
  info.saleAttributes = buildSaleAttributes(asArray(info.saleAttributes), saleAttributeRules);

  const title = draft.title?.value?.trim();
  if (title) info.title = title;

  const notes = draft.description?.value;
  if (notes && notes.trim() !== '') info.notes = notes;

  // 品牌/型号写入 attributes(只改对应属性,不失其它属性)。
  const brand = draft.brand?.value;
  const model = draft.model?.value;
  const attributes = upsertAttribute(
    asArray(info.attributes),
    BRAND_NAMES,
    brand,
    APPEND_BRAND_NAME,
  );
  info.attributes = upsertAttribute(attributes, MODEL_NAMES, model, APPEND_MODEL_NAME);

  // 产品级全球净收益:替换顶层 siteAndPriceMap(草稿覆盖所有发布站点,整段写入)。
  if (Object.keys(draft.siteAndPriceMap ?? {}).length > 0) {
    info.siteAndPriceMap = toNumberMap(draft.siteAndPriceMap);
  }

  // 产品级产品类型列表。
  info.siteAndListingTypeList = overlayListingTypeList(
    asArray(info.siteAndListingTypeList),
    draft,
  );

  // SKU 级覆盖:先克隆妙手原有 skuMap,再覆盖草稿拥有的 SKU 字段。草稿不含的 SKU
  // (如库存异常的)保留原样。
  const originalSkuMap = asRecord(info.skuMap);
  const skuMap: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(originalSkuMap)) {
    skuMap[key] = { ...asRecord(value) };
  }

  // 共用详情图 = 草稿产品级 images 里、被任何 SKU 主图之外的那些(单品/多规格都一样:
  // 详情图所有 SKU 共用,写进每个 SKU 的 imgUrls)。
  const skuMains = new Set<string>();
  for (const sku of draft.skus ?? []) {
    for (const url of sku.imageUrls ?? []) skuMains.add(url);
  }
  const sharedDetailUrls = (draft.images ?? []).filter((url) => !skuMains.has(url));

  for (const sku of draft.skus ?? []) {
    const key = sku.skuKey;
    const target: Record<string, unknown> = skuMap[key] ?? { imgUrls: [] as string[] };
    skuMap[key] = overlaySku(target, sku, sharedDetailUrls);
  }
  info.skuMap = skuMap;

  const skuKeys = Object.keys(skuMap);

  // 妙手用 firstSkuKey 指向 skuMap 的首个 SKU;详情数据里常见与该 key 不匹配的 stale
  // 值(如 firstSkuKey ";"456654ca;"" 而 skuMap 只有 ";;"),原样提交会让妙手校验失败。
  // 若原值不在 skuMap 中,规整为 skuMap 的首个 key。
  if (skuKeys.length > 0 && !skuMap[String(info.firstSkuKey ?? '')]) {
    info.firstSkuKey = skuKeys[0];
  }

  // 单品(单 SKU):妙手用产品级 siteAndPriceMap 展示「站点净收益」表,所以这里要写的是
  // 该 SKU 的逐站点差异值(如 2.79/2.54/2.51),而不是「全球最大值」的统一值(2.79/2.79/2.79);
  // 并存一个全球净收益到 price。「全球净收益」框即妙手读 price。
  if (skuKeys.length === 1) {
    const singleSiteMap = skuMap[skuKeys[0]]?.siteAndPriceMap;
    if (singleSiteMap && typeof singleSiteMap === 'object') {
      info.siteAndPriceMap = { ...asRecord(singleSiteMap) };
    }
    const globalNetProfit = deriveGlobalNetProfit(draft);
    if (globalNetProfit !== null) info.price = globalNetProfit;
  }

  return info;
}

// 草稿的全球净收益:产品级 siteAndPriceMap 首个有数字的值;没有则取各 SKU 站点净收益
// 的最大值(与计算器的「全球净收益」口径一致)。
function deriveGlobalNetProfit(draft: EditDraft): number | null {
  for (const value of Object.values(draft.siteAndPriceMap ?? {})) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  let max = -Infinity;
  for (const sku of draft.skus ?? []) {
    for (const value of Object.values(sku.siteAndPriceMap ?? {})) {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > max) max = numeric;
    }
  }
  return Number.isFinite(max) ? max : null;
}
