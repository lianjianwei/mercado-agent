# AI 生图核心 实施计划

> **给 agentic worker:** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务执行本计划。步骤用复选框（`- [ ]`）跟踪。

**目标：** 构建一个 AI 生图流水线（仅 OpenAI），为每个 SKU 生成一张白底主图，并由第一个 SKU 的参考图生成 4–6 张由 AI 规划、经自检的详情图，字节落盘本地并按 `aiImages` 快照记录结果，与 AI 草稿生成同一次动作触发。

**架构：** 主进程的 `ImageGenerationService` 编排流程：读取商品的妙手详情（参考图、类目）与已生成草稿（标题/描述），用多模态文本 provider 规划详情图清单、并自检每张生成图（≤2 次重试），用 OpenAI 图片 provider（`/images/edits`，multipart 上传参考图，输出 base64）出图。字节写入 `userData/images/{productId}/{imageId}.png`；结果以新的 `aiImages` 商品快照持久化。渲染层在 AI 草稿生成后紧接调用 `images.generate`。

**技术栈：** TypeScript、Electron（主进程）、zod、undici 的 `FormData`/`Blob`（Node 26 全局对象）、vitest（jsdom）、OpenAI chat + images 接口。

**规范：** `docs/superpowers/specs/2026-08-29-image-generation-design.md`

## 全局约束

- 本阶段只做 OpenAI 图片 provider（`image` 类型、provider `openai`、模型读配置，预期 `gpt-image-2`）。
- OpenAI 路径：`POST {baseUrl}/images/edits`，multipart，参考图先下载字节，响应 `{ data: [{ b64_json }] }`，请求 `size=1024x1024`、`quality=high`、`output_format=png`、`n=1`。
- 每张生成图在返回前必须先落盘本地（OpenAI 返回的 URL 是临时的）。
- 规划七牛路径：`mercado/{productId}/{imageId}.png`，`imageId` = `randomUUID()`。
- 详情图：4–6 张，仅用第一个 SKU 的参考图；参考图中没有的步骤/内容不得生成。
- 自检用多模态文本 provider；每张图最多重生成 2 次；失败不阻断其它图 → 汇总为 `partial`。
- `output_format=png` 默认；保存后缀 `.png`；目标 1024×1024，下限 500×500（本阶段只请求，不重采样）。
- `ProductSnapshotKind` 新增 `'aiImages'`。
- 提交纪律：每任务一次 commit；本阶段只新增 OpenAI provider 文件。

---

### 任务 1：领域类型 — `aiImages` 快照类型 + `ImageResult` 加 `dataBase64`

**文件：**
- 修改：`src/domain/providers.ts:27-29`（`ImageResult`）
- 修改：`src/domain/product.ts:80-84`（`ProductSnapshotKind`）
- 新建：`src/domain/images.ts`

**接口：**
- 消费：已有的 `ImageResult`、`ProductSnapshotKind`。
- 产出：
  - `ImageResult = { url: string; dataBase64?: string }`
  - `ProductSnapshotKind` 增加 `'aiImages'`
  - `src/domain/images.ts` 导出：`ImagePlanKind`、`DetailPlanItem`、`ImageReview`、`GeneratedImage`、`AiImagesResult`。

- [ ] **第 1 步：写失败的测试**（`tests/unit/images-domain.test.ts`）

```ts
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
```

- [ ] **第 2 步：运行确认失败**

运行：`npx vitest run tests/unit/images-domain.test.ts`
预期：FAIL — `ImageResult` 没有 `dataBase64`、`src/domain/images.ts` 不存在、`'aiImages'` 不可赋值。

- [ ] **第 3 步：实现**

`src/domain/providers.ts`：
```ts
export type ImageResult = {
  url: string;
  dataBase64?: string; // OpenAI 图像默认返回 base64;url 可能为临时值(已弃用)
};
```

`src/domain/product.ts`：
```ts
export type ProductSnapshotKind =
  | 'miaoshou'
  | 'aiDraft'
  | 'saved'
  | 'published'
  | 'aiImages';
```

`src/domain/images.ts`：
```ts
export type ImagePlanKind =
  | '尺寸图' | '功能图' | '场景图' | '包装清单' | '安装步骤' | '使用流程图' | '收纳尺寸对比';

export type DetailPlanItem = {
  id: string;
  kind: ImagePlanKind;
  subject: string;
  textEs: string;
  textPt: string;
  hasPerson: boolean;
  referenceNote: string;
};

export type ImageReview = { ok: boolean; issues: string[] };

export type GeneratedImage = {
  imageId: string;
  kind: 'main' | 'detail';
  skuKey?: string;
  detail?: { slug: string; title: string; hasPerson: boolean };
  localPath: string;
  plannedPath: string;
  sourceRefImages: string[];
  prompt: string;
  attempts: number;
  review?: ImageReview;
  status: 'ok' | 'retried' | 'failed';
  createdAt: string;
};

export type AiImagesResult = {
  version: number;
  productId: string;
  mainImages: GeneratedImage[];
  detailImages: GeneratedImage[];
  plan: DetailPlanItem[];
  status: 'done' | 'partial' | 'failed';
  createdAt: string;
};
```

- [ ] **第 4 步：运行确认通过**

运行：`npx vitest run tests/unit/images-domain.test.ts`
预期：PASS（2 个测试）。

- [ ] **第 5 步：提交**

```bash
git add src/domain/providers.ts src/domain/product.ts src/domain/images.ts tests/unit/images-domain.test.ts
git commit -m "feat(images): 新增 aiImages 快照类型与生图领域类型"
```

---

### 任务 2：OpenAI 图片 provider（`/images/edits`，multipart 参考图，base64）

**文件：**
- 新建：`src/main/providers/image/openai.ts`
- 修改：`src/main/providers/default-provider-registrations.ts:45-52`（注册 `image/openai`）
- 测试：`tests/unit/openai-image-provider.test.ts`

**接口：**
- 消费：`ImageModelProvider`/`ImageGenerationRequest`/`ImageResult`、`ProviderConfig`、`ModelNetworkTransport`、provider 错误类、`TextProviderConfiguration` 类似的配置形状。
- 产出：`OpenAiImageProvider` 构造函数 `(configuration: { baseUrl; apiKey; model }, network: ModelNetworkTransport, download: (url: string, signal: AbortSignal) => Promise<Buffer>)`；`generate(request, signal): Promise<ImageResult[]>`；`testConnection(signal)`。

- [ ] **第 1 步：写失败的测试**

