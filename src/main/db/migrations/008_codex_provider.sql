-- Allow the codex image provider. codex 走本机 CLI, 无需 baseUrl/apiKey/model:
-- 放宽这三列的非空校验(provider='codex' 时可留空), 并把 codex 加进 image 提供商列表。
-- SQLite 不能 ALTER CHECK, 故重建表。nothing references provider_configs, so drop/rename is safe.

CREATE TABLE provider_configs_new (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('text', 'image')),
  provider TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  api_key TEXT NOT NULL CHECK (provider = 'codex' OR length(trim(api_key)) > 0),
  base_url TEXT NOT NULL,
  model TEXT NOT NULL CHECK (provider = 'codex' OR length(trim(model)) > 0),
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (kind = 'text' AND provider IN ('doubao', 'deepseek', 'openai'))
    OR
    (kind = 'image' AND provider IN ('doubao', 'openai', 'codex'))
  )
) STRICT;

INSERT INTO provider_configs_new (
  id, kind, provider, name, api_key, base_url, model, is_active, created_at, updated_at
)
  SELECT id, kind, provider, name, api_key, base_url, model, is_active, created_at, updated_at
  FROM provider_configs;

DROP TABLE provider_configs;
ALTER TABLE provider_configs_new RENAME TO provider_configs;
