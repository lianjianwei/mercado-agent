CREATE TABLE infringement_runs (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  product_id TEXT NOT NULL REFERENCES products(id),
  fingerprint TEXT NOT NULL CHECK (length(trim(fingerprint)) > 0),
  version INTEGER NOT NULL CHECK (version >= 1),
  level TEXT NOT NULL CHECK (level IN ('none', 'low', 'medium', 'high')),
  kind TEXT NOT NULL CHECK (kind IN ('brand_owner', 'compatible_accessory', 'unbranded', 'unknown')),
  decision_json TEXT NOT NULL CHECK (json_valid(decision_json)),
  created_at TEXT NOT NULL,
  UNIQUE (product_id, version)
) STRICT;

CREATE INDEX infringement_runs_product_created
ON infringement_runs(product_id, created_at DESC, id ASC);

CREATE INDEX infringement_runs_product_fingerprint
ON infringement_runs(product_id, fingerprint, created_at DESC);