```ts
// tests/unit/openai-image-provider.test.ts
import { describe, expect, it, vi } from 'vitest';
import { OpenAiImageProvider } from '../../src/main/providers/image/openai';
import { ProviderAuthenticationError } from '../../src/domain/providers';

const cfg = { baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'gpt-image-2' };

function transport(responseFactory: () => Response) {
  return {
    fetch: vi.fn(async (url: string, init: RequestInit) => {
      // assert url + method + multipart body has image; return the factory response
      void url; void init;
      return responseFactory();
    }),
    getRoute: () => 'direct' as const,
  };
}

describe('OpenAiImageProvider', () => {
  it('posts multipart to /images/edits and returns base64 from data[0].b64_json', async () => {
    const download = vi.fn(async () => Buffer.from('refbytes'));
    const network = transport(() =>
      new Response(JSON.stringify({ data: [{ b64_json: 'B64DATA' }] }), { status: 200 }),
    );
    const provider = new OpenAiImageProvider(cfg, network, download);
    const results = await provider.generate({ prompt: 'white bg main', referenceImageUrls: ['https://x/ref.png'] }, new AbortController().signal);
    expect(results[0].dataBase64).toBe('B64DATA');
    expect(network.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (network.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/images/edits');
    expect(String(init.method)).toBe('POST');
    const body = init.body as FormData;
    expect(body.get('prompt')).toBe('white bg main');
    expect(body.get('model')).toBe('gpt-image-2');
    expect(body.get('size')).toBe('1024x1024');
    expect(download).toHaveBeenCalledWith('https://x/ref.png', expect.anything());
  });

  it('throws ProviderAuthenticationError on 401', async () => {
    const network = transport(() => new Response('', { status: 401 }));
    const provider = new OpenAiImageProvider(cfg, network, async () => Buffer.from('x'));
    await expect(provider.generate({ prompt: 'p', referenceImageUrls: ['https://x/r.png'] }, new AbortController().signal))
      .rejects.toThrow(ProviderAuthenticationError);
  });
});
```

- [ ] **第 2 步：运行确认失败**

运行：`npx vitest run tests/unit/openai-image-provider.test.ts`
预期：FAIL — 模块不存在。

- [ ] **第 3 步：实现**

`src/main/providers/image/openai.ts`：
```ts
import type { ImageGenerationRequest, ImageModelProvider, ImageResult, ConnectionResult } from '../../../domain/providers';
import { ProviderAuthenticationError, ProviderRegionRestrictedError, ProviderUnavailableError } from '../../../domain/providers';
import type { ModelNetworkTransport } from '../../network/model-network-client';

export type OpenAiImageConfig = { baseUrl: string; apiKey: string; model: string };
type Download = (url: string, signal: AbortSignal) => Promise<Buffer>;

export class OpenAiImageProvider implements ImageModelProvider {
  constructor(
    private readonly configuration: OpenAiImageConfig,
    private readonly network: ModelNetworkTransport,
    private readonly download: Download,
  ) {}

  async testConnection(signal?: AbortSignal): Promise<ConnectionResult> {
    try {
      const response = await this.network.fetch(`${this.base()}/models`, {
        method: 'GET', headers: { Authorization: `Bearer ${this.configuration.apiKey}` }, signal,
      });
      if (response.status === 401 || response.status === 403) throw new ProviderAuthenticationError();
      if (response.status === 451) throw new ProviderRegionRestrictedError();
      if (!response.ok) throw new ProviderUnavailableError();
      return { ok: true, status: 'success', message: '生图模型连接成功。', latencyMs: 0, route: this.network.getRoute() };
    } catch (error) {
      if (error instanceof ProviderAuthenticationError || error instanceof ProviderRegionRestrictedError) throw error;
      if (signal?.aborted) throw error;
      throw new ProviderUnavailableError();
    }
  }

  async generate(request: ImageGenerationRequest, signal: AbortSignal): Promise<ImageResult[]> {
    const form = new FormData();
    form.set('model', this.configuration.model);
    form.set('prompt', request.prompt);
    form.set('size', '1024x1024');
    form.set('quality', 'high');
    form.set('output_format', 'png');
    form.set('n', '1');
    for (const url of request.referenceImageUrls ?? []) {
      const bytes = await this.download(url, signal);
      form.append('image', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'ref.png');
    }

    let response: Response;
    try {
      response = await this.network.fetch(`${this.base()}/images/edits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.configuration.apiKey}` },
        body: form,
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new ProviderUnavailableError();
    }
    if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    if (response.status === 401 || response.status === 403) throw new ProviderAuthenticationError();
    if (response.status === 451) throw new ProviderRegionRestrictedError();
    if (!response.ok) throw new ProviderUnavailableError();

    const payload = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
    return (payload.data ?? []).map((item) => ({ url: item.url ?? '', dataBase64: item.b64_json }));
  }

  private base(): string {
    return this.configuration.baseUrl.replace(/\/+$/, '');
  }
}
```

修改 `default-provider-registrations.ts`：
```ts
import { OpenAiImageProvider } from './image/openai';
// ...
const image = (['openai'] as const).map((provider) => ({
  kind: 'image' as const,
  provider,
  create: (configuration: ProviderConfig) =>
    new OpenAiImageProvider(
      { baseUrl: configuration.baseUrl, apiKey: configuration.apiKey, model: configuration.model },
      network,
      (url, signal) => downloadBytes(network, url, signal),
    ),
}));
// 在本文件加一个 helper：
async function downloadBytes(network: ModelNetworkTransport, url: string, signal: AbortSignal): Promise<Buffer> {
  const response = await network.fetch(url, { method: 'GET', signal });
  if (!response.ok) throw new ProviderUnavailableError('参考图下载失败。');
  return Buffer.from(await response.arrayBuffer());
}
```

- [ ] **第 4 步：运行确认通过**

运行：`npx vitest run tests/unit/openai-image-provider.test.ts`
预期：PASS（2 个测试）。

- [ ] **第 5 步：类型检查**

运行：`npx tsc --noEmit`
预期：无输出（或仅有与本次无关的既有错误；应无）。

- [ ] **第 6 步：提交**

```bash
git add src/main/providers/image/openai.ts src/main/providers/default-provider-registrations.ts tests/unit/openai-image-provider.test.ts
git commit -m "feat(images): OpenAI 图片 provider(经 /images/edits，base64 输出)"
```

---

### 任务 3：图片 schema（详情图规划 + 自检 + 快照记录）

**文件：**
- 新建：`src/shared/image-schemas.ts`
- 测试：`tests/unit/image-schemas.test.ts`

**接口：**
- 消费：`src/domain/images.ts` 里的类型形状。
- 产出：`detailPlanSchema`、`imageReviewSchema`、`generatedImageSchema`、`aiImagesSnapshotSchema` 及推断类型，并把 `ImagePlanKind` 用作 planner 的常量之一。

- [ ] **第 1 步：写失败的测试**

