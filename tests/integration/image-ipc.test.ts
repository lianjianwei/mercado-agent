import { describe, expect, it, vi } from 'vitest';
import { registerImageHandlers } from '../../src/main/ipc/image-handlers';
import { IPC_CHANNELS, type IpcListener } from '../../src/shared/ipc-contract';
import type { AiImagesResult } from '../../src/domain/images';

describe('image generation IPC', () => {
  it('returns an AiImagesResult and propagates generator errors', async () => {
    const handlers = new Map<string, IpcListener>();
    const result: AiImagesResult = { version: 1, productId: 'p1', mainImages: [], detailImages: [], plan: [], status: 'done', createdAt: '2026-08-29T00:00:00.000Z' };
    const service = { generate: vi.fn(async () => result) };
    registerImageHandlers({ handle: (c, l) => handlers.set(c, l) }, { service });
    await expect(handlers.get(IPC_CHANNELS.imagesGenerate)?.({}, { productId: 'p1' })).resolves.toEqual({ ok: true, data: result });
    const failing = { generate: vi.fn(async () => { throw new Error('boom'); }) };
    const handlers2 = new Map<string, IpcListener>();
    registerImageHandlers({ handle: (c, l) => handlers2.set(c, l) }, { service: failing });
    await expect(handlers2.get(IPC_CHANNELS.imagesGenerate)?.({}, { productId: 'p1' })).resolves.toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
  });
});
