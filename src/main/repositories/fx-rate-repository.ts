import type { DatabaseSync } from 'node:sqlite';

import {
  DEFAULT_FX_RATES,
  type FxRateRepository,
  type FxRates,
} from '../../domain/net-profit';
import { fxRatesSchema } from '../../shared/net-profit-schemas';

export class SqliteFxRateRepository implements FxRateRepository {
  constructor(private readonly database: DatabaseSync) {}

  getFxRates(): FxRates {
    const row = this.database
      .prepare('SELECT value_json FROM fx_rates WHERE key = ?')
      .get('rates') as { value_json: string } | undefined;
    if (!row) return { ...DEFAULT_FX_RATES };
    return fxRatesSchema.parse(JSON.parse(row.value_json));
  }

  saveFxRates(value: FxRates): void {
    const normalized = fxRatesSchema.parse(value);
    this.database
      .prepare(
        `
          INSERT INTO fx_rates (key, value_json)
          VALUES ('rates', ?)
          ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
        `,
      )
      .run(JSON.stringify(normalized));
  }
}