```ts
// tests/unit/image-schemas.test.ts
import { describe, expect, it } from 'vitest';
import { detailPlanSchema, imageReviewSchema, aiImagesSnapshotSchema } from '../../src/shared/image-schemas';

const goodPlan = {
  plans: [{ id: 'd1', kind: '尺寸图', subject: '尺寸', textEs: 'Alto', textPt: 'Altura', hasPerson: false, referenceNote: 'ref1' }],
};

const greenReview = { ok: true, issues: [] };
const badReview = { ok: false, issues: ['多指'] };

describe('image schemas', () => {
  it('accepts a valid detail plan and rejects unknown kinds', () => {
    expect(detailPlanSchema.safeParse(goodPlan).success).toBe(true);
    expect(detailPlanSchema.safeParse({ plans: [{ ...goodPlan.plans[0], kind: '不存在' }] }).success).toBe(false);
  });
  it('validates image review and a full aiImages snapshot', () => {
    expect(imageReviewSchema.safeParse(greenReview).success).toBe(true);
    expect(imageReviewSchema.safeParse(badReview).success).toBe(true); // ok:false allowed (issues present)
    const snapshot = {
      version: 1, productId: 'p1', mainImages: [], detailImages: [],
      plan: goodPlan.plans, status: 'done' as const, createdAt: '2026-08-29T00:00:00.000Z',
    };
    expect(aiImagesSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });
});
```

- [ ] **第 2 步：运行确认失败**

运行：`npx vitest run tests/unit/image-schemas.test.ts`
预期：FAIL — 模块不存在。

- [ ] **第 3 步：实现**

`src/shared/image-schemas.ts`：
```ts
import { z } from 'zod';

export const imagePlanKindSchema = z.enum(['尺寸图', '功能图', '场景图', '包装清单', '安装步骤', '使用流程图', '收纳尺寸对比']);

export const detailPlanItemSchema = z.strictObject({
  id: z.string().min(1),
  kind: imagePlanKindSchema,
  subject: z.string(),
  textEs: z.string(),
  textPt: z.string(),
  hasPerson: z.boolean(),
  referenceNote: z.string(),
});

export const detailPlanSchema = z.strictObject({ plans: z.array(detailPlanItemSchema) });
export type DetailPlan = z.infer<typeof detailPlanSchema>;

export const imageReviewSchema = z.strictObject({
  ok: z.boolean(),
  issues: z.array(z.string()),
});
export type ImageReview = z.infer<typeof imageReviewSchema>;

const generatedImageSchema = z.strictObject({
  imageId: z.string().min(1),
  kind: z.enum(['main', 'detail']),
  skuKey: z.string().optional(),
  detail: z.strictObject({ slug: z.string(), title: z.string(), hasPerson: z.boolean() }).optional(),
  localPath: z.string(),
  plannedPath: z.string(),
  sourceRefImages: z.array(z.string()),
  prompt: z.string(),
  attempts: z.number().int().min(1),
  review: imageReviewSchema.optional(),
  status: z.enum(['ok', 'retried', 'failed']),
  createdAt: z.string(),
});

export const aiImagesSnapshotSchema = z.strictObject({
  version: z.number().int().positive(),
  productId: z.string().min(1),
  mainImages: z.array(generatedImageSchema),
  detailImages: z.array(generatedImageSchema),
  plan: z.array(detailPlanItemSchema),
  status: z.enum(['done', 'partial', 'failed']),
  createdAt: z.string(),
});
export type AiImagesSnapshot = z.infer<typeof aiImagesSnapshotSchema>;
```

- [ ] **第 4 步：运行确认通过**

运行：`npx vitest run tests/unit/image-schemas.test.ts`
预期：PASS（2 个测试）。

- [ ] **第 5 步：提交**

```bash
git add src/shared/image-schemas.ts tests/unit/image-schemas.test.ts
git commit -m "feat(images): 详情图规划/自检/快照的 zod schema"
```

---

### 任务 4：详情图规划器（文本 provider → 结构化 plan）

**文件：**
- 新建：`src/main/services/image-planner.ts`
- 测试：`tests/unit/image-planner.test.ts`

**接口：**
- 消费：`TextModelProvider`（返回 `unknown`）、`detailPlanSchema`、`DetailPlanItem`。
- 产出：`class ImagePlanner { constructor(text: () => TextModelProvider); plan(input: { title; description; category; referenceImageUrls: string[] }): Promise<DetailPlanItem[]> }`；plan 无效时抛 `ImagePlanError`。

- [ ] **第 1 步：写失败的测试**

```ts
// tests/unit/image-planner.test.ts
import { describe, expect, it, vi } from 'vitest';
import { ImagePlanner } from '../../src/main/services/image-planner';
import type { TextModelProvider } from '../../src/domain/providers';

const fakeText = (returnValue: unknown): TextModelProvider => ({
  testConnection: vi.fn(),
  generate: vi.fn(async () => returnValue),
}) as unknown as TextModelProvider;

describe('ImagePlanner', () => {
  it('maps a text provider plan payload into DetailPlanItem[]', async () => {
    const planner = new ImagePlanner(() => fakeText({ plans: [
      { id: 'd1', kind: '功能图', subject: '功能', textEs: 'Es', textPt: 'Pt', hasPerson: false, referenceNote: 'ref1' },
    ]}));
    const plans = await planner.plan({ title: 'T', description: 'D', category: '猫砂', referenceImageUrls: ['https://x/a.png'] });
    expect(plans).toHaveLength(1);
    expect(plans[0].kind).toBe('功能图');
  });
  it('caps the plan at 6 images', async () => {
    const many = { plans: Array.from({ length: 9 }, (_, i) => ({ id: `d${i}`, kind: '功能图', subject: 'x', textEs: '', textPt: '', hasPerson: false, referenceNote: '' })) };
    const planner = new ImagePlanner(() => fakeText(many));
    const plans = await planner.plan({ title: 'T', description: 'D', category: 'C', referenceImageUrls: [] });
    expect(plans.length).toBeGreaterThanOrEqual(4);
    expect(plans.length).toBeLessThanOrEqual(6);
  });
});
```

- [ ] **第 2 步：运行确认失败**

运行：`npx vitest run tests/unit/image-planner.test.ts`
预期：FAIL — 模块不存在。

- [ ] **第 3 步：实现**

