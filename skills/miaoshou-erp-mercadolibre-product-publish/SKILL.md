---
name: miaoshou-erp-mercadolibre-product-publish
description: Publish ready Miaoshou ERP MercadoLibre/Mercado Livre collect box products after readiness checks and confirmation. Use when the task mentions 发布美客多, MercadoLibre发布, Mercado Livre上架, 美客多采集箱发布, 提交MercadoLibre发布任务, or publishing ready detailIds.
---

# Miaoshou ERP MercadoLibre Product Publish

Submit ready MercadoLibre collect box products. Missing data must route to `miaoshou-erp-mercadolibre-product-edit`.

Use `--raw` or `--json` when command output will be parsed by another script; these modes print JSON only.

## Typical User Requests

"发布美客多商品"; "检查能否发布"; "批量发布采集箱商品"; "发布前看缺字段"; "提交后汇总成功/失败".

## API Authorization

Before API calls, confirm an approved Open Platform app, configured credentials, and IP whitelist if enabled. Requests are signed POST JSON; never expose secrets. Read `references/api_reference.md` for signing and auth errors.

## Safety Rules

- Publishing is high-impact; always require explicit confirmation.
- Never publish until exact `detailIds` and plan are confirmed. A user's initial "publish it" request does not authorize later AI-selected edits discovered during checks.
- Never publish an item whose category was only claim-auto-mapped or detail-defaulted unless category review was completed or the user explicitly waives it.
- The current publish endpoint accepts only `detailIds`, max 200. Do not add `shopIds` unless newer docs show it.
- Do not auto-fix title, price, stock, SKU, category, attributes, size chart, warranty, or listing type.
- Stop on readiness failure and report exact missing fields.
- Treat `save_move_collect_task` as task submission. Final marketplace status may require later query not present in the current docs.

## Standard Workflow

1. Parse exact `detailIds`; ask for missing IDs.
2. Query detail for every item and run readiness checks.
3. Verify category-review status for every item. If it is missing and `cid` came from claim/detail/default mapping, route to `miaoshou-erp-mercadolibre-category-recommend` before publish.
4. Show submitted, skipped, failed, pending, and category-review status in the plan.
5. If readiness required edits, category decisions, or AI-selected values, route to edit and require a fresh user confirmation after the final diff before publish.
6. Execute publish only after explicit confirmation.
7. Report API result honestly; final publish state may remain unknown.

## Scenario Handling

| User request | Expected behavior |
| --- | --- |
| "检查能不能发布" | Run readiness only; do not publish |
| "发布商品" | Check, preview, confirm, submit |
| Batch publish | Enforce max 200 `detailIds` per request |
| Missing required fields | Stop and route to product edit with exact fields |
| Missing category review | Stop and route to category recommend unless user explicitly waives review |
| AI-selected fixes needed | Preview exact values and stop for confirmation before save/publish |
| Mixed readiness | Publish only confirmed ready IDs if user explicitly confirms skipping the rest |

Readiness checks should not require per-SKU `price` for CBT products when pricing is carried by `siteAndPriceMap`.

Readiness logic is bundled in this skill's `scripts/mercadolibre_readiness.py`; keep it aligned with the product-edit copy when changing readiness rules.

## Failure Handling

- Missing `detailIds`: ask for IDs.
- Required field missing: stop; do not publish or auto-edit.
- API error: show code/message and affected IDs.
- Partial success: separate submitted, skipped, failed, and pending.
- Async/task submission: say final publish status needs later query or ERP check.
- Repeated write failure: do not retry without explicit user instruction.

## Related Skills

| Step | Skill |
| --- | --- |
| Find shops/site context | `miaoshou-erp-shop-query` |
| Claim from common collect box | `miaoshou-erp-product-claim` |
| Fix missing MercadoLibre fields | `miaoshou-erp-mercadolibre-product-edit` |
| Recommend categories | `miaoshou-erp-mercadolibre-category-recommend` |
| Plan size charts | `miaoshou-erp-mercadolibre-size-chart-manage` |

## Resources

Use `scripts/mercadolibre_publish.py check/publish`; read `references/api_reference.md` before interpreting failures.
