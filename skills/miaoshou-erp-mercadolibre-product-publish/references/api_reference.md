# API Reference - MercadoLibre Product Publish

## Auth

Use signed Miaoshou ERP POST JSON requests. Credentials can come from `MIAOSHOU_CONFIG_PATH`, this skill's `resources/config.json`, or `MIAOSHOU_APP_KEY` / `MIAOSHOU_APP_SECRET`; optional `MIAOSHOU_BASE_URL` defaults to `https://openapi-erp.91miaoshou.com`.

Signing:

```text
sign = HmacSHA256(appSecret, appSecret + path + timestamp + appKey + bodyJson + appSecret)
```

Never print secrets or signed headers.

## Readiness Source

Use product detail before publish:

`POST /open/v1/product/collect_box/mercadolibre/collect_box/get_site_collect_item_info`

Request:

```json
{
  "detailId": 12345
}
```

Check current `siteCollectItemInfo` and returned attribute rules. Route missing/uncertain fields to `miaoshou-erp-mercadolibre-product-edit`.

## Publish

`POST /open/v1/product/collect_box/mercadolibre/move_collect/save_move_collect_task`

Request:

```json
{
  "detailIds": [12345, 12346]
}
```

Rules:

- `detailIds` is required.
- Maximum 200 IDs per request.
- Current docs do not include `shopIds` in the publish request.
- Response is a simple success/error shape.
- Treat this as task submission. The current docs do not include a publish task query endpoint.

## Safety

Always show a publish plan before calling the API:

- item count
- exact `detailIds`
- ready/skipped/failed groups
- category-review status per item; route unreviewed claim/detail/default `cid` values to `miaoshou-erp-mercadolibre-category-recommend` unless the user explicitly waives review
- missing fields for skipped items
- exact post-edit confirmation status when any AI-selected field was added during readiness repair
- statement that no automatic edits will be made
- statement that final marketplace status may be unknown after task submission
