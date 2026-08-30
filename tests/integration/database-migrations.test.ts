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
    ).toEqual({ count: 9 });
    expect(
      secondConnection
        .prepare('SELECT value_json FROM app_settings WHERE key = ?')
        .get('locale'),
    ).toEqual({ value_json: '"zh-CN"' });
    secondConnection.close();
  });

  it('accepts an aiImages snapshot kind (the CHECK constraint was widened)', () => {
    const connection = openAppDatabase(createDatabasePath());
    connection
      .prepare(
        "INSERT INTO products (id, state, last_synced_at, created_at, updated_at, local_publish_state) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run('p1', 'notPublished', '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z', 'notPublished');
    connection
      .prepare(
        'INSERT INTO product_snapshots (id, product_id, kind, captured_at, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        'p1:aiImages:1',
        'p1',
        'aiImages',
        '2026-08-30T00:00:00.000Z',
        JSON.stringify({ version: 1, productId: 'p1', mainImages: [], detailImages: [], plan: [], status: 'done', createdAt: '2026-08-30T00:00:00.000Z' }),
        '2026-08-30T00:00:00.000Z',
      );
    const row = connection
      .prepare("SELECT kind FROM product_snapshots WHERE id = ?")
      .get('p1:aiImages:1');
    expect(row).toEqual({ kind: 'aiImages' });
    connection.close();
  });

  it('enables foreign key enforcement for every connection', () => {
    const connection = openAppDatabase(createDatabasePath());

    expect(connection.prepare('PRAGMA foreign_keys').get()).toEqual({
      foreign_keys: 1,
    });
    connection.close();
  });
});
