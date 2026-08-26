# API Reference - MercadoLibre Collect Box Edit

## API Authorization Details

Use an approved Miaoshou ERP Open Platform app. Credentials can come from environment variables, an explicit config file path, or a skill-local config file. Optional `MIAOSHOU_BASE_URL` defaults to `https://openapi-erp.91miaoshou.com`.

Lookup order:

1. `MIAOSHOU_CONFIG_PATH`
2. This skill's `resources/config.json`
3. `MIAOSHOU_APP_KEY` / `MIAOSHOU_APP_SECRET` / `MIAOSHOU_BASE_URL` override file values

Every request is signed POST JSON with `Content-Type: application/json`, `x-app-key`, `x-timestamp`, and `x-sign`.

```text
sign = HmacSHA256(appSecret, appSecret + path + timestamp + appKey + bodyJson + appSecret)
```

Use only the API path in `path`, seconds-level Unix timestamp, and the exact compact JSON body that is sent. Never print secrets or signed headers.

Common auth failures: `signMissing`, `signExpired`, `signInvalid`, `appNotFound`, `appNoPermission`, `ipNotInWhitelist`.

## Platform And Site Facts

- API platform code for claim/shop workflows: `mercadolibre`.
- Platform collect box base path: `/open/v1/product/collect_box/mercadolibre/collect_box/`.
- Publish path: `/open/v1/product/collect_box/mercadolibre/move_collect/save_move_collect_task`.
- Current docs do not split normal/global into separate endpoint families.
- `get_auth_site_and_site_name_map` accepts `includeCbt` to include CBT global sites.
- List filtering includes `filterCidSite`, documented as fixed `CBT`.
- Product `sites` can contain values like `BR`, `BR(Full)`, or `BR(Full)(Up)`. Preserve returned values exactly.

## Operation Safety

| Operation | Safety level | Requirement |
| --- | --- | --- |
| List/detail/options/site/rule query | Read-only | Run when scope is clear |
| Diagnosis/readiness | Read-only | Report issues without writing |
| Create/save | Write | Build full payload, preview, require confirmation |
| Applying AI-generated values | Write | Mark as recommendation, preview, require confirmation |

## List Collect Box Items

`POST /open/v1/product/collect_box/mercadolibre/collect_box/search_collect_box_detailList`

Request:

```json
{
  "pageNo": 1,
  "pageSize": 20,
  "filter": {
    "status": "notPublished",
    "filterCidSite": "CBT",
    "sourceItemIdKeyword": ""
  }
}
```

Status values: `notPublished`, `timingPublish`, `published`.

Key response fields: `collectBoxDetailId`, `itemNum`, `cid`, `globalPrice`, `stock`, `price`, `thumbnail`, `commonCollectBoxDetailId`, `platform`, `title`, `notes`, `prePublishShopInfo`.

## Detail

`POST /open/v1/product/collect_box/mercadolibre/collect_box/get_site_collect_item_info`

Request:

```json
{
  "detailId": 12345,
  "shopId": 1001,
  "cid": 123456
}
```

Only `detailId` is required. Use `shopId` when switching shop context and `cid` when switching category.

Response data includes:

- `saleAttributeRules`
- `productAttributeRules`
- `skuAttributeRules`
- `siteCollectItemInfo`

Important `siteCollectItemInfo` fields:

| Field | Meaning |
| --- | --- |
| `title` | Product title |
| `notes` | Product description/remarks |
| `cid` | MercadoLibre category ID |
| `shopId` | ERP shop ID |
| `sites` | Selected site/mode values |
| `siteAndTitleList` | Per-site title list |
| `siteAndListingTypeList` | Per-site listing type list |
| `pricingMode` | `sellPrice` or `netProceeds` |
| `siteAndPriceMap` | Per-site price map |
| `attributes` | Product attributes |
| `saleAttributes` | Variant/sale attributes |
| `skuMap` | SKU rows keyed by sale attribute combination |
| `firstSkuKey` | First SKU key corresponding to `skuMap` |
| `hasSaveSite` | Whether site info has been saved |
| `hasSavePrice` | Whether price info has been saved |
| `saveDetailTs` | Detail save timestamp returned by detail API |

## Create Collect Box Item

`POST /open/v1/product/collect_box/mercadolibre/collect_box/create_collect_box_item`

Request top-level field: `siteCollectItemInfo`.

Response data field: `collectBoxDetailId`.

Build the same full `siteCollectItemInfo` shape used by save. Preview before create.

## Save Site Detail

`POST /open/v1/product/collect_box/mercadolibre/collect_box/save_site_collect_item_info`

Request:

```json
{
  "detailId": 12345,
  "siteCollectItemInfo": {
    "price": 19.99,
    "cid": "123456",
    "title": "...",
    "notes": "...",
    "shopId": "1001",
    "sites": ["BR"],
    "siteAndPriceMap": {"BR": 19.99},
    "saleAttributes": [],
    "attributes": [],
    "skuMap": {},
    "hasSaveSite": 1
  }
}
```

Required top-level fields: `detailId`, `siteCollectItemInfo`.

