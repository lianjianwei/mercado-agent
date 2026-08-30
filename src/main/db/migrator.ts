import type { DatabaseSync } from 'node:sqlite';

import initialMigration from './migrations/001_initial.sql?raw';
import productsMigration from './migrations/002_products.sql?raw';
import infringementMigration from './migrations/003_infringement.sql?raw';
import productsColumnsMigration from './migrations/004_products_columns.sql?raw';
import localPublishStateMigration from './migrations/005_local_publish_state.sql?raw';
import fxRatesMigration from './migrations/006_fx_rates.sql?raw';
import aiImagesKindMigration from './migrations/007_ai_images_kind.sql?raw';
import codexProviderMigration from './migrations/008_codex_provider.sql?raw';
import reasoningEffortMigration from './migrations/009_reasoning_effort.sql?raw';

type Migration = {
  version: number;
  name: string;
  sql: string;
};

const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial',
    sql: initialMigration,
  },
  {
    version: 2,
    name: 'products',
    sql: productsMigration,
  },
  {
    version: 3,
    name: 'infringement',
    sql: infringementMigration,
  },
  {
    version: 4,
    name: 'products_columns',
    sql: productsColumnsMigration,
  },
  {
    version: 5,
    name: 'local_publish_state',
    sql: localPublishStateMigration,
  },
  {
    version: 6,
    name: 'fx_rates',
    sql: fxRatesMigration,
  },
  {
    version: 7,
    name: 'ai_images_kind',
    sql: aiImagesKindMigration,
  },
  {
    version: 8,
    name: 'codex_provider',
    sql: codexProviderMigration,
  },
  {
    version: 9,
    name: 'reasoning_effort',
    sql: reasoningEffortMigration,
  },
];

export function applyMigrations(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const appliedVersions = new Set(
    database
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => Number(row.version)),
  );
  const recordMigration = database.prepare(`
    INSERT INTO schema_migrations (version, name, applied_at)
    VALUES (?, ?, ?)
  `);

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(migration.sql);
      recordMigration.run(
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}
