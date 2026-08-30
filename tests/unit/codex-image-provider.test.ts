import { EventEmitter } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import { writeFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CodexImageProvider } from '../../src/main/providers/image/codex';

const PNG = Buffer.from('fake-png-bytes');

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock('electron', () => ({
  nativeImage: {
    createFromBuffer: () => ({
      getSize: () => ({ width: 1254, height: 1254 }),
      resize: () => ({ toPNG: () => PNG }),
    }),
  },
}));

vi.mock('node:child_process', () => ({ spawn: spawnMock }));

function fakeChild(dir: string) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { end: (s: string) => void };
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: () => void 0 };
  process.nextTick(() => {
    writeFileSync(path.join(dir, 'out.png'), PNG);
    child.emit('close', 0);
  });
  return child;
}

describe('CodexImageProvider', () => {
  let scratchDir: string;

  beforeEach(async () => {
    scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-test-'));
    spawnMock.mockImplementation((command: string, args: string[]) =>
      fakeChild(args[args.indexOf('-C') + 1] as string),
    );
  });

  afterEach(async () => {
    await fs.rm(scratchDir, { recursive: true, force: true });
    spawnMock.mockReset();
  });

  it('runs codex exec with proxy env and returns a resized PNG', async () => {
    const provider = new CodexImageProvider(
      { model: '', scratchDir, proxy: () => ({ enabled: true, host: '127.0.0.1', port: 7890, protocol: 'http' }) },
      async () => Buffer.from('ref'),
    );
    const [result] = await provider.generate({ prompt: '白底主图', referenceImageUrls: ['https://x/ref.png'] }, new AbortController().signal);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [, args, opts] = spawnMock.mock.calls[0] as unknown as [string, string[], { env: NodeJS.ProcessEnv }];
    expect(args).toEqual(
      expect.arrayContaining([
        'exec', '--ephemeral', '--skip-git-repo-check', '--approve-for-me',
        '-i', expect.stringMatching(/ref-.*\.png$/),
      ]),
    );
    expect(args).not.toContain('-m'); // 无 model 时不给 -m
    expect(opts.env.HTTPS_PROXY).toBe('http://127.0.0.1:7890');
    expect(result.dataBase64).toBe(PNG.toString('base64'));
  });

  it('omits proxy env when disabled, and passes -m when a model is set', async () => {
    const provider = new CodexImageProvider(
      { model: 'gpt-5', scratchDir, proxy: () => ({ enabled: false, host: '127.0.0.1', port: 7890 }) },
      async () => Buffer.from('ref'),
    );
    const [result] = await provider.generate({ prompt: 'p', referenceImageUrls: ['https://x/r.png'] }, new AbortController().signal);

    const [, args, opts] = spawnMock.mock.calls[0] as unknown as [string, string[], { env: NodeJS.ProcessEnv }];
    expect(args).toContain('-m');
    expect(args[args.indexOf('-m') + 1]).toBe('gpt-5');
    expect(opts.env.HTTPS_PROXY).toBeUndefined();
    expect(result.dataBase64).toBe(PNG.toString('base64'));
  });
});
