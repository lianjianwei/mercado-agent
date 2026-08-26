import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { openAppDatabase } from '../../src/main/db/database';
import { SqliteAppSettingsRepository } from '../../src/main/repositories/app-settings-repository';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function harness() {
  const directory = mkdtempSync(path.join(tmpdir(), 'mercado-proxy-'));
  temporaryDirectories.push(directory);
  const databasePath = path.join(directory, 'mercado-agent.sqlite3');
  const database = openAppDatabase(databasePath);
  return {
    database,
    databasePath,
    repository: new SqliteAppSettingsRepository(database),
  };
}

describe('SqliteAppSettingsRepository', () => {
  it('returns a disabled configuration without inventing an address', () => {
    const { database, repository } = harness();
    expect(repository.getModelProxy()).toEqual({
      enabled: false,
      protocol: 'http',
      host: '',
      port: null,
    });
    database.close();
  });

  it('persists the model proxy after reopening the database', () => {
    const { database, databasePath, repository } = harness();
    repository.saveModelProxy({
      enabled: true,
      protocol: 'http',
      host: '127.0.0.1',
      port: 7890,
    });
    database.close();

    const reopened = openAppDatabase(databasePath);
    expect(new SqliteAppSettingsRepository(reopened).getModelProxy()).toEqual({
      enabled: true,
      protocol: 'http',
      host: '127.0.0.1',
      port: 7890,
    });
    reopened.close();
  });
});
