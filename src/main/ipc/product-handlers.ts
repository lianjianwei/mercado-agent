import { z, ZodError } from 'zod';

import type { ProductSyncService } from '../services/product-sync-service';
import { IPC_CHANNELS, type IpcRegistrar } from '../../shared/ipc-contract';
import type { ProductRepository } from '../../domain/product';

const reconcileInputSchema = z.strictObject({
  productIds: z.array(z.string().min(1)).min(1),
});

const productStateSchema = z.enum([
  'notPublished',
  'timingPublish',
  'published',
  'missing',
]);

const pageInputSchema = z.strictObject({
  state: productStateSchema.optional(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive().max(100),
});

type ProductHandlerDependencies = {
  products: Pick<ProductRepository, 'page'>;
  sync?: Pick<ProductSyncService, 'syncDefault' | 'reconcileTracked'>;
};

export function registerProductHandlers(
  registrar: IpcRegistrar,
  dependencies: ProductHandlerDependencies,
): void {
  registrar.handle(IPC_CHANNELS.productPage, async (_event, payload) => {
    try {
      const input = pageInputSchema.parse(payload);
      return { ok: true, data: dependencies.products.page(input) };
    } catch (error) {
      if (error instanceof ZodError) {
        return { ok: false, error: { code: 'VALIDATION_ERROR' as const, message: '商品分页参数无效' } };
      }
      return { ok: false, error: { code: 'INTERNAL_ERROR' as const, message: '商品列表读取失败' } };
    }
  });
  registrar.handle(IPC_CHANNELS.productSyncDefault, async () => {
    try {
      if (!dependencies.sync) throw new Error('Product sync service is not configured');
      return { ok: true, data: await dependencies.sync.syncDefault() };
    } catch {
      return { ok: false, error: { code: 'INTERNAL_ERROR' as const, message: '商品同步未完成' } };
    }
  });
  registrar.handle(IPC_CHANNELS.productReconcileTracked, async (_event, payload) => {
    try {
      const input = reconcileInputSchema.parse(payload);
      if (!dependencies.sync) throw new Error('Product sync service is not configured');
      return { ok: true, data: await dependencies.sync.reconcileTracked(input.productIds) };
    } catch (error) {
      if (error instanceof ZodError) {
        return { ok: false, error: { code: 'VALIDATION_ERROR' as const, message: '商品 ID 列表无效' } };
      }
      return { ok: false, error: { code: 'INTERNAL_ERROR' as const, message: '商品对账未完成' } };
    }
  });
}
