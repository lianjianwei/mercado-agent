CREATE TABLE products (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  state TEXT NOT NULL CHECK (state IN ('notPublished', 'timingPublish', 'published', 'missing')),
  title TEXT,
  item_number TEXT,
  thumbnail_url TEXT,
  last_synced_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX products_state_last_synced_at
ON products(state, last_synced_at DESC, id ASC);

CREATE TABLE product_snapshots (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  product_id TEXT NOT NULL REFERENCES products(id),
  kind TEXT NOT NULL CHECK (kind IN ('miaoshou', 'aiDraft', 'saved', 'published')),
  captured_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX product_snapshots_product_captured_at
ON product_snapshots(product_id, captured_at ASC, id ASC);
