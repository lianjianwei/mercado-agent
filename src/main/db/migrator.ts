import type { DatabaseSync } from 'node:sqlite';

import initialMigration from './migrations/001_initial.sql?raw';
import productsMigration from './migrations/002_products.sql?raw';
import infringementMigration from './migrations/003_infringement.sql?raw';
import productsColumnsMigration from './migrations/004_products_columns.sql?raw';

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
