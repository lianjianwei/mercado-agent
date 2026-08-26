import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { applyMigrations } from './migrator';

export function resolveDatabasePath(userDataPath: string): string {
  return path.join(userDataPath, 'mercado-agent.sqlite3');
}

export function openAppDatabase(databasePath: string): DatabaseSync {
  mkdirSync(path.dirname(databasePath), { recursive: true });

  const database = new DatabaseSync(databasePath, {
    enableForeignKeyConstraints: true,
    timeout: 5_000,
  });

  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA journal_mode = WAL');
  applyMigrations(database);

  return database;
}
