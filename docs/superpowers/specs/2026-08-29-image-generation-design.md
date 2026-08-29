# AI 生图核心 — 设计文档

> 日期：2026-08-29
> 范围：**生图核心**（主图/详情图生成 + AI 规划详情图 + AI 自检重试 + 记录）。
> 明确**不在本阶段**：图片压缩、七牛 CDN 上传、最终 CDN URL 回写（下一阶段）。
> 参考已存在的脚手架：`ProviderKind = 'text' | 'image'`、`ImageModelProvider`、
> 七牛凭证（`QiniuCredential` + 设置 UI）、生图模型配置面板（`image` kind）。

---

## 1. 背景与目标

妙手商品的每个 SKU 都要在前台展示主图（白底、无 logo/文字），并需要一组详情图。
当前只有 AI 文本编辑草稿，没有生图能力。本阶段建立一个生图流水线：

- **主图**：每个 SKU 用「该 SKU 的第 1 张参考图」生成一张白底主图。
- **详情图**：只基于「第一个 SKU」的参考图生成 **4–6 张**，张数与内容由多模态模型按
  类目 / 标题 / 描述 / 参考图规划；详情图所有 SKU 共用。
- **自检**：每张生成图用多模态模型复查是否虚构 / 产品不符 / 异常，不合格则重生成。
- **记录**：生成与自检的中间产物与结果落盘，含后续七牛删除所需的规划路径。

用户常用 **gpt-image-2** 作图，能力充足；生图模型与鉴权完全走「生图模型」配置
（`image` 类型的 ProviderConfig），按启用配置派发。

## 2. 关键决策

| 决策 | 选择 | 说明 |
|---|---|---|
| 生图模型 | **仅 OpenAI**，配置驱动(`configuration.model`) | 用户常用 `gpt-image-2`；用 `/images/edits` 传参考图 |
| Doubao 生图 | **本阶段不做** | 用户原以为豆包走 OpenAI 规范，实际接口/参数不同；作为未来可选 provider |
| 详情图规划 | 多模态模型返回结构化 JSON | 数量 4–6，类型由模型按类目+参考图决定，禁止虚构 |
| 自检模型 | 复用多模态 text provider | 它能读 `imageUrls + prompt → 结构化 JSON` |
| 失败重试 | 每图最多再生成 2 次 | 用上一轮自检反馈 + 原 instruction 加强约束 |
| 保存 | 生成+自检通过后写本地文件 | OpenAI 返回 base64（非 URL），本地落盘防 URL 过期 |
| 记录 | 新快照 kind `aiImages` | 复用 `append/listForProduct` 机制 |
| 规划路径 | `mercado/{productId}/{imageId}.png` | `imageId` 用 UUID，便于整产品删图 |
| 触发 | 与 AI 草稿生成**同一次动作** | 生成标题/描述后自动续跑生图，见 §6 |

## 3. 架构与组件

```
[renderer] 生图触发 UI
   │ IPC: images.generate(productId)
   ▼
[main] image-generation-service
   ├─ loadProductArtifacts: 取 ProductDetail(标题/描述/类目) + 每SKU参考图
   ├─ planDetailImages(text model)        → DetailPlan[]
   ├─ generateMainImage(image provider)   → per SKU 主图
   ├─ generateDetailImage(image provider) → per plan item
   ├─ selfCheck(text model)               → { ok, issues }，不通过则重生成
   └─ saveLocal + appendRecord(aiImages snapshot)
   ▼
[providers]
   ├─ image/openai  (ImageModelProvider, /images/edits, base64)   ← 本阶段唯一生图 provider
   └─ text/*        (已有, 兼顾规划与自检)
▼
[storage]
   - 本地文件: userData/images/{productId}/{imageId}.png
   - 快照: product_snapshots(kind='aiImages')
```

## 4. 数据模型

### 4.1 生图记录(存放在 `aiImages` 快照 payload)

