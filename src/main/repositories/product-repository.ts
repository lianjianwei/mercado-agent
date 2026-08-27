import type { DatabaseSync } from 'node:sqlite';

import type {
  Product,
  ProductPage,
  ProductPageQuery,
  ProductRepository,
  RemoteProductIdentity,
  TransactionRunner,
} from '../../domain/product';

type ProductRow = {
  id: string;
  state: Product['state'];
  title: string | null;
  item_number: string | null;
  thumbnail_url: string | null;
  last_synced_at: string;
  created_at: string;
  updated_at: string;
};

function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
    state: row.state,
    title: row.title,
    itemNumber: row.item_number,
    thumbnailUrl: row.thumbnail_url,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteProductRepository
  implements ProductRepository, TransactionRunner
{
  constructor(private readonly database: DatabaseSync) {}

  upsertRemoteIdentity(input: RemoteProductIdentity): Product {
    this.database
      .prepare(
        `
          INSERT INTO products (
            id, state, title, item_number, thumbnail_url,
            last_synced_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            state = excluded.state,
            title = excluded.title,
            item_number = excluded.item_number,
            thumbnail_url = excluded.thumbnail_url,
            last_synced_at = excluded.last_synced_at,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        input.id,
        input.state,
        input.title ?? null,
        input.itemNumber ?? null,
        input.thumbnailUrl ?? null,
        input.syncedAt,
        input.syncedAt,
        input.syncedAt,
      );

    return this.requireById(input.id);
  }

  transition(id: string, state: Product['state'], at: string): void {
    const result = this.database
      .prepare(
        `
          UPDATE products
          SET state = ?, last_synced_at = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(state, at, at, id);

    if (result.changes === 0) {
      throw new ProductNotFoundError(id);
    }
  }

  page(query: ProductPageQuery): ProductPage {
    const where = query.state === undefined ? '' : 'WHERE state = ?';
    const parameters =
      query.state === undefined
        ? [query.limit, query.offset]
        : [query.state, query.limit, query.offset];
    const countParameters = query.state === undefined ? [] : [query.state];
    const countRow = this.database
      .prepare(`SELECT COUNT(*) AS count FROM products ${where}`)
      .get(...countParameters) as { count: number };
    const rows = this.database
      .prepare(
        `
          SELECT id, state, title, item_number, thumbnail_url,
                 last_synced_at, created_at, updated_at
          FROM products
          ${where}
          ORDER BY created_at ASC, id ASC
          LIMIT ? OFFSET ?
        `,
      )
      .all(...parameters)
      .map((row) => mapProduct(row as ProductRow));

    return {
      items: rows,
      offset: query.offset,
      limit: query.limit,
      total: countRow.count,
    };
  }

  transaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  getById(id: string): Product {
    return this.requireById(id);
  }

  delete(id: string): void {
    // product_snapshots references products(id); delete snapshots first so the
    // foreign key is satisfied, then remove the product row itself.
    this.database
      .prepare('DELETE FROM product_snapshots WHERE product_id = ?')
      .run(id);
    this.database.prepare('DELETE FROM products WHERE id = ?').run(id);
  }

  private requireById(id: string): Product {
    const row = this.database
      .prepare(
        `
          SELECT id, state, title, item_number, thumbnail_url,
                 last_synced_at, created_at, updated_at
          FROM products
          WHERE id = ?
        `,
      )
      .get(id) as ProductRow | undefined;

    if (!row) throw new ProductNotFoundError(id);
    return mapProduct(row);
  }
}

export class ProductNotFoundError extends Error {
  constructor(id: string) {
    super(`Product not found: ${id}`);
    this.name = 'ProductNotFoundError';
  }
}
