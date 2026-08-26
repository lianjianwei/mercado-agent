import type { DatabaseSync } from 'node:sqlite';

import {
  DISABLED_MODEL_PROXY,
  type AppSettingsRepository,
  type ModelProxyConfig,
} from '../../domain/proxy';
import { modelProxyConfigSchema } from '../../shared/config-schemas';

export class SqliteAppSettingsRepository implements AppSettingsRepository {
  constructor(private readonly database: DatabaseSync) {}

  getModelProxy(): ModelProxyConfig {
    const row = this.database
      .prepare('SELECT value_json FROM app_settings WHERE key = ?')
      .get('model_proxy') as { value_json: string } | undefined;
    if (!row) return { ...DISABLED_MODEL_PROXY };
    return modelProxyConfigSchema.parse(JSON.parse(row.value_json));
  }

  saveModelProxy(value: ModelProxyConfig): void {
    const normalized = modelProxyConfigSchema.parse(value);
    this.database
      .prepare(
        `
          INSERT INTO app_settings (key, value_json)
          VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
        `,
      )
      .run('model_proxy', JSON.stringify(normalized));
  }
}