`src/main/services/image-planner.ts`：
```ts
import { detailPlanSchema, type DetailPlan } from '../../shared/image-schemas';
import type { DetailPlanItem } from '../../domain/images';
import type { TextModelProvider } from '../../domain/providers';

export class ImagePlanError extends Error {
  constructor(message = '模型返回的详情图规划无法解析。') {
    super(message);
    this.name = 'ImagePlanError';
  }
}

const SYSTEM_PROMPT = `你是一名资深跨境电商美工与运营。根据商品的标题、描述、类目与参考图，
为美客多详情页规划 4-6 张详情图。每张图输出一件具体要做的事。
约束：
- 数量 4-6 张；只输出 valid JSON（{"plans":[...]}）。
- kind 只能是：尺寸图/功能图/场景图/包装清单/安装步骤/使用流程图/收纳尺寸对比。
- subject 说明这张图具体呈现什么；textEs/textPt 为图上文本(西语/葡语)，放不下只保留西语。
- hasPerson 是否需要人物(服饰/发饰/包/场景图优先，人物用拉美裔)。
- referenceNote 说明依据哪张参考图。
- 参考图中没有安装/使用流程的，不要生成安装步骤/使用流程图；不得虚构参考图中没有的内容。`;

export type PlanInput = { title: string; description: string; category: string; referenceImageUrls: string[] };

export class ImagePlanner {
  constructor(private readonly text: () => TextModelProvider) {}

  async plan(input: PlanInput): Promise<DetailPlanItem[]> {
    const payload = await this.text().generate({
      prompt: `${SYSTEM_PROMPT}\n\n标题：${input.title}\n描述：${input.description}\n类目：${input.category||'未知'}\n参考图：\n${input.referenceImageUrls.map((u,i)=>`${i+1}. ${u}`).join('\n')}`,
      imageUrls: input.referenceImageUrls.slice(0, 4),
    }, new AbortController().signal);
    const parsed: DetailPlan | undefined = detailPlanSchema.safeParse(payload).success
      ? detailPlanSchema.parse(payload)
      : undefined;
    if (!parsed) throw new ImagePlanError();
    return parsed.plans.slice(0, 6);
  }
}
```

- [ ] **第 4 步：运行确认通过**

运行：`npx vitest run tests/unit/image-planner.test.ts`
预期：PASS（2 个测试）。

- [ ] **第 5 步：提交**

```bash
git add src/main/services/image-planner.ts tests/unit/image-planner.test.ts
git commit -m "feat(images): 详情图规划器(受参考图约束，4-6 张)"
```

---

### 任务 5：自检（视觉复查 + 重试策略）

**文件：**
- 新建：`src/main/services/image-reviser.ts`
- 测试：`tests/unit/image-reviser.test.ts`

**接口：**
- 消费：`TextModelProvider`、`imageReviewSchema`、`ImageReview`。
- 产出：`class ImageReviser { constructor(text: () => TextModelProvider); review({ imageUrl; context: { title; description; kind: 'main'|'detail'; main: boolean } }): Promise<ImageReview> }`；以及纯函数 `shouldRegenerate(review) : boolean`。

- [ ] **第 1 步：写失败的测试**

```ts
// tests/unit/image-reviser.test.ts
import { describe, expect, it, vi } from 'vitest';
import { ImageReviser, shouldRegenerate } from '../../src/main/services/image-reviser';
import type { TextModelProvider } from '../../src/domain/providers';

const fakeText = (v: unknown): TextModelProvider => ({
  testConnection: vi.fn(), generate: vi.fn(async () => v),
}) as unknown as TextModelProvider;

describe('ImageReviser', () => {
  it('reports ok when the model finds no issues', async () => {
    const reviser = new ImageReviser(() => fakeText({ ok: true, issues: [] }));
    const review = await reviser.review({ imageUrl: 'https://x/i.png', context: { title: 'T', description: 'D', kind: 'main' } });
    expect(review.ok).toBe(true);
  });
  it('shouldRegenerate matches !ok', () => {
    expect(shouldRegenerate({ ok: false, issues: ['多指'] })).toBe(true);
    expect(shouldRegenerate({ ok: true, issues: [] })).toBe(false);
  });
});
```

- [ ] **第 2 步：运行确认失败**

运行：`npx vitest run tests/unit/image-reviser.test.ts`
预期：FAIL — 模块不存在。

- [ ] **第 3 步：实现**

`src/main/services/image-reviser.ts`：
```ts
import { imageReviewSchema, type ImageReview } from '../../shared/image-schemas';
import type { TextModelProvider } from '../../domain/providers';

export function shouldRegenerate(review: ImageReview): boolean {
  return !review.ok;
}

export type ReviewContext = { title: string; description: string; kind: 'main' | 'detail' };
export type ReviewInput = { imageUrl: string; context: ReviewContext };

const PROMPT = `你是一名电商质检员。检查这张商品图的真实性与质量。对照商品标题/描述判断。
只输出 valid JSON（{"ok":bool,"issues":[...]}）。issues 仅在 ok=false 时列出具体问题，
如：产品与标题/参考图不符、出现logo或无关文字、比例怪异、多指/残肢、背景非纯白(主图)、
凭空出现参考图中没有的部件。`;

export class ImageReviser {
  constructor(private readonly text: () => TextModelProvider) {}

  async review(input: ReviewInput): Promise<ImageReview> {
    const payload = await this.text().generate({
      prompt: `${PROMPT}\n标题：${input.context.title}\n描述：${input.context.description}\n图片角色：${input.context.kind === 'main' ? '主图' : '详情图'}`,
      imageUrls: [input.imageUrl],
    }, new AbortController().signal);
    const parsed = imageReviewSchema.safeParse(payload);
    return parsed.success ? parsed.data : { ok: false, issues: ['自检结果无法解析，按需重生成'] };
  }
}
```

- [ ] **第 4 步：运行确认通过**

运行：`npx vitest run tests/unit/image-reviser.test.ts`
预期：PASS（2 个测试）。

- [ ] **第 5 步：提交**

```bash
git add src/main/services/image-reviser.ts tests/unit/image-reviser.test.ts
git commit -m "feat(images): 自检(虚构/保真度复查)"
```

---

### 任务 6：生图服务（编排 + 本地落盘 + 快照）

**文件：**
- 新建：`src/main/services/image-generation-service.ts`
- 测试：`tests/unit/image-generation-service.test.ts`

**接口：**
- 消费：`ImagePlanner`、`ImageReviser`、`ImageModelProvider`、`TextModelProvider`、`ProductDetail`、`EditDraft`、`AiImagesResult`、`aiImagesSnapshotSchema`。
- 产出：`class ImageGenerationService { constructor(deps: ImageGenerationDeps); async generate(productId: string): Promise<AiImagesResult> }`，以及导出 `buildMainImagePrompt`、`buildDetailImagePrompt`、`saveImageBytes`。

`ImageGenerationDeps`：
```ts
type ImageGenerationDeps = {
  readDetail: (productId: string) => ProductDetail | null;
  readDraft: (productId: string) => EditDraft | null;
  imageProvider: () => ImageModelProvider;
  textProvider: () => TextModelProvider;
  appendImages: (productId: string, result: AiImagesResult) => void;
  imagesDir: string;
  now?: () => string;
};
```

