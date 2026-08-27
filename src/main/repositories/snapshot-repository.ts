import type { DatabaseSync } from 'node:sqlite';

import type {
  ProductSnapshot,
  ProductSnapshotInput,
  ProductSnapshotKind,
  ProductSnapshotRepository,
} from '../../domain/product';

type ProductSnapshotRow = {
  id: string;
  product_id: string;
  kind: ProductSnapshotKind;
  captured_at: string;
  payload_json: string;
};

function mapSnapshot(row: ProductSnapshotRow): ProductSnapshot {
  return {
    id: row.id,
    productId: row.product_id,
    kind: row.kind,
    capturedAt: row.captured_at,
    payload: JSON.parse(row.payload_json),
  };
}

export class SqliteSnapshotRepository implements ProductSnapshotRepository {
  constructor(private readonly database: DatabaseSync) {}

  append(snapshot: ProductSnapshotInput): void {
    const payloadJson = JSON.stringify(snapshot.payload);
    if (payloadJson === undefined) {
      throw new TypeError('Product snapshot payload must be JSON serializable');
    }

    this.database
      .prepare(
        `
          INSERT INTO product_snapshots (
            id, product_id, kind, captured_at, payload_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        snapshot.id,
        snapshot.productId,
        snapshot.kind,
        snapshot.capturedAt,
        payloadJson,
        snapshot.capturedAt,
      );
  }

  listForProduct(productId: string): ProductSnapshot[] {
    return this.database
      .prepare(
        `
          SELECT id, product_id, kind, captured_at, payload_json
          FROM product_snapshots
          WHERE product_id = ?
          ORDER BY captured_at ASC, id ASC
        `,
      )
      .all(productId)
      .map((row) => mapSnapshot(row as ProductSnapshotRow));
  }
}
