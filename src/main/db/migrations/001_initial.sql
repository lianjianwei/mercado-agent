CREATE TABLE provider_configs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('text', 'image')),
  provider TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  api_key TEXT NOT NULL CHECK (length(trim(api_key)) > 0),
  base_url TEXT NOT NULL,
  model TEXT NOT NULL CHECK (length(trim(model)) > 0),
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (kind = 'text' AND provider IN ('doubao', 'deepseek', 'openai'))
    OR
    (kind = 'image' AND provider IN ('doubao', 'openai'))
  )
) STRICT;

CREATE UNIQUE INDEX provider_configs_one_active_per_kind
ON provider_configs(kind)
WHERE is_active = 1;

CREATE TABLE app_credentials (
  key TEXT PRIMARY KEY CHECK (key IN ('miaoshou', 'qiniu')),
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK (json_valid(value_json))
) STRICT;
