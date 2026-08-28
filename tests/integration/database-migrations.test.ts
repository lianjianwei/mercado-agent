import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  openAppDatabase,
  resolveDatabasePath,
} from '../../src/main/db/database';

const temporaryDirectories: string[] = [];

function createDatabasePath(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'mercado-agent-db-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'mercado-agent.sqlite3');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('database migrations', () => {
  it('stores the application database inside the Electron user data directory', () => {
    expect(resolveDatabasePath('/Users/test/Library/Application Support/app')).toBe(
      '/Users/test/Library/Application Support/app/mercado-agent.sqlite3',
    );
  });

  it('creates the initial schema once and preserves disk data on reopen', () => {
    const databasePath = createDatabasePath();
    const firstConnection = openAppDatabase(databasePath);

    const tableNames = firstConnection
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all()
      .map((row) => row.name);

    expect(tableNames).toEqual(
      expect.arrayContaining([
        'app_credentials',
        'app_settings',
        'provider_configs',
        'schema_migrations',
      ]),
    );

    firstConnection
      .prepare('INSERT INTO app_settings (key, value_json) VALUES (?, ?)')
      .run('locale', '"zh-CN"');
    firstConnection.close();

    const secondConnection = openAppDatabase(databasePath);
    expect(
      secondConnection
        .prepare('SELECT COUNT(*) AS count FROM schema_migrations')
        .get(),
    ).toEqual({ count: 5 });
    expect(
      secondConnection
        .prepare('SELECT value_json FROM app_settings WHERE key = ?')
        .get('locale'),
    ).toEqual({ value_json: '"zh-CN"' });
    secondConnection.close();
  });

  it('enables foreign key enforcement for every connection', () => {
    const connection = openAppDatabase(createDatabasePath());

    expect(connection.prepare('PRAGMA foreign_keys').get()).toEqual({
      foreign_keys: 1,
    });
    connection.close();
  });
});
