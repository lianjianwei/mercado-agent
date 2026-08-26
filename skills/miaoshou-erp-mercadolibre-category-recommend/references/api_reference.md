# API Reference - MercadoLibre Category Recommend

## Auth

Use signed Miaoshou ERP POST JSON requests. Credentials can come from `MIAOSHOU_CONFIG_PATH`, this skill's `resources/config.json`, or `MIAOSHOU_APP_KEY` / `MIAOSHOU_APP_SECRET`; optional `MIAOSHOU_BASE_URL` defaults to `https://openapi-erp.91miaoshou.com`.

Signing:

```text
sign = HmacSHA256(appSecret, appSecret + path + timestamp + appKey + bodyJson + appSecret)
```

Never print secrets or signed headers.

## Endpoint Facts

Current docs expose category tree, category settings, and attribute rules. Use the category tree to find candidate `cid` values before accepting claim/detail/default mappings.

Existing `cid` values from claim auto-mapping, source-platform mapping, or detail defaults are review candidates, not proof. Validate the current `cid` by checking source title/category path against category-tree candidates, category setting, required attributes, sale attributes, SKU attribute impact, and unresolved fields.

`needs_user_confirmation` is a blocking status for edit/publish. Do not treat medium confidence or a plausible current `cid` as accepted unless the user confirms it or the evidence is strong enough to mark `accepted`.

## Detail For Existing Products

`POST /open/v1/product/collect_box/mercadolibre/collect_box/get_site_collect_item_info`

Request requires `detailId`; optional `shopId` refreshes shop context and optional `cid` refreshes category context.

Response includes:

- `saleAttributeRules`
- `productAttributeRules`
- `skuAttributeRules`
- `siteCollectItemInfo`

Use detail first when the user gives a `detailId`.

## Category Tree

`POST /open/v1/product/collect_box/mercadolibre/collect_box/get_category_tree_by_site`

Request:

```json
{
  "site": "CBT"
}
```

`site` is required. Current docs describe fixed value `CBT`.

Response data:

| Field | Meaning |
| --- | --- |
| `cateTree` | Category tree map keyed by `cid` |
| `cid` | Category ID |
| `aid` | Ancestor category ID |
| `fid` | Parent category ID |
| `name` | Category name in English |
| `nameChinese` | Category name in Chinese |
| `isLastLevel` | Whether the category is a leaf category |
| `disabled` | Whether the category is disabled |
| `children` | Child category map keyed by `cid` |

Use `scripts/mercadolibre_category.py tree --site CBT --keyword "<terms>" --leaf-only` to search locally within the returned tree. Prefer leaf, non-disabled categories for publish candidates.

## Category Setting

`POST /open/v1/product/collect_box/mercadolibre/collect_box/get_category_setting`

Request:

```json
{
  "cid": 123456,
  "shopId": 1001
}
```

Response fields:

| Field | Meaning |
| --- | --- |
| `catalogDomain` | Category domain, used by size-chart flows |
| `maxDescriptionLength` | Category description length limit |
| `maxTitleLength` | Category title length limit |

## Category Attribute Rules

`POST /open/v1/product/collect_box/mercadolibre/collect_box/get_category_attribute_rules`

Request requires `cid` and `shopId`.

Response groups:

| Group | Use |
| --- | --- |
| `productAttributeRules` | Product-level attributes saved to `siteCollectItemInfo.attributes` |
| `saleAttributeRules` | Variant dimensions saved to `siteCollectItemInfo.saleAttributes` |
| `skuAttributeRules` | SKU-level attributes used while constructing `skuMap` values |

Important rule fields:

| Field | Meaning |
| --- | --- |
| `id` | Attribute ID |
| `name` | Attribute English/internal name |
| `displayName` | Attribute display name |
| `hierarchy` | `CHILD_DEPENDENT`, `PARENT_PK`, `FAMILY`, or `ITEM` |
| `relevance` | 1 core, 2 secondary, 3 optional |
| `tags` | Rule flags |
| `valueType` | `list`, `string`, `grid_id`, `boolean` |
| `values` | Allowed enum values |

Important tags:

- `required`
- `catalogRequired`
- `readOnly`
- `hidden`
- `multivalued`
- `allowVariations`
- `definesPicture`

Use allowed value `name` where docs say "从中选取name". Do not invent enum IDs or row IDs.

## Item Options

`POST /open/v1/product/collect_box/mercadolibre/collect_box/get_item_options`

Returns option lists for warranty, dimension units, weight units, and listing types by site. Use this before proposing listing type or warranty values.

## Site Map

`POST /open/v1/product/collect_box/mercadolibre/collect_box/get_auth_site_and_site_name_map`

Request requires `includeCbt`; optional `shopId`. Use `includeCbt=1` when global CBT site choices matter.

## Recommendation Output

Return:

- Current `cid` review status: `accepted`, `needs_user_confirmation`, or `rejected`.
- Recommended `cid` candidates, category-tree paths, and confidence.
- Required product attributes.
- Required sale attributes and SKU key impact.
- Required SKU attributes.
- Size-chart fields that must route to `miaoshou-erp-mercadolibre-size-chart-manage`.
- Unresolved fields that require user confirmation.
- A preview-ready change plan for `miaoshou-erp-mercadolibre-product-edit`.

For required attribute proposals, do not derive `Brand` from item numbers, source product codes, SKU codes, or model codes unless the user confirms that value is the brand. `Model` and `Gender` can be proposed from evidence, but they remain confirmation-required before write.
