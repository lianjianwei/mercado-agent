import { z, ZodError } from 'zod';

import { IPC_CHANNELS, type IpcRegistrar } from '../../shared/ipc-contract';
import type { ProductRepository, ProductSnapshotRepository } from '../../domain/product';
import type { InfringementRepository } from '../../domain/infringement';
import type { InfringementService } from '../services/infringement-service';
import { riskRelevantProductFromDetail } from '../risk/risk-relevant-mapper';
import type { CollectBoxDetailDto } from '../../shared/miaoshou-schemas';

const productIdSchema = z.strictObject({ productId: z.string().min(1) });

const productIdsSchema = z.strictObject({
  productIds: z.array(z.string().min(1)).optional(),
});

type InfringementHandlerDependencies = {
  products: Pick<ProductRepository, 'page'>;
  snapshots: Pick<ProductSnapshotRepository, 'listForProduct'>;
  repository: Pick<InfringementRepository, 'listForProduct' | 'currentForProduct'>;
  service: Pick<InfringementService, 'analyzeProduct' | 'analyzeBatch'>;
  sendProgress?: (channel: string, line: string) => void;
};

export function registerInfringementHandlers(
  registrar: IpcRegistrar,
  dependencies: InfringementHandlerDependencies,
): void {
  registrar.handle(IPC_CHANNELS.infringementAnalyze, async (_event, payload) => {
    try {
      const { productId } = productIdSchema.parse(payload);
      const product = riskRelevantProductFor(productId, dependencies);
      const run = await dependencies.service.analyzeProduct(
        productId,
        product,
      );
      return { ok: true, data: run };
    } catch (error) {
      if (error instanceof ZodError) {
        return {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR' as const,
            message: '商品 ID 无效',
          },
        };
      }
      return {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR' as const,
          message: error instanceof Error ? error.message : '侵权检测未完成',
        },
      };
    }
  });

  registrar.handle(IPC_CHANNELS.infringementAnalyzeBatch, async (_event, payload) => {
    try {
      const { productIds } = productIdsSchema.parse(payload);
      const ids = productIds && productIds.length > 0 ? productIds : allProductIds(dependencies);
      if (ids.length === 0) {
        return { ok: true, data: { discovered: 0, succeeded: 0, failed: 0, failures: [] } };
      }
      const items = [];
      const skipped: Array<{ productId: string; message: string }> = [];
      for (const productId of ids) {
        try {
          const product = riskRelevantProductFor(productId, dependencies);
          items.push({ productId, product });
        } catch (error) {
          skipped.push({
            productId,
            message: error instanceof Error ? error.message : '无快照，跳过',
          });
        }
      }
      const summary = await dependencies.service.analyzeBatch(
        items,
        undefined,
        dependencies.sendProgress
          ? (line) => dependencies.sendProgress!(IPC_CHANNELS.infringementBatchLog, line)
          : undefined,
      );
      summary.discovered = ids.length;
      summary.failed += skipped.length;
      summary.failures = [...skipped, ...summary.failures];
      return { ok: true, data: summary };
    } catch (error) {
      if (error instanceof ZodError) {
        return {
          ok: false,
          error: { code: 'VALIDATION_ERROR' as const, message: '商品 ID 列表无效' },
        };
      }
      return {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR' as const,
          message: error instanceof Error ? error.message : '批量侵权检测未完成',
        },
      };
    }
  });

  registrar.handle(IPC_CHANNELS.infringementHistory, async (_event, payload) => {
    try {
      const { productId } = productIdSchema.parse(payload);
      return {
        ok: true,
        data: dependencies.repository.listForProduct(productId),
      };
    } catch (error) {
      if (error instanceof ZodError) {
        return {
          ok: false,
          error: { code: 'VALIDATION_ERROR' as const, message: '商品 ID 无效' },
        };
      }
      return {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR' as const,
          message: '检测历史读取失败',
        },
      };
    }
  });

  registrar.handle(IPC_CHANNELS.infringementCurrent, async (_event, payload) => {
    try {
      const { productId } = productIdSchema.parse(payload);
      return {
        ok: true,
        data: dependencies.repository.currentForProduct(productId),
      };
    } catch (error) {
      if (error instanceof ZodError) {
        return {
          ok: false,
          error: { code: 'VALIDATION_ERROR' as const, message: '商品 ID 无效' },
        };
      }
      return {
        ok: false,
        error: { code: 'INTERNAL_ERROR' as const, message: '当前检测结果读取失败' },
      };
    }
  });
}

function riskRelevantProductFor(
  productId: string,
  dependencies: InfringementHandlerDependencies,
) {
  const snapshots = dependencies.snapshots.listForProduct(productId);
  const latest = snapshots[snapshots.length - 1];
  if (!latest) {
    throw new Error('该商品尚无同步快照，无法检测。请先同步商品。');
  }
  const detail = latest.payload as CollectBoxDetailDto;
  return riskRelevantProductFromDetail(detail);
}

// An empty product id list means "detect every product", so the handler needs
// to enumerate the full local set before building the batch items.
function allProductIds(dependencies: InfringementHandlerDependencies): string[] {
  const ids: string[] = [];
  let offset = 0;
  const limit = 200;
  while (true) {
    const page = dependencies.products.page({ offset, limit });
    ids.push(...page.items.map((item) => item.id));
    if (offset + page.items.length >= page.total || page.items.length === 0) break;
    offset += page.items.length;
  }
  return ids;
}
