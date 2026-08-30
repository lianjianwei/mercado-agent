import { EventEmitter } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import { writeFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CodexImageProvider, codexAvailable } from '../../src/main/providers/image/codex';

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

function fakeChild(args: string[]) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { end: (s: string) => void };
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: () => void 0 };
  process.nextTick(() => {
    const cd = args.indexOf('-C');
    if (cd >= 0) writeFileSync(path.join(args[cd + 1], 'out.png'), PNG);
    child.emit('close', 0);
  });
  return child;
}

describe('CodexImageProvider', () => {
  let scratchDir: string;

  beforeEach(async () => {
    scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-test-'));
    spawnMock.mockImplementation((command: string, args: string[]) => fakeChild(args));
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

  it('generateBatch downloads refs once, runs codex once, and returns results aligned to requests', async () => {
    const provider = new CodexImageProvider(
      { model: '', scratchDir, proxy: () => null },
      async (url: string) => Buffer.from(`ref-${url}`),
    );
    // 让 codex 按 out-{i}.png 写出两张。
    spawnMock.mockImplementation((_command: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; stdin: { end: (s: string) => void } };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = { end: () => void 0 };
      process.nextTick(() => {
        const cd = args.indexOf('-C');
        const dir = args[cd + 1];
        writeFileSync(path.join(dir, 'out-1.png'), PNG);
        writeFileSync(path.join(dir, 'out-2.png'), PNG);
        child.emit('close', 0);
      });
      return child;
    });

    const results = await provider.generateBatch([
      { prompt: '主图1', referenceImageUrls: ['https://x/ref-a.png'] },
      { prompt: '主图2', referenceImageUrls: ['https://x/ref-a.png', 'https://x/ref-b.png'] },
    ], new AbortController().signal);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.dataBase64)).toEqual([PNG.toString('base64'), PNG.toString('base64')]);
    // 参考图只下载一次(ref-a 去重 + ref-b)→ 恰好 2 个 ref 文件。
    const [, args] = spawnMock.mock.calls[0] as unknown as [string, string[]];
    const refs = args.filter((a) => /ref-\d+\.png$/.test(String(a)));
    expect(refs).toHaveLength(2);
  });

  it('generateBatch returns an empty result for a missing output file', async () => {
    const provider = new CodexImageProvider(
      { model: '', scratchDir, proxy: () => null },
      async () => Buffer.from('ref'),
    );
    spawnMock.mockImplementation((_command: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; stdin: { end: (s: string) => void } };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = { end: () => void 0 };
      process.nextTick(() => {
        const cd = args.indexOf('-C');
        writeFileSync(path.join(args[cd + 1], 'out-1.png'), PNG); // 第二张缺失
        child.emit('close', 0);
      });
      return child;
    });

    const results = await provider.generateBatch([
      { prompt: 'a', referenceImageUrls: ['https://x/r.png'] },
      { prompt: 'b', referenceImageUrls: ['https://x/r.png'] },
    ], new AbortController().signal);

    expect(results[0].dataBase64).toBe(PNG.toString('base64'));
    expect(results[1]).toEqual({ url: '' });
  });

  it('codexAvailable detects the CLI and inherits process.env (PATH)', async () => {
    expect(await codexAvailable()).toBe(true);
    const [, args, opts] = spawnMock.mock.calls[0] as unknown as [string, string[], { env: NodeJS.ProcessEnv }];
    expect(args).toEqual(['--version']);
    // 必须继承 process.env,否则子进程无 PATH,找不到 codex。
    expect(opts.env.PATH).toBe(process.env.PATH);
  });
});
