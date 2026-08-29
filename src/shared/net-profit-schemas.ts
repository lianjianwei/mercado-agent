import { z } from 'zod';

// Runtime validation for the net-profit config and cached fx rates as
// exchanged over IPC and stored in app_settings / fx_rates.

export const netProfitConfigSchema = z.strictObject({
  // targetMargin and commission must stay strictly below 100: the engine
  // divides by (1 - target) / (1 - commission), so 100% would divide by zero
  // (Infinity / NaN income and price). The same schema guards modal save,
  // persistence, and IPC, so this is the single choke point.
  targetMargin: z.number().min(0).lt(100),
  marginMode: z.enum(['income', 'price']),
  commission: z.strictObject({
    classic: z.number().min(0).lt(100),
    premium: z.number().min(0).lt(100),
  }),
  packingCost: z.number().min(0),
});

export const fxRatesSchema = z.strictObject({
  cny: z.number().positive(),
  mxn: z.number().positive(),
  brl: z.number().positive(),
  ars: z.number().positive(),
  updatedAt: z.string(),
});

export type NetProfitConfig = z.infer<typeof netProfitConfigSchema>;
export type FxRates = z.infer<typeof fxRatesSchema>;