The docs do not show `ossMd5`, `version`, or `revision`. Treat save as a full-object write because nested structures are extensive and create/save share the same `siteCollectItemInfo` schema. Query current detail first and preserve unchanged nested fields.

`save` runs local pre-validation by default and stops before the API when required fields are missing. Use `preflight --detail-id <id> --shop-id <shopId> --cid <cid>` to fetch current detail, category rules, category setting, and one consolidated readiness list before constructing a save payload. Use `--skip-pre-validate` only when deliberately probing the upstream API.

Use `--raw` or `--json` when parsing CLI output. These modes print JSON only; human summary lines are suppressed.

`normalize --payload <file> --context <detail-json>` is a local dry-run helper. It prints `changes`, `warnings`, a normalized payload candidate, and post-normalize pre-validation results. It does not call the API and does not save.

Safe automatic conversions:

- Add product attribute `name` from category rules when the payload only has a matching `id`.
- Convert scalar attribute values, such as `2026`, to `{"name": "2026"}`.
- Convert `saleAttributes[].values[].skuKey` from a string to an integer only when the same value object already has an integer `id` or `valueId`.
- Rewrite `skuMap` keys and `firstSkuKey` to match converted sale attribute value IDs.

Warnings only, no automatic write:

- Missing warranty values.
- Overlong titles.
- Brand/category values not backed by current detail or rules.
- String `skuKey` values without an integer `id` or `valueId` on the same value.

## Detail To Save Format Differences

Do not blindly copy every detail value into a save payload. Known differences:

| Area | Detail may return | Save expects |
| --- | --- | --- |
| Product attribute identity | `id`, such as `BRAND` | `name`, such as `Brand`, unless the current rule/detail proves otherwise |
| `saleAttributes[].values[].skuKey` | ERP/internal hex-like string | MercadoLibre integer attribute value ID |
| `skuMap` key | ERP/internal hex combinations | Combination using the MercadoLibre value IDs that match `saleAttributes` |
| Numeric-like attribute values | raw numbers, such as `2026` | attribute value objects, such as `{"name": "2026"}` |
| Brand fallback | guessed user value | API-provided/rule-backed value, for example `Generic` when returned by detail/rules |

If `saleAttributes[].values[].skuKey` is a string, local pre-validation reports it before save because the API expects an integer.

## SKU Map

`skuMap` key format is the sale-attribute value combination, for example `;0a310071;502c632b;`.

Important SKU fields:

| Field | Meaning |
| --- | --- |
| `price` | Sale price. In CBT flows this may not be persisted on each SKU. Prefer SPU/SKU `siteAndPriceMap` for site pricing checks. |
| `originPrice` | Original/source price |
| `stock` | Stock quantity |
| `itemNum` | SKU item number |
| `upc` | UPC |
| `imgUrls` | SKU image URLs |
| `length`, `width`, `height`, `lengthWidthHeightUnit` | Package dimensions |
| `weight`, `weightUnit` | Package weight |
| `siteAndPriceMap` | Per-site SKU price map |
| `siteAndListingTypeInfoMap` | Per-site listing type info |
| `siteAndItemMarketplaceMap` | Per-site marketplace info |
| `sizeChartRowId` | Row ID from `search_size_chart_template` |
| `isDelete` | Deletion flag |

Preserve every SKU object unless the user explicitly confirms SKU structure changes.

## Support Options

`POST /open/v1/product/collect_box/mercadolibre/collect_box/get_item_options`

Returns option lists for weight unit, warranty type, warranty time unit, dimension unit, and `siteAndSupportListingTypeOptions`.

## Auth Site Map

`POST /open/v1/product/collect_box/mercadolibre/collect_box/get_auth_site_and_site_name_map`

Request:

```json
{
  "shopId": 1001,
  "includeCbt": 1
}
```

`includeCbt` is required. Response `siteAndSiteNameMap` maps site IDs to names.

## Category Endpoints

`POST /open/v1/product/collect_box/mercadolibre/collect_box/get_category_setting`

Request requires `cid` and `shopId`. Response includes `catalogDomain`, max description length, and max title length.

`POST /open/v1/product/collect_box/mercadolibre/collect_box/get_category_attribute_rules`

Request requires `cid` and `shopId`. Response includes `saleAttributeRules`, `productAttributeRules`, and `skuAttributeRules`.

## Readiness Notes

Before saying "ready", check required data against current detail/rules, not only a static list. At minimum check title, description, category, shop, site selection, listing type, site prices, warranty, required attributes, SKU map, stock, image availability, dimensions/weight, and size chart row IDs when required. Do not block CBT readiness solely because `skuMap[*].price` is absent when site pricing exists in `siteAndPriceMap`.

Do not treat a `cid` returned by claim/detail/default mapping as category-reviewed. Before save/create, route unreviewed `cid` values to `miaoshou-erp-mercadolibre-category-recommend` unless the user explicitly waives category review.

If category review returns `needs_user_confirmation` or `rejected`, do not save. Stop for the user's explicit decision. Similarly, do not write AI-selected `Brand`, `Model`, `Gender`, warranty, or compliance values without a post-preview confirmation; the user's earlier request to publish is not enough.
