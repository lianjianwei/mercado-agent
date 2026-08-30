import { describe, expect, it, vi } from 'vitest';

import { compressPng } from '../../src/main/services/image-compressor';

// 1×1 透明 PNG,用于验证重压缩仍产出合法 PNG。必须在 vi.hoisted 内定义,
// 因为下面 vi.mock 的工厂会引用它。
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const { nativeImageMock, PNG } = vi.hoisted(() => {
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
    'base64',
  );
  let behavior = { empty: false, width: 1, height: 1, png: PNG } as {
    empty: boolean;
    width: number;
    height: number;
    png: Buffer;
  };
  return {
    PNG,
    nativeImageMock: {
      createFromBuffer: () => ({
        isEmpty: () => behavior.empty,
        getSize: () => ({ width: behavior.width, height: behavior.height }),
        toPNG: () => behavior.png,
        resize: () => ({ toPNG: () => behavior.png }),
      }),
      set: (over: Partial<typeof behavior>) => {
        behavior = { ...behavior, ...over };
      },
    },
  };
});

vi.mock('electron', () => ({ nativeImage: nativeImageMock }));

describe('compressPng', () => {
  it('recompresses a valid PNG and still returns a valid PNG buffer', () => {
    nativeImageMock.set({ empty: false, width: 4, height: 4, png: PNG });
    const out = compressPng(PNG);
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.length).toBeGreaterThan(0);
    expect(out.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  });

  it('returns the original buffer when nativeImage is empty', () => {
    nativeImageMock.set({ empty: true });
    const buf = Buffer.from('not-a-png');
    expect(compressPng(buf)).toBe(buf);
  });

  it('resizes down when the image exceeds maxEdge and still returns a buffer', () => {
    nativeImageMock.set({ empty: false, width: 2000, height: 1000, png: PNG });
    const out = compressPng(PNG, { maxEdge: 800 });
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  });
});
