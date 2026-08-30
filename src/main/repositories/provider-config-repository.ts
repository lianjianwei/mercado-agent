import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { ProviderConfigNotFoundError } from '../../domain/config';
import type {
  ProviderConfig,
  ProviderConfigInput,
  ProviderConfigRepository,
  ProviderKind,
  ReasoningEffort,
} from '../../domain/config';

type ProviderConfigRow = {
  id: string;
  kind: ProviderKind;
  provider: ProviderConfig['provider'];
  name: string;
  api_key: string;
  base_url: string;
  model: string;
  reasoning_effort: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
};

function mapProviderConfig(row: ProviderConfigRow): ProviderConfig {
  return {
    id: row.id,
    kind: row.kind,
    provider: row.provider,
    name: row.name,
    apiKey: row.api_key,
    baseUrl: row.base_url,
    model: row.model,
    reasoningEffort: (row.reasoning_effort ?? undefined) as ReasoningEffort | undefined,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteProviderConfigRepository
  implements ProviderConfigRepository
{
  constructor(private readonly database: DatabaseSync) {}

  list(kind: ProviderKind): ProviderConfig[] {
    return this.database
      .prepare(
        `
          SELECT id, kind, provider, name, api_key, base_url, model,
                 reasoning_effort, is_active, created_at, updated_at
          FROM provider_configs
          WHERE kind = ?
          ORDER BY created_at ASC, id ASC
        `,
      )
      .all(kind)
      .map((row) => mapProviderConfig(row as ProviderConfigRow));
  }

  save(input: ProviderConfigInput): ProviderConfig {
    const id = input.id ?? randomUUID();
    const existing = this.findById(id);

    if (existing && existing.kind !== input.kind) {
      throw new Error('A provider configuration cannot change kind');
    }

    const now = new Date().toISOString();
    this.database
      .prepare(
        `
          INSERT INTO provider_configs (
            id, kind, provider, name, api_key, base_url, model,
            reasoning_effort, is_active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            provider = excluded.provider,
            name = excluded.name,
            api_key = excluded.api_key,
            base_url = excluded.base_url,
            model = excluded.model,
            reasoning_effort = excluded.reasoning_effort,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        id,
        input.kind,
        input.provider,
        input.name,
        input.apiKey,
        input.baseUrl,
        input.model,
        input.reasoningEffort ?? null,
        now,
        now,
      );

    return this.requireById(id);
  }

  activate(id: string): void {
    const configuration = this.requireById(id);
    const deactivateKind = this.database.prepare(`
      UPDATE provider_configs
      SET is_active = 0, updated_at = ?
      WHERE kind = ? AND is_active = 1
    `);
    const activateOne = this.database.prepare(`
      UPDATE provider_configs
      SET is_active = 1, updated_at = ?
      WHERE id = ?
    `);
    const now = new Date().toISOString();

    this.database.exec('BEGIN IMMEDIATE');
    try {
      deactivateKind.run(now, configuration.kind);
      activateOne.run(now, id);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  delete(id: string): void {
    this.database.prepare('DELETE FROM provider_configs WHERE id = ?').run(id);
  }

  private findById(id: string): ProviderConfig | null {
    const row = this.database
      .prepare(
        `
          SELECT id, kind, provider, name, api_key, base_url, model,
                 reasoning_effort, is_active, created_at, updated_at
          FROM provider_configs
          WHERE id = ?
        `,
      )
      .get(id) as ProviderConfigRow | undefined;

    return row ? mapProviderConfig(row) : null;
  }

  private requireById(id: string): ProviderConfig {
    const configuration = this.findById(id);
    if (!configuration) {
      throw new ProviderConfigNotFoundError();
    }
    return configuration;
  }
}
