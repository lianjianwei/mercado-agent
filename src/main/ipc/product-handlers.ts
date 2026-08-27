import { z, ZodError } from 'zod';

import type { ProductSyncService } from '../services/product-sync-service';
import { IPC_CHANNELS, type IpcRegistrar } from '../../shared/ipc-contract';

const reconcileInputSchema = z.strictObject({
  productIds: z.array(z.string().min(1)).min(1),
});

export function registerProductHandlers(
  registrar: IpcRegistrar,
  service: Pick<ProductSyncService, 'syncDefault' | 'reconcileTracked'>,
): void {
  registrar.handle(IPC_CHANNELS.productSyncDefault, async () => {
    try {
      return { ok: true, data: await service.syncDefault() };
    } catch {
      return { ok: false, error: { code: 'INTERNAL_ERROR' as const, message: '商品同步未完成' } };
    }
  });
  registrar.handle(IPC_CHANNELS.productReconcileTracked, async (_event, payload) => {
    try {
      const input = reconcileInputSchema.parse(payload);
      return { ok: true, data: await service.reconcileTracked(input.productIds) };
    } catch (error) {
      if (error instanceof ZodError) {
        return { ok: false, error: { code: 'VALIDATION_ERROR' as const, message: '商品 ID 列表无效' } };
      }
      return { ok: false, error: { code: 'INTERNAL_ERROR' as const, message: '商品对账未完成' } };
    }
  });
}