```ts
type GeneratedImage = {
  imageId: string;                       // UUID, 也是文件名/七牛路径的主键
  kind: 'main' | 'detail';
  skuKey?: string;                       // kind=main 时指向该 SKU
  detail?: { slug: string; title: string; hasPerson: boolean }; // kind=detail 时
  localPath: string;                     // 本地绝对路径(已落盘)
  plannedPath: string;                   // 'mercado/{productId}/{imageId}.png'
  sourceRefImages: string[];             // 依据的参考图(诊断用)
  prompt: string;                        // 最终送入生图模型的完整 prompt
  attempts: number;                      // 生成次数(>=1)
  review?: { ok: boolean; issues: string[] }; // 最近一次自检
  status: 'ok' | 'retried' | 'failed';
  createdAt: string;
};

type AiImagesSnapshot = {
  version: number;
  productId: string;
  mainImages: GeneratedImage[];          // 每 SKU 一张
  detailImages: GeneratedImage[];        // 4–6 张, 共用
  plan: DetailPlanItem[];                // 规划明细
  status: 'done' | 'partial' | 'failed';
  createdAt: string;
};
```

### 4.2 详情图规划(多模态模型输出的 JSON)

```ts
type DetailPlan = { plans: DetailPlanItem[] };
type DetailPlanItem = {
  id: string;
  kind: '尺寸图' | '功能图' | '场景图' | '包装清单' | '安装步骤' | '使用流程图' | '收纳尺寸对比';
  subject: string;        // 该图要呈现的内容
  textEs: string;         // 图上西语文本(可空)
  textPt: string;         // 图上葡语文本(可空; 放不下则仅西语)
  hasPerson: boolean;     // 是否需拉美模特
  referenceNote: string;  // 依据哪张参考图
};
```

规划约束(写入系统提示)：
- 数量 **4–6**。
- 常见组合：尺寸图(可收纳物需收纳+展开尺寸)、功能图、场景图(服饰/发饰/包需真人)、
  包装清单(多配件需说明内含)、安装步骤图(配件)、使用流程图(腰仪/电器)。
- **参考图中没有安装/使用流程→不生成该类**；不得虚构参考图中没有的内容。
- 人物优先拉美裔；文本放得下西+葡双语，否则仅西语。

### 4.3 自检(多模态模型输出的 JSON)

```ts
type ImageReview = { ok: boolean; issues: string[] };
// issues 示例: "产品与参考图不符" "出现logo/文字" "比例怪异" "多指/残肢" "背景非白(仅主图)" "凭空出现参考图没有的部件"
```

自检规则：`ok=false` → 将 issues 连同原 instruction 一起重生成，最多 **2 次**；
最终仍不通过则记录 `status:'failed'`（不阻断其它图，汇总为 `partial`）。

## 5. 生图接口

### 5.1 ImageModelProvider(已存在于 `domain/providers.ts`)

```ts
interface ImageModelProvider extends ModelConnectionProvider {
  generate(request: ImageGenerationRequest, signal: AbortSignal): Promise<ImageResult[]>;
}
```

本阶段对 `ImageResult` 做小幅扩展，以便 OpenAImodel 返回 base64：

```ts
type ImageResult = { url: string; dataBase64?: string };
```

服务层优先用 `dataBase64`(decode→写盘)，否则 `url`(下载→写盘)。

### 5.2 openai provider

- 端点：`POST {baseUrl}/images/edits`(带参考图；无参考图的可回退 `/images/generations`)。
- 参考图传递：**先下载参考图字节**(经同一代理会话 `ModelNetworkTransport.fetch` 下载)，
  再以 `multipart/form-data` 上传 `image` 字段(可多张)。`/images/edits` 不接受 `image_url`。
- 请求字段：`model=配置.model`、`prompt`、`size=1024x1024`、`quality=high`、`n=1`、
  `image`(参考图二进制)。
- 响应：`{ data: [{ b64_json }] }`(gpt-image 系列默认 base64)。把 base64 写回
  `ImageResult.dataBase64`。
- 高保真要求：prompt 明确「以参考图为准，保持产品外观/配色/结构一致，白底、无 logo 文字、
  不得虚构参考图中不存在的部件」。

### 5.3 doubao provider(本阶段不做)

用户原以为豆包兼容 OpenAI `/images/edits` 规范，实际火山方舟 Seedream 的端点与参数不同
(参考图字段为 `image`/模型名、响应为 `{ data: [{ url }] }`)。为避免臆断 API，本阶段只实现
OpenAI。未来如需 Doubao，另立小任务核对 Seedream 参考图接口后按同一
`ImageModelProvider` 实现，注册到 `provider-registry` 即可切换。

## 6. 触发(与 AI 草稿生成同一次动作)

图片生成**不单独设按钮**，而是跟 AI 编辑详情的生成动作耦合：点「生成 AI 草稿」或
「重新生成」时，除了生成标题/描述/品牌/型号/SKU 外，**同一动作接着触发图片生成**。