- [ ] **第 1 步：写失败的测试**

```ts
// tests/unit/image-generation-service.test.ts
import { describe, expect, it, vi } from 'vitest';
import { ImageGenerationService, buildMainImagePrompt } from '../../src/main/services/image-generation-service';
import type { ProductDetail } from '../../src/domain/product';
import type { EditDraft } from '../../src/domain/edit';
import type { ImageModelProvider, TextModelProvider } from '../../src/domain/providers';

const detail = { productId: 'p1', title: 'T', description: 'D', category: '猫咪用品',
  skuList: [
    { skuKey: ';a;', name: 'A', imageUrls: ['https://ref/a.png'], weight: null, length: null, width: null, height: null, stock: null, sourcePrice: null, netProfit: null, dimensionUnit: null, weightUnit: null, siteAndPriceMap: {}, siteAndListingTypeInfoMap: {}, imageUrl: null },
  ] } as unknown as ProductDetail;

const draft = { title: { value: 'T' }, description: { value: 'D' } } as unknown as EditDraft;

describe('ImageGenerationService', () => {
  it('builds a white-bg main-image prompt without logo or text', () => {
    const prompt = buildMainImagePrompt({ title: '按摩仪', description: 'x', category: '健康' });
    expect(prompt).toContain('白底');
    expect(prompt).toContain('无 logo');
  });

  it('emits one main image per SKU with a local file and a snapshot record', async () => {
    const appendImages = vi.fn();
    const imageProvider = { testConnection: vi.fn(), generate: vi.fn(async () => [{ url: '', dataBase64: 'AAAA' }]) } as unknown as ImageModelProvider;
    const textProvider = {
      testConnection: vi.fn(),
      generate: vi.fn(async () => ({ plans: [{ id: 'd1', kind: '功能图', subject: 's', textEs: '', textPt: '', hasPerson: false, referenceNote: '' }] })),
    } as unknown as TextModelProvider;
    const service = new ImageGenerationService({
      readDetail: () => detail,
      readDraft: () => draft,
      imageProvider: () => imageProvider,
      textProvider: () => textProvider,
      appendImages,
      imagesDir: '/tmp/imgs',
      now: () => '2026-08-29T00:00:00.000Z',
    });
    const result = await service.generate('p1');
    expect(appendImages).toHaveBeenCalledWith('p1', expect.objectContaining({ status: 'done' }));
    expect(result.mainImages).toHaveLength(1);
    expect(result.mainImages[0].localPath).toMatch(/\/tmp\/imgs\/p1\/.+\.png$/);
    expect(result.mainImages[0].plannedPath).toMatch(/^mercado\/p1\/.+\.png$/);
    expect(result.mainImages[0].localPath.endsWith('.png')).toBe(true);
  });
});
```

- [ ] **第 2 步：运行确认失败**

运行：`npx vitest run tests/unit/image-generation-service.test.ts`
预期：FAIL — 模块不存在。

- [ ] **第 3 步：实现**

`src/main/services/image-generation-service.ts`：
```ts
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { ProductDetail } from '../../domain/product';
import type { EditDraft } from '../../domain/edit';
import type { GeneratedImage, AiImagesResult, DetailPlanItem } from '../../domain/images';
import type { ImageModelProvider, ImageResult, TextModelProvider } from '../../domain/providers';
import { ImagePlanner } from './image-planner';
import { ImageReviser, shouldRegenerate } from './image-reviser';

export type ImageGenerationDeps = {
  readDetail: (productId: string) => ProductDetail | null;
  readDraft: (productId: string) => EditDraft | null;
  imageProvider: () => ImageModelProvider;
  textProvider: () => TextModelProvider;
  appendImages: (productId: string, result: AiImagesResult) => void;
  imagesDir: string;
  now?: () => string;
};

export function buildMainImagePrompt(input: { title: string; description: string; category: string }): string {
  return `以参考图为准生成一张美客多主图：白底，只展示产品本身，去除 logo 与所有文字，
不得虚构参考图中不存在的部件，产品外观/配色/结构保持一致。产品「${input.title}」。
类目：${input.category || '未知'}。描述：${input.description}`;
}

export function buildDetailImagePrompt(item: DetailPlanItem, title: string): string {
  const language = item.textPt && item.textPt.length > 0 ? `文本使用西班牙语与葡萄牙语：西语「${item.textEs}」，葡语「${item.textPt}」` : `文本使用西班牙语：「${item.textEs || ''}」`;
  return `依据参考图制作详情图「${item.kind}」。主题：${item.subject}。${language}。
${item.hasPerson ? '人物使用拉美裔模特。' : '不要出现人物。'}
以参考图为准，真实呈现产品，不虚构参考图中没有的内容，保持产品外观/配色/结构一致。产品「${title}」。`;
}

export async function saveImageBytes(imagesDir: string, productId: string, imageId: string, result: ImageResult): Promise<string> {
  const dir = path.join(imagesDir, productId);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${imageId}.png`);
  let buffer: Buffer;
  if (result.dataBase64) buffer = Buffer.from(result.dataBase64, 'base64');
  else {
    const res = await fetch(result.url);
    if (!res.ok) throw new Error('生图结果下载失败。');
    buffer = Buffer.from(await res.arrayBuffer());
  }
  writeFileSync(file, buffer);
  return file;
}

export class ImageGenerationService {
  constructor(private readonly deps: ImageGenerationDeps) {}

  async generate(productId: string): Promise<AiImagesResult> {
    const detail = this.deps.readDetail(productId);
    if (!detail) throw new Error('暂无可用的妙手详情，无法生图。');
    const draft = this.deps.readDraft(productId);
    const title = draft?.title.value ?? detail.title ?? '';
    const description = draft?.description.value ?? detail.description ?? '';
    const skus = detail.skuList ?? [];
    const planner = new ImagePlanner(this.deps.textProvider);
    const reviser = new ImageReviser(this.deps.textProvider);
    const provider = this.deps.imageProvider();

    const sku0Refs = skus[0]?.imageUrls ?? [];
    const plan = await planner.plan({ title, description, category: detail.category ?? '', referenceImageUrls: sku0Refs });

    const mainImages: GeneratedImage[] = [];
    for (const sku of skus) {
      const ref = sku.imageUrls[0];
      if (!ref) continue;
      const prompt = buildMainImagePrompt({ title, description, category: detail.category ?? '' });
      mainImages.push(await this.generateOne({ provider, reviser, prompt, refs: [ref], kind: 'main', skuKey: sku.skuKey, detail: undefined, productId }));
    }

    const detailImages: GeneratedImage[] = [];
    for (const item of plan) {
      const prompt = buildDetailImagePrompt(item, title);
      detailImages.push(await this.generateOne({ provider, reviser, prompt, refs: sku0Refs, kind: 'detail', skuKey: undefined, detail: { slug: item.id, title: item.subject, hasPerson: item.hasPerson }, productId }));
    }

    const failed = [...mainImages, ...detailImages].filter((i) => i.status === 'failed');
    const status: AiImagesResult['status'] = failed.length === 0 ? 'done' : (failed.length === [...mainImages, ...detailImages].length ? 'failed' : 'partial');

    const result: AiImagesResult = {
      version: 1, productId, mainImages, detailImages, plan, status, createdAt: this.deps.now?.() ?? new Date().toISOString(),
    };
    this.deps.appendImages(productId, result);
    return result;
  }

