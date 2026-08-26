---
name: miaoshou-erp-mercadolibre-product-edit
description: Query, diagnose, create, and save Miaoshou ERP MercadoLibre/Mercado Livre collect box products before publish. Use when the user mentions 美客多采集箱, MercadoLibre商品编辑/查询, 保存采集箱, 创建商品, 补全发布信息, SKU, price, stock, category, attributes, sizeChartRowId, warranty, sites, or siteCollectItemInfo fixes.
---

# Miaoshou ERP MercadoLibre Product Edit

Query, create, diagnose, and save MercadoLibre collect box products. This skill prepares data; publishing belongs to `miaoshou-erp-mercadolibre-product-publish`.

## Core Boundary

- Use this skill for collect box list/detail queries, readiness diagnosis, create payloads, and confirmed saves.
- Query current detail before every save and build the save payload from the latest `siteCollectItemInfo`.
- Treat a `cid` returned after claim or detail query as a candidate, not as category proof, unless the user explicitly confirmed it or a category-review result is already present in the thread.
- Treat `siteCollectItemInfo` as a full-object save payload. Patch only confirmed fields into the latest full object.
- Preserve unrelated arrays, SKU maps, images, prices, stock, dimensions, listing types, site mappings, warranty fields, and source fields.
- Keep MercadoLibre site/mode values exactly as returned, such as `CBT`, `UP`, `BR`, `BR(Full)`, or `BR(Full)(Up)`.

## Workflow

1. Parse target `detailId`, `shopId`, `cid`, sites, and intended edits.
2. Query `get_site_collect_item_info`; pass `shopId` or `cid` when changing shop/category so rules refresh.
3. Before save/create, run a category review with `miaoshou-erp-mercadolibre-category-recommend` when `cid` came from claim auto-mapping, detail defaults, source platform mapping, or any unverified previous step. Do this even when detail already contains a `cid`.
4. Run `preflight` before building a save payload. It fetches detail/rules/category setting and returns one consolidated missing-field list.
5. Run `normalize --payload <file> --context <detail-json>` when adapting detail-shaped data into save-shaped data. Treat it as dry-run only.
6. Diagnose title, notes, category, attributes, sale attributes, SKU attributes, price, stock, site prices, listing type, warranty, dimensions, and size chart row IDs.
7. Route uncertain category/attribute decisions to `miaoshou-erp-mercadolibre-category-recommend`.
8. Route uncertain `sizeChartRowId` or measurements to `miaoshou-erp-mercadolibre-size-chart-manage`.
9. Preview field diffs, preserved fields, category-review result, SKU keys, selected sites, and publish risks.
10. Create or save only after explicit confirmation; then report result and remaining readiness.

## Save Semantics

The save endpoint is `save_site_collect_item_info` with `detailId` and full `siteCollectItemInfo`. Current docs do not show `ossMd5`, `version`, or `revision`, but nested fields still behave like a complete object.

`skuMap` keys use sale-attribute combinations such as `;0a310071;502c632b;`. Preserve keys and every active SKU object unless the user explicitly confirms a SKU structure change.

## Hard Rules

- Require explicit confirmation before create/save or AI-generated value write. A user's initial "publish it" request is not confirmation for later AI-chosen fixes discovered during readiness checks.
- After previewing proposed field changes, stop and wait for the user's confirmation before saving when any value is AI-selected, inferred, or newly generated.
- Do not save with an unreviewed claim/detail/default `cid` unless the user explicitly says to skip category review.
- Do not invent brand, certification, compliance, material, gender, warranty, logistics-sensitive values, or size chart rows.
- Do not use SKU, item number, source product code, or model code as `Brand` unless the user explicitly confirms that it is the brand. For `Model`, source item numbers may be proposed but still require confirmation before write.
- For `Gender`, size-chart gender, or category gender attributes, propose evidence-backed values such as women/men/unisex, but do not write them without confirmation.
- Do not publish from this skill.
- Stop on save failure and report the API code/message.
- For readiness-only requests, inspect and report; do not save.

## Readiness Checklist

Check at minimum `title`, `notes`, `cid`, `shopId`, `sites`, `siteAndTitleList`, `siteAndListingTypeList`, `siteAndPriceMap`, `pricingMode`, SPU `price`, warranty fields, required category attributes, `saleAttributes`, `skuMap`, `firstSkuKey`, per-SKU `stock`, `itemNum`, image URLs, dimensions, weight, listing type maps, marketplace maps, and size chart row IDs when category rules require them. Do not require per-SKU `price` when CBT pricing is carried by `siteAndPriceMap`.

Use `--raw` or `--json` when command output will be parsed by another script. These modes suppress human-readable summary lines and print JSON only.

`normalize` may convert rule-backed attribute `id` to `name`, scalar attribute values to `{"name": "..."}`, and sale attribute string `skuKey` values to integer IDs when an integer `id`/`valueId` is present on the same value. It must report warnings instead of inventing missing brand, warranty, title rewrites, or skuKey mappings.

Category review should state the current `cid`, evidence used, confidence, whether the `cid` is acceptable, and any alternative candidate or unresolved decision. If the category-recommend skill cannot access a category tree/search endpoint, it should still validate the existing `cid` against source title, source category path, category setting, and required attribute fit.

If category review returns `needs_user_confirmation` or `rejected`, do not proceed to save. Present the category result and ask the user to confirm the category, pick an alternative, or explicitly waive category review.

## Failure Handling

- Required field missing: report exact field and next step.
- Metadata mismatch: re-query detail or category rules; avoid stale enum IDs.
- Partial payload risk: rebuild from full current detail.
- Auth failure: check config, timestamp, permission, signature, and whitelist.

## Resources

Use `scripts/mercadolibre_collectbox.py list/detail/preflight/normalize/check/create/save/options/sites`. Read `references/api_reference.md` before creates, saves, readiness decisions, or interpreting endpoint failures.
