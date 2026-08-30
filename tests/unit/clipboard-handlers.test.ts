import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readFileSync, clipboard, nativeImage } = vi.hoisted(() => {
  const readFileSync = vi.fn();
  const clipboard = { write: vi.fn(async () => undefined), writeText: vi.fn(async () => undefined) };
  const nativeImage = {
    createFromBuffer: vi.fn((buffer: Buffer) => ({
      isEmpty: () => false,
      toPNG: () => (buffer.length > 0 ? Buffer.from(buffer) : Buffer.from('png')),
    })),
  };
  return { readFileSync, clipboard, nativeImage };
});

vi.mock('node:fs', () => ({ readFileSync: (...args: unknown[]) => readFileSync(...args) }));
vi.mock('electron', () => ({
  clipboard,
  ClipboardItem: class ClipboardItem {
    constructor(readonly items: Record<string, unknown>) {}
  },
  nativeImage,
}));

import { registerClipboardHandlers } from '../../src/main/ipc/clipboard-handlers';

type Handler = (event: unknown, payload: unknown) => Promise<{ ok: boolean; data?: undefined; error?: { code: string; message: string } }>;

function handlersOf(): Record<string, Handler> {
  const table: Record<string, Handler> = {};
  registerClipboardHandlers({ handle: (channel, listener) => { table[channel] = listener as Handler; } });
  return table;
}

beforeEach(() => {
  readFileSync.mockReset();
  clipboard.write.mockClear();
  clipboard.writeText.mockClear();
});

describe('registerClipboardHandlers', () => {
  it('copies a local image file to the clipboard', async () => {
    readFileSync.mockReturnValue(Buffer.from('png-data'));
    const handlers = handlersOf();
    const result = await handlers['clipboard:image'](null, { src: '/tmp/x.png' });
    expect(result.ok).toBe(true);
    expect(clipboard.write).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty image source as a validation error', async () => {
    const handlers = handlersOf();
    const result = await handlers['clipboard:image'](null, { src: '' });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  it('copies text (image address) to the clipboard', async () => {
    const handlers = handlersOf();
    const result = await handlers['clipboard:text'](null, { text: 'https://img.test/x.png' });
    expect(result.ok).toBe(true);
    expect(clipboard.writeText).toHaveBeenCalledWith('https://img.test/x.png');
  });
});