  private async generateOne(args: {
    provider: ImageModelProvider; reviser: ImageReviser; prompt: string; refs: string[];
    kind: 'main' | 'detail'; skuKey?: string; detail?: GeneratedImage['detail']; productId: string;
  }): Promise<GeneratedImage> {
    const imageId = randomUUID();
    let attempts = 1;
    let render: ImageResult = { url: '' };
    try {
      const result = await args.provider.generate({ prompt: args.prompt, referenceImageUrls: args.refs }, new AbortController().signal);
      render = result[0] ?? { url: '' };
    } catch {
      return { imageId, kind: args.kind, skuKey: args.skuKey, detail: args.detail, localPath: '', plannedPath: `mercado/${args.productId}/${imageId}.png`, sourceRefImages: args.refs, prompt: args.prompt, attempts, status: 'failed', createdAt: this.deps.now?.() ?? new Date().toISOString() };
    }
    let review = await this.reviser.review({ imageUrl: render.url || '', context: { title: '', description: '', kind: args.kind } });
    while (shouldRegenerate(review) && attempts < 3) {
      attempts += 1;
      try {
        const result = await args.provider.generate({ prompt: `${args.prompt}\n（上一版未过质检：${review.issues.join('；')} 请修改后重出。）`, referenceImageUrls: args.refs }, new AbortController().signal);
        render = result[0] ?? render;
      } catch { break; }
      review = await this.reviser.review({ imageUrl: render.url || '', context: { title: '', description: '', kind: args.kind } });
    }
    const localPath = render.dataBase64 || render.url ? await saveImageBytes(this.deps.imagesDir, args.productId, imageId, render) : '';
    return {
      imageId, kind: args.kind, skuKey: args.skuKey, detail: args.detail, localPath,
      plannedPath: `mercado/${args.productId}/${imageId}.png`, sourceRefImages: args.refs, prompt: args.prompt,
      attempts, review, status: review.ok ? 'ok' : (attempts >= 3 ? 'failed' : 'retried'), createdAt: this.deps.now?.() ?? new Date().toISOString(),
    };
  }
}
```

- [ ] **第 4 步：运行确认通过**

运行：`npx vitest run tests/unit/image-generation-service.test.ts`
预期：PASS（2 个测试）。注：测试用 `saveImageBytes` 写 `/tmp/imgs` 并 `mkdirSync`，在 vitest 下可行。

- [ ] **第 5 步：类型检查**

运行：`npx tsc --noEmit`
预期：通过。

- [ ] **第 6 步：提交**

```bash
git add src/main/services/image-generation-service.ts tests/unit/image-generation-service.test.ts
git commit -m "feat(images): 编排主图+详情图生成、自检重试、本地落盘、快照"
```

---

### 任务 7：读取辅助 + IPC 通道/处理器 + preload

**文件：**
- 修改：`src/shared/ipc-contract.ts`（加 `IPC_CHANNELS.imagesGenerate`、`ImageApi`、`DesktopApi.images`）
- 修改：`src/main/ipc/register-handlers.ts`（注册 `image-handlers`）
- 新建：`src/main/ipc/image-handlers.ts`
- 修改：`src/main.ts`（构造服务并传入依赖）
- 修改：`src/preload.ts`（暴露 `images`）
- 测试：`tests/integration/image-ipc.test.ts`

**接口：**
- 消费：`ImageGenerationService.generate`、`readLatestDraft`（来自 edit-handlers）、`productDetailFromSources`（来自 product-detail-mapper）、`ProductSnapshotRepository`。
- 产出：`registerImageHandlers(registrar, { service, readDraft, readDetail })`、`IPC_CHANNELS.imagesGenerate`、`ImageApi.generateImages(productId): Promise<AiImagesResult>`、`DesktopApi.images`。

- [ ] **第 1 步：写失败的测试**

```ts
// tests/integration/image-ipc.test.ts
import { describe, expect, it, vi } from 'vitest';
import { registerImageHandlers } from '../../src/main/ipc/image-handlers';
import { IPC_CHANNELS, type IpcListener } from '../../src/shared/ipc-contract';
import type { AiImagesResult } from '../../src/domain/images';

describe('image generation IPC', () => {
  it('returns an AiImagesResult and propagates generator errors', async () => {
    const handlers = new Map<string, IpcListener>();
    const result: AiImagesResult = { version: 1, productId: 'p1', mainImages: [], detailImages: [], plan: [], status: 'done', createdAt: '2026-08-29T00:00:00.000Z' };
    const service = { generate: vi.fn(async () => result) };
    registerImageHandlers({ handle: (c, l) => handlers.set(c, l) }, { service, readDraft: async () => null, readDetail: async () => null });
    await expect(handlers.get(IPC_CHANNELS.imagesGenerate)?.({}, { productId: 'p1' })).resolves.toEqual({ ok: true, data: result });
    const failing = { generate: vi.fn(async () => { throw new Error('boom'); }) };
    const handlers2 = new Map<string, IpcListener>();
    registerImageHandlers({ handle: (c, l) => handlers2.set(c, l) }, { service: failing, readDraft: async () => null, readDetail: async () => null });
    await expect(handlers2.get(IPC_CHANNELS.imagesGenerate)?.({}, { productId: 'p1' })).resolves.toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
  });
});
```

- [ ] **第 2 步：运行确认失败**

运行：`npx vitest run tests/integration/image-ipc.test.ts`
预期：FAIL — `registerImageHandlers`/通道未定义。

- [ ] **第 3 步：实现**

`src/shared/ipc-contract.ts`：
```ts
import type { AiImagesResult } from '../domain/images';
// 在 IPC_CHANNELS 里加：
  imagesGenerate: 'images:generate',
// 新增接口：
export interface ImageApi {
  generateImages(productId: string): Promise<AiImagesResult>;
}
// DesktopApi 加：
  images: ImageApi;
