import type { DatabaseSync } from 'node:sqlite';

import type {
  LocalPublishState,
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
  breadcrumb: string | null;
  global_price: string | null;
  stock: string | null;
  sites: string | null;
  price: string | null;
  local_publish_state: LocalPublishState;
  local_published_at: string | null;
  last_synced_at: string;
  created_at: string;
  updated_at: string;
};

function parseSites(value: string | null): string[] {
  if (value === null) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((site): site is string => typeof site === 'string')
      : [];
  } catch {
    return [];
  }
}

function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
    state: row.state,
    title: row.title,
    itemNumber: row.item_number,
    thumbnailUrl: row.thumbnail_url,
    category: row.breadcrumb,
    netProfit: row.global_price,
    stock: row.stock,
    sites: parseSites(row.sites),
    sourcePrice: row.price,
    localPublishState: row.local_publish_state,
    localPublishedAt: row.local_published_at,
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
            breadcrumb, global_price, stock, sites, price,
            last_synced_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            state = excluded.state,
            title = excluded.title,
            item_number = excluded.item_number,
            thumbnail_url = excluded.thumbnail_url,
            breadcrumb = COALESCE(excluded.breadcrumb, products.breadcrumb),
            global_price = COALESCE(excluded.global_price, products.global_price),
            stock = COALESCE(excluded.stock, products.stock),
            sites = COALESCE(excluded.sites, products.sites),
            price = COALESCE(excluded.price, products.price),
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
        input.category ?? null,
        input.netProfit ?? null,
        input.stock ?? null,
        input.sites && input.sites.length > 0 ? JSON.stringify(input.sites) : null,
        input.sourcePrice ?? null,
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

  setLocalPublishState(
    id: string,
    state: LocalPublishState,
    at: string | null,
  ): void {
    const result = this.database
      .prepare(
        `
          UPDATE products
          SET local_publish_state = ?, local_published_at = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(state, at, at ?? new Date().toISOString(), id);

    if (result.changes === 0) {
      throw new ProductNotFoundError(id);
    }
  }

  page(query: ProductPageQuery): ProductPage {
    const clauses: string[] = [];
    const parameters: Array<string | number> = [];
    if (query.state !== undefined) {
      clauses.push('state = ?');
      parameters.push(query.state);
    }
    if (query.localPublishState !== undefined) {
      clauses.push('local_publish_state = ?');
      parameters.push(query.localPublishState);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const countParameters = [...parameters];
    const countRow = this.database
      .prepare(`SELECT COUNT(*) AS count FROM products ${where}`)
      .get(...countParameters) as { count: number };
    const rows = this.database
      .prepare(
        `
          SELECT id, state, title, item_number, thumbnail_url,
                 breadcrumb, global_price, stock, sites, price,
                 local_publish_state, local_published_at,
                 last_synced_at, created_at, updated_at
          FROM products
          ${where}
          ORDER BY created_at ASC, id ASC
          LIMIT ? OFFSET ?
        `,
      )
      .all(...parameters, query.limit, query.offset)
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

  clearAll(): void {
    // Delete child rows first so foreign keys are satisfied. Infringement runs
    // and snapshots reference products(id); product snapshots may also be
    // referenced by infringement decision evidence. Configuration tables
    // (credentials, provider configs, app settings) are intentionally kept.
    this.database.prepare('DELETE FROM infringement_runs').run();
    this.database.prepare('DELETE FROM product_snapshots').run();
    this.database.prepare('DELETE FROM products').run();
  }

  private requireById(id: string): Product {
    const row = this.database
      .prepare(
        `
          SELECT id, state, title, item_number, thumbnail_url,
                 breadcrumb, global_price, stock, sites, price,
                 local_publish_state, local_published_at,
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
