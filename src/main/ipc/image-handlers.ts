import { z } from 'zod';
import { IPC_CHANNELS, type IpcRegistrar } from '../../shared/ipc-contract';
import type { ImageGenerationService } from '../services/image-generation-service';

const productIdSchema = z.strictObject({ productId: z.string().min(1) });

function parseProductId(payload: unknown): string {
  return productIdSchema.parse(payload).productId;
}

// 重生成选中图片:productId + targets(array of { imageId, hint? })。
const regenerateInputSchema = z.strictObject({
  productId: z.string().min(1),
  targets: z.array(z.strictObject({ imageId: z.string().min(1), hint: z.string().optional() })),
});

export function registerImageHandlers(
  registrar: IpcRegistrar,
  deps: {
    service: Pick<ImageGenerationService, 'generate' | 'getImages' | 'publishExisting' | 'regenerate'>;
  },
): void {
  registrar.handle(IPC_CHANNELS.imagesGenerate, async (_event, payload) => {
    try {
      const productId = parseProductId(payload);
      // 详情/草稿由服务内部读取;缺详情时服务自身抛错,这里映射成内部错误。
      const data = await deps.service.generate(productId);
      return { ok: true, data };
    } catch (error) {
      if (error instanceof z.ZodError) return { ok: false, error: { code: 'VALIDATION_ERROR', message: '商品 ID 无效' } };
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : '图片生成失败' } };
    }
  });

  registrar.handle(IPC_CHANNELS.imagesGet, async (_event, payload) => {
    try {
      const productId = parseProductId(payload);
      return { ok: true, data: deps.service.getImages(productId) };
    } catch (error) {
      if (error instanceof z.ZodError) return { ok: false, error: { code: 'VALIDATION_ERROR', message: '商品 ID 无效' } };
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: '图片读取失败' } };
    }
  });

  registrar.handle(IPC_CHANNELS.imagesUpload, async (_event, payload) => {
    try {
      const productId = parseProductId(payload);
      const data = await deps.service.publishExisting(productId);
      return { ok: true, data };
    } catch (error) {
      if (error instanceof z.ZodError) return { ok: false, error: { code: 'VALIDATION_ERROR', message: '商品 ID 无效' } };
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : '已有图片上传失败' } };
    }
  });

  registrar.handle(IPC_CHANNELS.imagesRegenerate, async (_event, payload) => {
    try {
      const { productId, targets } = regenerateInputSchema.parse(payload);
      const data = await deps.service.regenerate(productId, targets);
      return { ok: true, data };
    } catch (error) {
      if (error instanceof z.ZodError) return { ok: false, error: { code: 'VALIDATION_ERROR', message: '重生成参数无效' } };
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : '图片重生成失败' } };
    }
  });
}