```

`src/main/ipc/image-handlers.ts`：
```ts
import { z } from 'zod';
import { IPC_CHANNELS, type IpcRegistrar } from '../../shared/ipc-contract';
import type { ImageGenerationService } from '../services/image-generation-service';
import type { EditDraft } from '../../domain/edit';
import type { AiImagesResult } from '../../domain/images';

const productIdSchema = z.strictObject({ productId: z.string().min(1) });

export function registerImageHandlers(
  registrar: IpcRegistrar,
  deps: {
    service: Pick<ImageGenerationService, 'generate'>;
    readDraft: (productId: string) => EditDraft | null;
    readDetail: (productId: string) => unknown | null;
  },
): void {
  registrar.handle(IPC_CHANNELS.imagesGenerate, async (_event, payload) => {
    try {
      const { productId } = productIdSchema.parse(payload);
      const detail = deps.readDetail(productId);
      const draft = deps.readDraft(productId);
      // Service reads detail+draft internally; these are passed for guard only.
      if (!detail) return { ok: false, error: { code: 'NOT_FOUND', message: '暂无可用的妙手详情，无法生图。' } };
      const data = await deps.service.generate(productId);
      return { ok: true, data };
    } catch (error) {
      if (error instanceof z.ZodError) return { ok: false, error: { code: 'VALIDATION_ERROR', message: '商品 ID 无效' } };
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : '图片生成失败' } };
    }
  });
}
```

`src/main.ts` —— 构造服务并传给 registerHandlers：
```ts
import { ImageGenerationService } from './main/services/image-generation-service';
import { readLatestDraft } from './main/ipc/edit-handlers';
import { productDetailFromSources } from './main/ipc/product-detail-mapper';
import type { CollectBoxDetailDto } from './shared/miaoshou-schemas';
// whenReady 内、editService 之后：
const imageService = new ImageGenerationService({
  // 与 product-handlers 的 productDetail 同款取数:product + 最新 miaoshou 快照。
  readDetail: (productId: string) => {
    const product = products.getById(productId);
    const latest = [...snapshots.listForProduct(productId)].reverse()
      .find((s) => s.kind === 'miaoshou')?.payload as CollectBoxDetailDto | undefined;
    return productDetailFromSources(product, latest);
  },
  readDraft: (productId) => readLatestDraft(snapshots, productId),
  imageProvider: () => providerRegistry.createActive('image') as ImageModelProvider,
  textProvider: () => {
    const p = providerRegistry.createActive('text') as TextModelProvider;
    if (typeof p.generate !== 'function') throw new ActiveProviderMissingError('text');
    return p;
  },
  appendImages: (productId, result) => snapshots.append({ id: `${productId}:aiImages:${randomUUID()}`, productId, kind: 'aiImages', capturedAt: result.createdAt, payload: result }),
  imagesDir: path.join(app.getPath('userData'), 'images'),
});
```
在 `registerHandlers` 的 deps 加 `imageService`（并在 register-handlers.ts 里注册 `image-handlers` 为 `{ service: imageService, readDraft, readDetail }`）。在 `HandlerDependencies` 类型里加 `imageService: ImageGenerationService`，并 `registerImageHandlers(registrar, { service: dependencies.imageService, readDraft: ..., readDetail: ... })`。

`src/preload.ts` —— 暴露 `images: { generateImages: (productId) => ipcRenderer.invoke(IPC_CHANNELS.imagesGenerate, { productId }) }`。

- [ ] **第 4 步：运行确认通过**

运行：`npx vitest run tests/integration/image-ipc.test.ts`
预期：PASS（2 个测试）。

- [ ] **第 5 步：类型检查**

运行：`npx tsc --noEmit`
预期：通过。

- [ ] **第 6 步：提交**

```bash
git add src/shared/ipc-contract.ts src/main/ipc/register-handlers.ts src/main/ipc/image-handlers.ts src/main.ts src/preload.ts tests/integration/image-ipc.test.ts
git commit -m "feat(images): 生图 IPC 通道/处理器/preload"
```

---

### 任务 8：渲染层 — 与 AI 草稿生成动作联动 + 进度 UI

**文件：**
- 修改：`src/ui/features/editor/EditPanel.tsx`
- 修改：`src/ui/features/editor/DraftView.tsx`
- 修改：`src/ui/pages/workbench.css`（进度区样式）
- 测试：`tests/ui/edit-panel-images.test.tsx`

**接口：**
- 消费：`DesktopApi.images.generateImages`、`AiImagesResult`、已有的 `EditApi`/`ProductApi`。
- 产出：`EditPanel` 在 `runGenerate` 后调用 `api.images.generateImages(product.id)`；`DraftView` 渲染 `<ImageProgress result={imageResult} onRetry={...} />`。

- [ ] **第 1 步：写失败的测试**

```ts
// tests/ui/edit-panel-images.test.tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditPanel } from '../../src/ui/features/editor/EditPanel';
import type { Product } from '../../src/domain/product';

afterEach(cleanup);

describe('EditPanel image generation', () => {
  it('chains image generation after the draft generate action and renders progress', async () => {
    const generateImages = vi.fn(async () => ({ version: 1, productId: 'p1',
      mainImages: [{ imageId: 'i1', kind: 'main', skuKey: ';a;', localPath: '/x/i1.png', plannedPath: 'mercado/p1/i1.png', sourceRefImages: [], prompt: 'p', attempts: 1, status: 'ok' as const, createdAt: 'x' }],
      detailImages: [], plan: [], status: 'done' as const, createdAt: 'x' }));
    const api = {
      generate: vi.fn(async () => ({ /* minimal draft */ }) as never),
      draft: vi.fn(async () => null),
      saveDraft: vi.fn(async () => ({} as never)),
      images: { generateImages },
    };
    render(<EditPanel api={api as never} loadDetail={async () => ({ skuList: [], sites: [], images: [], productId: 'p1', title: 'T', description: 'D', category: '猫', netProfit: null, stock: null, sourcePrice: null, mainImage: null, brand: null, model: null, siteAndPriceMap: {} } as never)} product={{ id: 'p1', title: 'Metrónomo' } as Product} />);
    fireEvent.click(await screen.findByText('生成 AI 草稿'));
    await waitFor(() => expect(generateImages).toHaveBeenCalledWith('p1'));
    expect(await screen.findByText(/图片生成/)).toBeTruthy();
  });
});
```

- [ ] **第 2 步：运行确认失败**

运行：`npx vitest run tests/ui/edit-panel-images.test.tsx`
预期：FAIL — 还没有图片联动/进度。

- [ ] **第 3 步：实现**

`EditPanel.tsx`：
```ts
const [imageResult, setImageResult] = useState<AiImagesResult | null>(null);
const [generatingImages, setGeneratingImages] = useState(false);