流程(渲染层编排，两个 IPC 调用串起来)：
1. `api.generate(productId)` → 返回草稿(标题/描述等)。
2. 草稿就绪后，渲染层随即 `api.generateImages(productId)` 触发图片生成。
3. AI 编辑详情视图上方展示「图片生成」进度区：
   - 主图：每 SKU 一张缩略图 + 状态(生成中/可用/可重试/失败)。
   - 详情图：4–6 张缩略图 + 状态(生成中/可用/可重试/失败)。
   - 进度文案：正在规划 / 正在生成第 i 张 / 正在自检 / 已完成。
   - 点击缩略图放大(复用现有 Lightbox)；失败项可单独「重试」。

说明：
- 图片 prompt 依赖草稿生成的标题/描述，故图片在草稿**之后**跑(顺序，非并发)。
- 草稿先展示，图片随生成进度陆续填充；两者状态独立，互不阻塞。
- 每一次生成/重新生成都会重新触发图片生成(草稿内容变了，图片要跟着重做)。
- 渲染层不做任何生成逻辑，只发 IPC；进度经 `api.generateImages` 的返回/轮询得到。

## 7. IPC 与主进程接线

- 新增 `IPC_CHANNELS.imagesGenerate` → handler `image-generation-service.generate(productId)`。
- 依赖注入：`images.generate` 的 `deps` 持有
  `productDetail(miaoshou 快照/skuList 参考图)`、`imageProvider(registry.createActive('image'))`、
  `textProvider(registry.createActive('text'))`、`snapshots.append`、`app settings(data dir)`。
- 复用已有 `provider-registry` 派发生图/文本 provider。

## 8. 保存与路径

- 本地：`app.getPath('userData')/images/{productId}/{imageId}.png`。
- 规划路径：`plannedPath='mercado/{productId}/{imageId}.png'`(下一阶段七牛上传用，
  便于整产品删除 `mercado/{productId}/` 前缀)。
- `imageId` 用 `randomUUID()`；文件名与七牛路径同 key，删除可一一对应。

## 9. 本阶段明确不做(Non-goals)

- **压缩**：1k(≈1024×1024)已在生成时请求；`>=500×500` 校验、PNG 压缩率——下一阶段。
- **七牛上传** + 把最终 `{domain}/mercado/...` CDN URL 写回记录——下一阶段。
- 全量精确(生成后)尺寸校验与重采样。
- 批量跨商品生图、计划任务。

## 10. 风险与边界(诚实说明)

- **“绝不虚构 / 自动识别 6 指”是尽力而为**：任何图像模型 + 视觉自检都无法 100% 保证；
  用结构化约束 + 自检重试把失败率压到最低，但存在残余失败，需人工兜底。
- **去 logo/文字属尽力**：白底化依赖模型能力；若参考图本身复杂，主图可能保留残迹。
- **参考图网络可达**：需能从本机下载参考图(妙手/1688 图片域)；网络受限时生成会失败。
- **OpenAI 返回 base64**：服务层统一“解码→写盘”，本地路径立即生效，不受 URL 过期影响。
- **规划/自检与生图账号分开**：多模态文本 provider 与生图 provider 是两套配置，
  读图效果可能与生图账号不同；prompt 里强调一致性。自检用的 text provider 若未启用，则跳过自检(仍落盘)。

## 11. 测试要点

- 单元：`detail-plan` schema 校验；`self-check` 重试逻辑(≤2 次后 failed)；主图/详情图
  组装记录；失败汇总 `partial`。
- provider：openai `dataBase64` → 写盘；doubao `url` → 下载写盘(用 mock transport)。
- IPC：`generate` 返回 `AiImagesSnapshot`；无参考图/坏凭证的错误路径。
- UI：点击「生成图片」触发调用；展示主图/详情图状态；自检失败项可重试。
- 集成：`aiImages` 快照 append/list 往返。

## 12. 参考

- 已有：`domain/providers.ts`(ImageModelProvider/ImageGenerationRequest/ImageResult)、
  `domain/config.ts`(ProviderKind/QiniuCredential)、`shared/config-schemas.ts`(qiniu schema)、
  `provider-registry.ts`、`model-network-client.ts`、`openai-compatible-text-provider.ts`。
- 文档：`docs/美客多净利润计算器.md`(净收益上下文)、`product-detail-mapper.ts`(取参考图)。
