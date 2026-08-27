import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { openAppDatabase } from '../../src/main/db/database';
import type { RemoteProductIdentity } from '../../src/domain/product';
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