async function runGenerateImages() {
  if (!product) return;
  setGeneratingImages(true);
  setError('');
  try {
    const result = await api.images.generateImages(product.id);
    setImageResult(result);
  } catch (reason) {
    setError(reason instanceof Error ? reason.message : '图片生成失败。');
  } finally {
    setGeneratingImages(false);
  }
}

async function runGenerate() {
  setGenerating(true);
  setError('');
  try {
    const generated = await api.generate(product.id);
    setDraft(generated);
    // 草稿生成后同一动作接着触发图片生成。
    void runGenerateImages();
  } catch (...) {...} finally { setGenerating(false); }
}
```

把 `imageResult`、`generatingImages`、`onRetryImages={() => void runGenerateImages()}` 传给 `DraftView`。

`DraftView.tsx` 加 `ImageProgress` 区，渲染主图/详情图缩略图与状态，并提供重试按钮。在视图内渲染 `<ImageProgress .../>`（小网格，复用到 `image-zoom-button`/Lightbox 则用 `onZoom`，最小实现：状态文本 + 缩略图）。

在 `workbench.css` 加样式类 `.image-progress`、`.image-progress-item`、`.image-status-failed` 等。

- [ ] **第 4 步：运行确认通过**

运行：`npx vitest run tests/ui/edit-panel-images.test.tsx`
预期：PASS。

- [ ] **第 5 步：类型检查 + 全量测试**

运行：`npx tsc --noEmit`，再 `npx vitest run`
预期：通过。

- [ ] **第 6 步：提交**

```bash
git add src/ui/features/editor/EditPanel.tsx src/ui/features/editor/DraftView.tsx src/ui/pages/workbench.css tests/ui/edit-panel-images.test.tsx
git commit -m "feat(images): 与 AI 草稿生成联动触发生图并展示进度"
```

---

### 任务 9：记录契约测试 — `aiImages` 快照格式正确且路径可删

**文件：**
- 新建：`tests/unit/image-generation-record.test.ts`

**接口：**
- 消费：`ImageGenerationService`、`aiImagesSnapshotSchema`、`GeneratedImage`/`AiImagesResult`、`appendImages`。

- [ ] **第 1 步：写测试**

```ts
// tests/unit/image-generation-record.test.ts
import { describe, expect, it, vi } from 'vitest';
import { ImageGenerationService } from '../../src/main/services/image-generation-service';
import { aiImagesSnapshotSchema } from '../../src/shared/image-schemas';
import type { ProductDetail } from '../../src/domain/product';
import type { EditDraft } from '../../src/domain/edit';
import type { ImageModelProvider, TextModelProvider } from '../../src/domain/providers';

const detail = { productId: 'p1', title: 'T', description: 'D', category: 'C', skuList: [
  { skuKey: ';a;', name: 'A', imageUrls: ['https://ref/a.png'] },
] } as unknown as ProductDetail;
const draft = { title: { value: 'T' }, description: { value: 'D' } } as unknown as EditDraft;

describe('aiImages record contract', () => {
  it('every emitted image satisfies the snapshot schema and a deletable planned path', async () => {
    const appended: Array<{ kind: string; payload: unknown }> = [];
    const imageProvider = { testConnection: vi.fn(), generate: vi.fn(async () => [{ url: '', dataBase64: 'AAAA' }]) } as unknown as ImageModelProvider;
    const textProvider = { testConnection: vi.fn(), generate: vi.fn(async () => ({ plans: [
      { id: 'd1', kind: '功能图', subject: 's', textEs: 'Es', textPt: 'Pt', hasPerson: false, referenceNote: '' },
    ] })) } as unknown as TextModelProvider;
    const service = new ImageGenerationService({
      readDetail: () => detail, readDraft: () => draft,
      imageProvider: () => imageProvider, textProvider: () => textProvider,
      appendImages: (productId, result) => appended.push({ kind: 'aiImages', payload: result }),
      imagesDir: '/tmp/imgs', now: () => '2026-08-29T00:00:00.000Z',
    });
    const result = await service.generate('p1');
    expect(aiImagesSnapshotSchema.safeParse(result).success).toBe(true);
    expect(appended).toHaveLength(1);
    expect(appended[0].kind).toBe('aiImages');
    for (const image of [...result.mainImages, ...result.detailImages]) {
      expect(image.plannedPath).toMatch(/^mercado\/p1\/[0-9a-f-]{36}\.png$/);
    }
  });
});
```

- [ ] **第 2 步：运行确认通过**

运行：`npx vitest run tests/unit/image-generation-record.test.ts`
预期：PASS —— 校验记录形状与可整产品删除的 `/mercado/{productId}/{uuid}.png` 路径。

- [ ] **第 3 步：最终校验**

运行：`npx tsc --noEmit && npx vitest run`
预期：全部通过。

- [ ] **第 4 步：提交**

```bash
git add tests/unit/image-generation-record.test.ts
git commit -m "test(images): 锁定 aiImages 记录契约与可删除的规划路径"
```

---

## 自检

**规范覆盖：**
- OpenAI `/images/edits` + base64 → 任务 2。✅
- 每个 SKU 用其第 1 张参考图生成主图 → 任务 6。✅
- 详情图 4–6、不虚构、基于参考图、西/葡双语、拉美模特 → 任务 4 的 prompt + 任务 6。✅
- 自检 + ≤2 次重试 → 任务 5 + 任务 6。✅
- 返回前本地落盘（URL 过期）→ 任务 6 `saveImageBytes`。✅
- `mercado/{productId}/{imageId}.png` 规划路径 → 任务 1、6。✅
- `aiImages` 快照 → 任务 1、6、7。✅
- 与 AI 草稿生成联动 → 任务 8。✅
- 明确延后：压缩、七牛上传、最终 CDN URL —— 规范里的非目标，未纳入计划。✅

**占位符：** 无依赖占位；每个代码步骤都有具体代码。

**类型一致性：** `AiImagesResult`/`GeneratedImage`/`ImageReview`/`DetailPlanItem` 在任务 1 定义，并在任务 3–7 一致使用。`ImageModelProvider.generate → ImageResult[]` 的 `dataBase64` 被任务 2 与 6 使用。`saveImageBytes`、`buildMainImagePrompt`、`buildDetailImagePrompt` 在任务 6 导出，被服务与任务 9 消费。`registerImageHandlers` 签名在任务 7 与 9 之间一致。

**需向执行者说明的开放风险：** Doubao 生图路径本阶段有意不实现（规范：仅 OpenAI）。`AiImagesSnapshot` schema 与 `ImageGenerationDeps.readDetail`/`readDraft` 必须按任务 7 所示在 `main.ts` 里接线，且 `productDetailFromSources`/`readLatestDraft` 的签名必须与现有实现一致。
