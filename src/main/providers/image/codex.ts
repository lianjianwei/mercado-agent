// 本地 codex 生图 provider:调用本机 `codex exec`,让 agent 用内置图片编辑器
// 基于参考图生成/编辑出图并写到指定文件,再由我们缩放到 800×800 并回传 base64。
// 无需 baseUrl/apiKey(走本机 codex 登录);代理按配置,配置启用模型代理时给 codex 走代理。

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { nativeImage, type NativeImage } from 'electron';

import type {
  ConnectionResult,
  ImageGenerationRequest,
  ImageModelProvider,
  ImageResult,
} from '../../../domain/providers';
import { ProviderUnavailableError } from '../../../domain/providers';

export type CodexProxyConfig = { enabled: boolean; host: string; port: number | null; protocol?: string };
export type CodexImageConfig = {
  model: string; // 空字符串 → 用 codex 默认
  scratchDir: string; // agent 工作目录 + 输出临时目录
  proxy: () => CodexProxyConfig | null; // 模型代理配置(合并到 codex env)
};

type Download = (url: string, signal: AbortSignal) => Promise<Buffer>;

const TARGET_SIZE = 800;

// 缩放:保持宽高比,长边不超过 TARGET_SIZE(不拉伸)。
function fitWithin(img: NativeImage, max: number): NativeImage {
  const { width, height } = img.getSize();
  const scale = Math.min(1, max / Math.max(width, height, 1));
  if (scale >= 1) return img;
  return img.resize({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  });
}

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  stdin: string,
  signal: AbortSignal,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.on('error', (error) => reject(error));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
    signal.addEventListener('abort', () => child.kill('SIGTERM'), { once: true });
  });
}

export class CodexImageProvider implements ImageModelProvider {
  constructor(
    private readonly configuration: CodexImageConfig,
    private readonly download: Download,
  ) {}

  async testConnection(signal: AbortSignal): Promise<ConnectionResult> {
    try {
      const { code } = await run('codex', ['--version'], this.proxyEnv(), '', signal);
      if (code !== 0) throw new ProviderUnavailableError('codex 不可用。');
      return {
        ok: true,
        status: 'success',
        message: '本地 codex 可用。',
        latencyMs: 0,
        route: this.configuration.proxy()?.enabled ? 'http_proxy' : 'direct',
      };
    } catch (error) {
      if (error instanceof ProviderUnavailableError) throw error;
      throw new ProviderUnavailableError('codex 不可用,请确认已安装并登录。');
    }
  }

