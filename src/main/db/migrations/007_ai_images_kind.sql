-- Allow kind='aiImages' in product_snapshots: records AI-generated images
-- (per-SKU main + detail) with their local/planned paths, so a product's images
-- can be found and cleaned up later. SQLite cannot ALTER a CHECK constraint,
-- so rebuild the table with the extended kind list. Nothing references
-- product_snapshots, so the drop/rename is safe.

CREATE TABLE product_snapshots_new (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  product_id TEXT NOT NULL REFERENCES products(id),
  kind TEXT NOT NULL CHECK (kind IN ('miaoshou', 'aiDraft', 'saved', 'published', 'aiImages')),
  captured_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL
) STRICT;

INSERT INTO product_snapshots_new (id, product_id, kind, captured_at, payload_json, created_at)
  SELECT id, product_id, kind, captured_at, payload_json, created_at FROM product_snapshots;

DROP TABLE product_snapshots;
ALTER TABLE product_snapshots_new RENAME TO product_snapshots;

CREATE INDEX product_snapshots_product_captured_at
  ON product_snapshots(product_id, captured_at ASC, id ASC);
