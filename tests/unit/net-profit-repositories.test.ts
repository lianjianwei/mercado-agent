import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { applyMigrations } from '../../src/main/db/migrator';
import { SqliteAppSettingsRepository } from '../../src/main/repositories/app-settings-repository';
import { SqliteFxRateRepository } from '../../src/main/repositories/fx-rate-repository';
import { DEFAULT_FX_RATES, DEFAULT_NET_PROFIT_CONFIG } from '../../src/domain/net-profit';

function openDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  applyMigrations(db);
  return db;
}

describe('net-profit config repository', () => {
  it('returns the default config before anything is saved', () => {
    const repo = new SqliteAppSettingsRepository(openDb());
    expect(repo.getNetProfitConfig()).toEqual(DEFAULT_NET_PROFIT_CONFIG);
  });

  it('round-trips a saved config', () => {
    const db = openDb();
    const repo = new SqliteAppSettingsRepository(db);
    const next = { ...DEFAULT_NET_PROFIT_CONFIG, targetMargin: 30, packingCost: 3 };
    repo.saveNetProfitConfig(next);
    expect(repo.getNetProfitConfig()).toEqual(next);
  });
});

describe('fx rate repository', () => {
  it('returns the default rates before anything is saved', () => {
    const repo = new SqliteFxRateRepository(openDb());
    expect(repo.getFxRates()).toEqual(DEFAULT_FX_RATES);
  });

  it('round-trips a saved snapshot', () => {
    const db = openDb();
    const repo = new SqliteFxRateRepository(db);
    const next = { ...DEFAULT_FX_RATES, cny: 7.3, updatedAt: '2026-08-29T00:00:00.000Z' };
    repo.saveFxRates(next);
    expect(repo.getFxRates()).toEqual(next);
  });
});