  async generate(
    request: ImageGenerationRequest,
    signal: AbortSignal,
  ): Promise<ImageResult[]> {
    const dir = await fs.mkdtemp(path.join(this.configuration.scratchDir, 'codex-'));
    try {
      const refFiles: string[] = [];
      for (const url of request.referenceImageUrls ?? []) {
        const bytes = await this.download(url, signal);
        const file = path.join(dir, `ref-${randomUUID()}.png`);
        await fs.writeFile(file, bytes);
        refFiles.push(file);
      }

      const out = path.join(dir, 'out.png');
      const args = ['exec', '--ephemeral', '--skip-git-repo-check', '-C', dir, '--approve-for-me'];
      for (const file of refFiles) args.push('-i', file);
      if (this.configuration.model) args.push('-m', this.configuration.model);

      const prompt = `${request.prompt}\n把最终生成的图片保存为 ${out}(尺寸 ${TARGET_SIZE}×${TARGET_SIZE} 左右)。`;
      const { code, stderr } = await run('codex', args, this.proxyEnv(), prompt, signal);
      if (code !== 0) {
        throw new ProviderUnavailableError(`codex 生图失败:${stderr.trim() || `exit ${code}`}`);
      }

      const buf = await fs.readFile(out);
      const resized = fitWithin(nativeImage.createFromBuffer(buf), TARGET_SIZE);
      return [{ url: '', dataBase64: resized.toPNG().toString('base64') }];
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // 一次 codex 调用批量产出多张图:参考图只下载一份,codex 把每张写到对应
  // out-{i}.png。返回与 requests 对齐的结果;某张没生成出来则给空结果,
  // 由生图服务按张单独补跑。
  async generateBatch(
    requests: ImageGenerationRequest[],
    signal: AbortSignal,
  ): Promise<ImageResult[]> {
    const dir = await fs.mkdtemp(path.join(this.configuration.scratchDir, 'codex-'));
    try {
      // 1. 去重下载所有参考图,url → 本地文件。
      const refByUrl = new Map<string, string>();
      for (const request of requests) {
        for (const url of request.referenceImageUrls ?? []) {
          if (refByUrl.has(url)) continue;
          const file = path.join(dir, `ref-${refByUrl.size}.png`);
          await fs.writeFile(file, await this.download(url, signal));
          refByUrl.set(url, file);
        }
      }
      const refFiles = [...refByUrl.values()];
      const outs = requests.map((_, i) => path.join(dir, `out-${i + 1}.png`));

      // 2. 一次 codex exec:提示词列明每张的输出文件 + 参考图 + 各自要求。
      const prompt = this.batchPrompt(requests, refByUrl, outs);
      const args = ['exec', '--ephemeral', '--skip-git-repo-check', '-C', dir, '--approve-for-me'];
      for (const file of refFiles) args.push('-i', file);
      if (this.configuration.model) args.push('-m', this.configuration.model);
      const { code, stderr } = await run('codex', args, this.proxyEnv(), prompt, signal);
      if (code !== 0) {
        throw new ProviderUnavailableError(`codex 生图失败:${stderr.trim() || `exit ${code}`}`);
      }

      // 3. 逐张读回、缩放;某张缺失 → 空结果(触发服务侧按张重试)。
      const results: ImageResult[] = [];
      for (const out of outs) {
        try {
          const buf = await fs.readFile(out);
          const resized = fitWithin(nativeImage.createFromBuffer(buf), TARGET_SIZE);
          results.push({ url: '', dataBase64: resized.toPNG().toString('base64') });
        } catch {
          results.push({ url: '' });
        }
      }
      return results;
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private batchPrompt(requests: ImageGenerationRequest[], refByUrl: Map<string, string>, outs: string[]): string {
    const lines = [
      `请根据提供的参考图，依次生成以下 ${requests.length} 张图，并把每张保存到对应的输出文件，一张都不要漏掉。`,
      '',
      '参考图文件：',
      ...[...refByUrl.values()].map((file) => `- ${path.basename(file)}`),
      '',
    ];
    requests.forEach((request, i) => {
      const refs = (request.referenceImageUrls ?? [])
        .map((url) => path.basename(refByUrl.get(url) ?? ''))
        .filter(Boolean)
        .join(', ');
      lines.push(
        `${i + 1}. 输出文件 ${path.basename(outs[i])}`,
        `   要求：${request.prompt}`,
        `   使用参考图：${refs || '无'}`,
        '',
      );
    });
    lines.push('请逐张生成并保存到上面的文件路径。每张图都基于它指定的参考图，不要混用参考图，不要虚构参考图中没有的内容。');
    return lines.join('\n');
  }

  private proxyEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    const proxy = this.configuration.proxy();
    if (proxy?.enabled && proxy.host && proxy.port) {
      const value = `${proxy.protocol ?? 'http'}://${proxy.host}:${proxy.port}`;
      env.HTTPS_PROXY = value;
      env.HTTP_PROXY = value;
      env.ALL_PROXY = value;
    }
    return env;
  }
}

// Reused by the app to decide whether to offer the codex provider in settings.
// 必须继承 process.env:否则子进程没有 PATH,spawn 找不到 codex。
export async function codexAvailable(): Promise<boolean> {
  try {
    const { code } = await run(
      'codex',
      ['--version'],
      { ...process.env },
      '',
      new AbortController().signal,
    );
    return code === 0;
  } catch {
    return false;
  }
}
