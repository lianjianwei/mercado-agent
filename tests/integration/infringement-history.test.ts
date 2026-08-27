import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { openAppDatabase } from '../../src/main/db/database';
import { SqliteInfringementRepository } from '../../src/main/repositories/infringement-repository';
import { SqliteProductRepository } from '../../src/main/repositories/product-repository';
import { InfringementService } from '../../src/main/services/infringement-service';
import type { InfringementDecision } from '../../src/shared/infringement-schema';
import {
  riskFingerprint,
  type RiskRelevantProduct,
} from '../../src/main/risk/fingerprint';

const temporaryDirectories: string[] = [];

function createDatabasePath(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'mercado-agent-risk-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'mercado-agent.sqlite3');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function decision(
  productInput: RiskRelevantProduct,
  overrides: Partial<InfringementDecision> = {},
): InfringementDecision {
  return {
    level: 'none',
    kind: 'unbranded',
    fingerprint: riskFingerprint(productInput),
    imagesIncluded: false,
    rules: [],
    summary: 'No risk detected.',
    evidence: [],
    ai: null,
    ...overrides,
  };
}

function product(overrides: Partial<RiskRelevantProduct> = {}): RiskRelevantProduct {
  return {
    title: 'Wireless charger for iPhone 15',
    description: 'Fast charging pad.',
    brand: 'Generic',
    category: 'Electronics',
    attributes: {},
    skuName: 'charger-black',
    imageUrls: [],
    ...overrides,
  };
}

function engineFor(level: InfringementDecision['level']) {
  return {
    analyze: vi.fn(async (p: RiskRelevantProduct) => decision(p, { level })),
  };
}

function seedProduct(database: ReturnType<typeof openAppDatabase>, id: string) {
  const products = new SqliteProductRepository(database);
  products.upsertRemoteIdentity({
    id,
    state: 'notPublished',
    title: 'Seed product',
    itemNumber: 'SEED-001',
    syncedAt: '2026-08-27T00:00:00.000Z',
  });
}

describe('infringement run history', () => {
  it('migrates the infringement_runs table exactly once', () => {
    const databasePath = createDatabasePath();
    const firstConnection = openAppDatabase(databasePath);

    const columns = firstConnection
      .prepare('PRAGMA table_info(infringement_runs)')
      .all()
      .map((row) => row.name);
    expect(columns).toEqual(
      expect.arrayContaining([
        'id',
        'product_id',
        'fingerprint',
        'version',
        'level',
        'kind',
        'decision_json',
        'created_at',
      ]),
    );
    firstConnection.close();

    const secondConnection = openAppDatabase(databasePath);
    expect(
      secondConnection
        .prepare('SELECT COUNT(*) AS count FROM schema_migrations')
        .get(),
    ).toEqual({ count: 3 });
  });

  it('assigns V1 then V2 when the risk fingerprint changes, preserving the old run', async () => {
    const database = openAppDatabase(createDatabasePath());
    const repository = new SqliteInfringementRepository(database);
    seedProduct(database, 'product-1');
    const engine = engineFor('none');
    const service = new InfringementService(repository, () => engine as never);

    const v1 = await service.analyzeProduct('product-1', product());
    const changedProduct = product({ title: 'Different wireless charger' });
    const v2 = await service.analyzeProduct('product-1', changedProduct);

    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    const runs = repository.listForProduct('product-1');
    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.version)).toEqual([2, 1]);
  });

  it('keeps the latest completed run as current for a product', async () => {
    const database = openAppDatabase(createDatabasePath());
    const repository = new SqliteInfringementRepository(database);
    seedProduct(database, 'product-1');
    const engine = engineFor('low');
    const service = new InfringementService(repository, () => engine as never);

    await service.analyzeProduct('product-1', product());
    const changed = await service.analyzeProduct(
      'product-1',
      product({ title: 'Updated title' }),
    );

    const current = repository.currentForProduct('product-1');
    expect(current?.id).toBe(changed.id);
    expect(current?.version).toBe(2);
  });

  it('does not create a new version when the fingerprint is unchanged', async () => {
    const database = openAppDatabase(createDatabasePath());
    const repository = new SqliteInfringementRepository(database);
    seedProduct(database, 'product-1');
    const engine = engineFor('none');
    const service = new InfringementService(repository, () => engine as never);

    const first = await service.analyzeProduct('product-1', product());
    const repeat = await service.analyzeProduct('product-1', product());

    expect(repeat.version).toBe(first.version);
    expect(repository.listForProduct('product-1')).toHaveLength(1);
  });

  it('keeps analyzing the rest of a batch when a single product fails', async () => {
    const database = openAppDatabase(createDatabasePath());
    const repository = new SqliteInfringementRepository(database);
    seedProduct(database, 'product-1');
    seedProduct(database, 'product-2');
    const engine = {
      analyze: vi
        .fn()
        .mockRejectedValueOnce(new Error('model timeout'))
        .mockImplementation(async (p: RiskRelevantProduct) =>
          decision(p, { level: 'medium' }),
        ),
    };
    const service = new InfringementService(repository, () => engine as never);

    const summary = await service.analyzeBatch(
      [
        { productId: 'product-1', product: product() },
        { productId: 'product-2', product: product({ title: 'Second' }) },
      ],
      new AbortController().signal,
    );

    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.failures[0]).toMatchObject({ productId: 'product-1' });
    expect(repository.currentForProduct('product-2')).not.toBeNull();
  });
});
