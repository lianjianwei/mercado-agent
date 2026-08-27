import { z, ZodError } from 'zod';

import { IPC_CHANNELS, type IpcRegistrar } from '../../shared/ipc-contract';
import type { ProductSnapshotRepository } from '../../domain/product';
import type { InfringementRepository } from '../../domain/infringement';
import type { InfringementService } from '../services/infringement-service';
import { riskRelevantProductFromDetail } from '../risk/risk-relevant-mapper';
import type { CollectBoxDetailDto } from '../../shared/miaoshou-schemas';

const productIdSchema = z.strictObject({ productId: z.string().min(1) });

type InfringementHandlerDependencies = {
  snapshots: ProductSnapshotRepository;
  repository: InfringementRepository;
  service: InfringementService;
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
