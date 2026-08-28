import type { DatabaseSync } from 'node:sqlite';

import type {
  InfringementRepository,
  InfringementRun,
  InfringementRunInput,
} from '../../domain/infringement';
import type { InfringementDecision } from '../../shared/infringement-schema';

type InfringementRow = {
  id: string;
  product_id: string;
  fingerprint: string;
  version: number;
  level: InfringementRun['level'];
  kind: InfringementRun['kind'];
  decision_json: string;
  created_at: string;
};

function mapRow(row: InfringementRow): InfringementRun {
  return {
    id: row.id,
    productId: row.product_id,
    fingerprint: row.fingerprint,
    version: row.version,
    level: row.level,
    kind: row.kind,
    decision: JSON.parse(row.decision_json) as InfringementDecision,
    createdAt: row.created_at,
  };
}

export class SqliteInfringementRepository implements InfringementRepository {
  constructor(private readonly database: DatabaseSync) {}

  append(input: InfringementRunInput): InfringementRun {
    const last = this.lastRunForProduct(input.productId);
    const reuseVersion =
      last && last.fingerprint === input.fingerprint && !input.forceReanalyze;

    // Same fingerprint, not a forced re-analysis: the run already exists. Two
    // concurrent calls (e.g. a double-click on 批量检测 running analyzeBatch
    // twice) can both pass the service's fingerprint pre-check before either
    // appends, so this append must be idempotent — return the existing run
    // instead of INSERTing a duplicate (product_id, version) row and throwing
    // a UNIQUE constraint error.
    if (reuseVersion) return last!;

    const version =
      input.version ?? (last?.version ?? 0) + 1;

    const run: InfringementRun = {
      id: input.id,
      productId: input.productId,
      fingerprint: input.fingerprint,
      version,
      level: input.level,
      kind: input.kind,
      decision: input.decision,
      createdAt: input.createdAt,
    };

    this.database
      .prepare(
        `
          INSERT INTO infringement_runs (
            id, product_id, fingerprint, version, level, kind,
            decision_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        run.id,
        run.productId,
        run.fingerprint,
        run.version,
        run.level,
        run.kind,
        JSON.stringify(run.decision),
        run.createdAt,
      );

    return run;
  }

  listForProduct(productId: string): InfringementRun[] {
    const rows = this.database
      .prepare(
        `
          SELECT id, product_id, fingerprint, version, level, kind,
                 decision_json, created_at
          FROM infringement_runs
          WHERE product_id = ?
          ORDER BY rowid DESC
        `,
      )
      .all(productId)
      .map((row) => mapRow(row as InfringementRow));
    return rows;
  }

  currentForProduct(productId: string): InfringementRun | null {
    const row = this.database
      .prepare(
        `
          SELECT id, product_id, fingerprint, version, level, kind,
                 decision_json, created_at
          FROM infringement_runs
          WHERE product_id = ?
          ORDER BY rowid DESC
          LIMIT 1
        `,
      )
      .get(productId) as InfringementRow | undefined;
    return row ? mapRow(row) : null;
  }

  private lastRunForProduct(productId: string): InfringementRun | null {
    const row = this.database
      .prepare(
        `
          SELECT id, product_id, fingerprint, version, level, kind,
                 decision_json, created_at
          FROM infringement_runs
          WHERE product_id = ?
          ORDER BY rowid DESC
          LIMIT 1
        `,
      )
      .get(productId) as InfringementRow | undefined;
    return row ? mapRow(row) : null;
  }
}
