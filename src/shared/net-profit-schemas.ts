import { z } from 'zod';

// Runtime validation for the net-profit config and cached fx rates as
// exchanged over IPC and stored in app_settings / fx_rates.

export const netProfitConfigSchema = z.strictObject({
  targetMargin: z.number().min(0).max(100),
  marginMode: z.enum(['income', 'price']),
  commission: z.strictObject({
    classic: z.number().min(0).max(100),
    premium: z.number().min(0).max(100),
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
