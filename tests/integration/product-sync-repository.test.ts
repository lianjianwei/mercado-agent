import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { openAppDatabase } from '../../src/main/db/database';
import type { RemoteProductIdentity } from '../../src/domain/product';
import { SqliteInfringementRepository } from '../../src/main/repositories/infringement-repository';
import { SqliteProductRepository } from '../../src/main/repositories/product-repository';
import { SqliteSnapshotRepository } from '../../src/main/repositories/snapshot-repository';

const temporaryDirectories: string[] = [];

function createDatabasePath(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'mercado-agent-products-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'mercado-agent.sqlite3');
}

function remoteProduct(
  overrides: Partial<RemoteProductIdentity> = {},
): RemoteProductIdentity {
  return {
    id: 'collect-box-101',
    state: 'notPublished',
    title: 'Wireless mouse',
    itemNumber: 'MOUSE-101',
    thumbnailUrl: 'https://images.example.test/mouse.jpg',
    syncedAt: '2026-08-27T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('product synchronization repositories', () => {
  it('migrates strict product and immutable snapshot tables on disk exactly once', () => {
    const databasePath = createDatabasePath();
    const firstConnection = openAppDatabase(databasePath);

    expect(
      firstConnection
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('products', 'product_snapshots') ORDER BY name",
        )
        .all()
        .map((row) => row.name),
    ).toEqual(['product_snapshots', 'products']);
    expect(
      firstConnection
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get('products'),
    ).toEqual(expect.objectContaining({ sql: expect.stringContaining('STRICT') }));
    firstConnection.close();

    const secondConnection = openAppDatabase(databasePath);
    expect(
      secondConnection
        .prepare('SELECT version, name FROM schema_migrations ORDER BY version')
        .all(),
    ).toEqual([
      { version: 1, name: 'initial' },
      { version: 2, name: 'products' },
      { version: 3, name: 'infringement' },
      { version: 4, name: 'products_columns' },
      { version: 5, name: 'local_publish_state' },
      { version: 6, name: 'fx_rates' },
      { version: 7, name: 'ai_images_kind' },
    ]);
    secondConnection.close();
  });

  it('tracks remote lifecycle transitions without deleting a product when it becomes missing', () => {
    const database = openAppDatabase(createDatabasePath());
    const repository = new SqliteProductRepository(database);

    expect(repository.upsertRemoteIdentity(remoteProduct())).toMatchObject({
      id: 'collect-box-101',
      state: 'notPublished',
      lastSyncedAt: '2026-08-27T00:00:00.000Z',
    });

    repository.transition(
      'collect-box-101',
      'timingPublish',
      '2026-08-27T01:00:00.000Z',
    );
    repository.transition(
      'collect-box-101',
      'published',
      '2026-08-27T02:00:00.000Z',
    );
    repository.transition(
      'collect-box-101',
      'missing',
      '2026-08-27T03:00:00.000Z',
    );

    expect(repository.page({ offset: 0, limit: 20 })).toEqual({
      items: [
        expect.objectContaining({
          id: 'collect-box-101',
          state: 'missing',
          lastSyncedAt: '2026-08-27T03:00:00.000Z',
        }),
      ],
      offset: 0,
      limit: 20,
      total: 1,
    });
    database.close();
  });

  it('restores a missing product when it reappears remotely and refreshes its identity', () => {
    const database = openAppDatabase(createDatabasePath());
    const repository = new SqliteProductRepository(database);
    repository.upsertRemoteIdentity(remoteProduct());
    repository.transition(
      'collect-box-101',
      'missing',
      '2026-08-27T01:00:00.000Z',
    );

    expect(
      repository.upsertRemoteIdentity(
        remoteProduct({
          state: 'published',
          title: 'Wireless mouse (published)',
          syncedAt: '2026-08-27T02:00:00.000Z',
        }),
      ),
    ).toMatchObject({
      id: 'collect-box-101',
      state: 'published',
      title: 'Wireless mouse (published)',
      lastSyncedAt: '2026-08-27T02:00:00.000Z',
    });
    database.close();
  });

  it('persists category, net profit, stock, sites and source price from the list DTO', () => {
    const database = openAppDatabase(createDatabasePath());
    const repository = new SqliteProductRepository(database);

    repository.upsertRemoteIdentity(
      remoteProduct({
        category: '厨房用具 / 咖啡机',
        netProfit: '52.40',
        stock: '86',
        sites: ['BR', 'MX'],
        sourcePrice: '18.9',
      }),
    );

    expect(repository.getById('collect-box-101')).toMatchObject({
      category: '厨房用具 / 咖啡机',
      netProfit: '52.40',
      stock: '86',
      sites: ['BR', 'MX'],
      sourcePrice: '18.9',
    });
    database.close();
  });

  it('persists the local publish state and timestamp on the product row', () => {
    const database = openAppDatabase(createDatabasePath());
    const repository = new SqliteProductRepository(database);

    repository.upsertRemoteIdentity(remoteProduct());

    expect(repository.getById('collect-box-101')).toMatchObject({
      localPublishState: 'notPublished',
      localPublishedAt: null,
    });

    repository.setLocalPublishState(
      'collect-box-101',
      'localPublished',
      '2026-08-27T03:00:00.000Z',
    );

    expect(repository.getById('collect-box-101')).toMatchObject({
      localPublishState: 'localPublished',
      localPublishedAt: '2026-08-27T03:00:00.000Z',
    });
    database.close();
  });

  it('filters product pages by the local publish state', () => {
    const database = openAppDatabase(createDatabasePath());
    const repository = new SqliteProductRepository(database);
    repository.upsertRemoteIdentity(remoteProduct());
    repository.upsertRemoteIdentity(
      remoteProduct({
        id: 'collect-box-102',
        title: 'Keyboard',
        itemNumber: 'KEYBOARD-102',
        syncedAt: '2026-08-27T00:01:00.000Z',
      }),
    );
    repository.setLocalPublishState(
      'collect-box-102',
      'localPublished',
      '2026-08-27T00:02:00.000Z',
    );

    expect(
      repository.page({
        localPublishState: 'localPublished',
        offset: 0,
        limit: 20,
      }),
    ).toMatchObject({
      total: 1,
      items: [expect.objectContaining({ id: 'collect-box-102' })],
    });
    expect(
      repository.page({ localPublishState: 'notPublished', offset: 0, limit: 20 }),
    ).toMatchObject({
      total: 1,
      items: [expect.objectContaining({ id: 'collect-box-101' })],
    });
    database.close();
  });

  it('clears products, snapshots and infringement runs, keeping configuration', () => {
    const database = openAppDatabase(createDatabasePath());
    const products = new SqliteProductRepository(database);
    const snapshots = new SqliteSnapshotRepository(database);
    const infringements = new SqliteInfringementRepository(database);
    products.upsertRemoteIdentity(remoteProduct());
    snapshots.append({
      id: 'snapshot-001',
      productId: 'collect-box-101',
      kind: 'miaoshou',
      capturedAt: '2026-08-27T01:00:00.000Z',
      payload: { title: 'Wireless mouse' },
    });
    infringements.append({
      id: 'run-1',
      productId: 'collect-box-101',
      fingerprint: 'a'.repeat(64),
      version: 1,
      level: 'high',
      kind: 'brand_owner',
      decision: {
        level: 'high',
        kind: 'brand_owner',
        fingerprint: 'a'.repeat(64),
        imagesIncluded: true,
        rules: [],
        summary: 'high',
        evidence: [],
        ai: null,
      },
      createdAt: '2026-08-27T02:00:00.000Z',
    });

    products.clearAll();

    expect(products.page({ offset: 0, limit: 20 })).toEqual({
      items: [],
      offset: 0,
      limit: 20,
      total: 0,
    });
    expect(snapshots.listForProduct('collect-box-101')).toEqual([]);
    expect(infringements.listForProduct('collect-box-101')).toEqual([]);
    database.close();
  });

  it('keeps list columns when a detail-driven sync passes null for them', () => {
    const database = openAppDatabase(createDatabasePath());
    const repository = new SqliteProductRepository(database);

    repository.upsertRemoteIdentity(
      remoteProduct({
        category: '厨房用具',
        netProfit: '52.40',
        stock: '86',
        sites: ['BR'],
        sourcePrice: '18.9',
      }),
    );
    // syncOne sends null for the list-only fields; COALESCE must keep the old values.
    repository.upsertRemoteIdentity(
      remoteProduct({
        title: 'Updated title',
        category: null,
        netProfit: null,
        stock: null,
        sites: null,
        sourcePrice: null,
      }),
    );

    expect(repository.getById('collect-box-101')).toMatchObject({
      title: 'Updated title',
      category: '厨房用具',
      netProfit: '52.40',
      stock: '86',
      sites: ['BR'],
      sourcePrice: '18.9',
    });
    database.close();
  });

  it('appends immutable snapshots and preserves history while product pages are filtered', () => {
    const database = openAppDatabase(createDatabasePath());
    const products = new SqliteProductRepository(database);
    const snapshots = new SqliteSnapshotRepository(database);
    products.upsertRemoteIdentity(remoteProduct());
    products.upsertRemoteIdentity(
      remoteProduct({
        id: 'collect-box-102',
        title: 'Keyboard',
        itemNumber: 'KEYBOARD-102',
        syncedAt: '2026-08-27T00:01:00.000Z',
      }),
    );
    products.transition(
      'collect-box-102',
      'published',
      '2026-08-27T00:02:00.000Z',
    );

    snapshots.append({
      id: 'snapshot-001',
      productId: 'collect-box-101',
      kind: 'miaoshou',
      capturedAt: '2026-08-27T01:00:00.000Z',
      payload: { title: 'Wireless mouse', stock: 12 },
    });
    snapshots.append({
      id: 'snapshot-002',
      productId: 'collect-box-101',
      kind: 'miaoshou',
      capturedAt: '2026-08-27T02:00:00.000Z',
      payload: { title: 'Wireless mouse', stock: 8 },
    });

    expect(snapshots.listForProduct('collect-box-101')).toEqual([
      {
        id: 'snapshot-001',
        productId: 'collect-box-101',
        kind: 'miaoshou',
        capturedAt: '2026-08-27T01:00:00.000Z',
        payload: { title: 'Wireless mouse', stock: 12 },
      },
      {
        id: 'snapshot-002',
        productId: 'collect-box-101',
        kind: 'miaoshou',
        capturedAt: '2026-08-27T02:00:00.000Z',
        payload: { title: 'Wireless mouse', stock: 8 },
      },
    ]);
    expect(() =>
      snapshots.append({
        id: 'snapshot-001',
        productId: 'collect-box-101',
        kind: 'miaoshou',
        capturedAt: '2026-08-27T03:00:00.000Z',
        payload: { title: 'attempted overwrite' },
      }),
    ).toThrow();
    expect(snapshots.listForProduct('collect-box-101')).toHaveLength(2);
    expect(repositoryPage(products, 'notPublished')).toMatchObject({
      total: 1,
      items: [expect.objectContaining({ id: 'collect-box-101' })],
    });
    expect(products.page({ offset: 0, limit: 1 })).toMatchObject({
      total: 2,
      items: [expect.objectContaining({ id: 'collect-box-101' })],
    });
    expect(snapshots.listForProduct('collect-box-101')).toHaveLength(2);
    database.close();
  });

  it('uses bound values for state filters and leaves existing rows intact for hostile input', () => {
    const database = openAppDatabase(createDatabasePath());
    const repository = new SqliteProductRepository(database);
    repository.upsertRemoteIdentity(remoteProduct());

    expect(
      repository.page({
        state: "notPublished' OR 1 = 1 --" as never,
        offset: 0,
        limit: 20,
      }),
    ).toEqual({ items: [], offset: 0, limit: 20, total: 0 });
    expect(repository.page({ offset: 0, limit: 20 }).total).toBe(1);
    database.close();
  });

  it('provides an application-service transaction boundary for product and snapshot writes', () => {
    const database = openAppDatabase(createDatabasePath());
    const products = new SqliteProductRepository(database);
    const snapshots = new SqliteSnapshotRepository(database);

    expect(() =>
      products.transaction(() => {
        products.upsertRemoteIdentity(remoteProduct());
        snapshots.append({
          id: 'snapshot-rollback',
          productId: 'collect-box-101',
          kind: 'miaoshou',
          capturedAt: '2026-08-27T01:00:00.000Z',
          payload: { title: 'Wireless mouse' },
        });
        throw new Error('abort synchronization');
      }),
    ).toThrow('abort synchronization');
    expect(products.page({ offset: 0, limit: 20 })).toEqual({
      items: [],
      offset: 0,
      limit: 20,
      total: 0,
    });
    expect(snapshots.listForProduct('collect-box-101')).toEqual([]);
    database.close();
  });
});

function repositoryPage(repository: SqliteProductRepository, state: 'notPublished') {
  return repository.page({ state, offset: 0, limit: 20 });
}
