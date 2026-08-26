---
name: miaoshou-erp-mercadolibre-category-recommend
description: Recommend or validate MercadoLibre/Mercado Livre leaf categories and attribute fill plans for Miaoshou ERP collect box products. Use when the user mentions 美客多类目, MercadoLibre category, 类目属性, required attributes, saleAttributes, SKU attributes, category guidance before edit/publish, or when a claim/detail/default cid needs review.
---

# Miaoshou ERP MercadoLibre Category Recommend

Recommend or validate MercadoLibre category and attribute-fill plans. This skill is read-only: it can inspect product/category evidence and produce a reviewed plan, but confirmed writes belong to `miaoshou-erp-mercadolibre-product-edit`.

## Core Boundary

- Prefer MercadoLibre platform detail, then common collect box detail, then user-provided product evidence.
- Treat claim auto-mapped, detail-returned, or source-platform `cid` values as candidates to review, not as proof that the category is correct.
- Use the MercadoLibre CBT category tree endpoint to find candidate categories before accepting claim/detail/default `cid` values.
- Use `shopId` with category setting and rule calls because shop context can change available rules.
- Return candidates when no authoritative category source exists; include confidence, alternatives, unresolved values, and evidence.
- Separate product attributes, sale attributes, SKU attributes, and fields that must remain unresolved.

## Workflow

1. Determine product evidence, target site/mode, `shopId`, `detailId`, and any known `cid`.
2. Query current detail when `detailId` is available.
3. Search category candidates with `scripts/mercadolibre_category.py tree --site CBT --keyword "<title or source category terms>" --leaf-only`.
4. If an existing `cid` is present, validate it against source title, source category path, item images/description when available, category tree candidates, category setting, and required attribute fit before accepting it.
5. Query category setting for `catalogDomain`, title/description limits, and category constraints.
6. Query attribute rules for `productAttributeRules`, `saleAttributeRules`, and `skuAttributeRules`.
7. Build a fill plan: required values, variant attributes, optional values, read-only/hidden fields, and unresolved user decisions.
8. Show category candidates, current-cid validation result, confidence, evidence, and SKU variant mapping before any handoff.
9. Route confirmed category/attribute writes to `miaoshou-erp-mercadolibre-product-edit`.

## Hard Rules

- Treat rule tags carefully: `required`, `catalogRequired`, `readOnly`, `hidden`, `multivalued`, `allowVariations`, and `definesPicture`.
- Never mark an existing `cid` as confirmed solely because detail returned it.
- Never invent regulated, certification, brand, material, age, gender, warranty, size chart, or compliance values.
- `needs_user_confirmation` means the downstream edit/publish flow must stop until the user responds; do not self-upgrade it to accepted.
- If category or required attributes are uncertain, keep them unresolved and ask the user.
- If size chart fields are needed, route row/template planning to `miaoshou-erp-mercadolibre-size-chart-manage`.
- If the user asks to save, preview the category/attribute plan and hand off to product edit; do not save here.

## Category Review Output

Always include:

- `currentCid`: the `cid` from detail/claim/source if present.
- `reviewStatus`: `accepted`, `needs_user_confirmation`, or `rejected`.
- `confidence`: high/medium/low with a short reason.
- `evidence`: source title, source category path, current category setting/rules, and attribute fit.
- `alternatives`: category-tree candidate `cid` values with paths, or explain why no candidate matched.
- `handoff`: exact fields/product attributes/sale attributes to pass to product edit after confirmation.

For required attribute proposals:

- Brand must come from current detail, source product evidence, user input, or an allowed category value. Do not derive brand from item number/SKU/model code unless the user confirms it.
- Model may use a source model/item number as a proposal, but it must be marked as requiring confirmation.
- Gender may be proposed from strong product evidence, but it must remain unresolved until confirmed when it will be written.

## Failure Handling

- Missing `shopId`: ask for the target shop or route to `miaoshou-erp-shop-query`.
- Unknown category: search the CBT category tree first; if candidates remain ambiguous, show the best matches and ask the user to choose.
- Read-only/hidden field: do not propose user-entered values unless API rules allow it.
- Auth failure: explain likely config, timestamp, permission, signature, or whitelist cause.

## Resources

Use `scripts/mercadolibre_category.py tree/setting/attributes/detail/options/sites`. Read `references/api_reference.md` before interpreting rule tags, category settings, or API failures.
