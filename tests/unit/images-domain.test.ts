import { describe, expect, it } from 'vitest';
import type { ImageResult } from '../../src/domain/providers';
import type { GeneratedImage } from '../../src/domain/images';

describe('image domain types', () => {
  it('ImageResult carries optional base64 while keeping url', () => {
    const html: ImageResult = { url: '', dataBase64: 'aaaa' };
    expect(html.dataBase64).toBe('aaaa');
    const plain: ImageResult = { url: 'https://x/y.png' };
    expect(plain.dataBase64).toBeUndefined();
  });
  it('an AiImages bucket shape unifies main + detail images', () => {
    const image: GeneratedImage = {
      imageId: 'uuid', kind: 'main', skuKey: ';a;',
      localPath: '/tmp/a.png', plannedPath: 'mercado/p1/uuid.png',
      sourceRefImages: [], prompt: 'p', attempts: 1, status: 'ok', createdAt: '2026-08-29T00:00:00.000Z',
    };
    expect(image.kind).toBe('main');
  });
});
