import { z } from 'zod';
import { IPC_CHANNELS, type IpcRegistrar } from '../../shared/ipc-contract';
import type { ImageGenerationService } from '../services/image-generation-service';

const productIdSchema = z.strictObject({ productId: z.string().min(1) });

export function registerImageHandlers(
  registrar: IpcRegistrar,
  deps: {
    service: Pick<ImageGenerationService, 'generate'>;
  },
): void {
  registrar.handle(IPC_CHANNELS.imagesGenerate, async (_event, payload) => {
    try {
      const { productId } = productIdSchema.parse(payload);
      // 详情/草稿由服务内部读取;缺详情时服务自身抛错,这里映射成内部错误。
      const data = await deps.service.generate(productId);
      return { ok: true, data };
    } catch (error) {
      if (error instanceof z.ZodError) return { ok: false, error: { code: 'VALIDATION_ERROR', message: '商品 ID 无效' } };
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : '图片生成失败' } };
    }
  });
}
