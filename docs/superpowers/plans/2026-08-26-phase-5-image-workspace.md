# Phase 5: 图片工作区 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从参考图生成 SKU 一致的主图和共用详情图，经规则检查、压缩和七牛上传后保存回妙手。

**Architecture:** 原图、生成图、处理图和远端 URL 分阶段保存为 `ImageAsset`；`ImageModelProvider`、`ImageProcessor`、`ObjectStorageProvider` 独立；只有通过检查并上传成功的公开 URL 才能进入妙手保存 command。

**Tech Stack:** Phase 4 技术栈、Sharp、七牛 Node SDK、豆包/OpenAI 生图 API。

**Spec:** 设计规格第 8、13、14、15 节。

## Global Constraints

- 最终电商图必须有参考图，拒绝无参考图生成。
- 每个启用 SKU 首图不同且与颜色/型号一致，详情图可共用。
- 主图白底、无明显 Logo/文本/水印；所有图至少 800×800，最多 10 张。
- 七牛失败保留本地处理结果；不得把未公开或不可访问 URL 保存妙手。

---

### Task 1: 图片资产 Repository 与本地文件安全

**Files:** `src/domain/image.ts`, `src/main/db/migrations/005_image_assets.sql`, `src/main/repositories/image-asset-repository.ts`, `src/main/images/local-image-store.ts`, `tests/integration/image-assets.test.ts`

```ts
export type ImageStage = 'reference' | 'generated' | 'processed' | 'uploaded';
export interface ImageAssetRepository { add(input: NewImageAsset): ImageAsset; listForProduct(productId: string): ImageAsset[] }
```

- [ ] 写生命周期、SKU 归属、共用详情图、重启恢复与路径穿越拒绝测试。
- [ ] 实现 userData 下按 product/session 存储和插入式资产记录；运行测试并提交。

### Task 2: 生图 Provider 契约与参考图强制

**Files:** `src/main/providers/image/{doubao,openai}.ts`, `src/main/images/image-generation-service.ts`, `tests/contract/image-provider-contract.test.ts`, `tests/unit/image-generation-service.test.ts`

- [ ] 写文生图、图生图、局部重绘契约及“最终商品图无参考图必须失败”测试。
- [ ] 实现 provider adapter、取消/超时与原图下载；prompt 明确 SKU 外观、白底主图和双语详情图规则。
- [ ] 运行测试，提交 `feat: generate reference-grounded product images`。

### Task 3: 检测、压缩和格式转换

**Files:** `src/main/images/sharp-image-processor.ts`, `src/main/images/image-quality-service.ts`, `tests/unit/image-processor.test.ts`, `tests/unit/image-quality.test.ts`

```ts
export interface ImageProcessor { inspect(path: string): Promise<ImageMetadata>; compress(input: CompressInput): Promise<ProcessedImage> }
```

- [ ] 使用仓库内小型 fixture 写尺寸、格式、EXIF 旋转、压缩上限、白底抽样和数量规则测试。
- [ ] 实现最短边至少 800、sRGB、去元数据、质量阶梯压缩；Logo/文本/水印和 SKU 一致性标记由视觉模型复核，不宣称像素规则可完全判断。
- [ ] 运行测试并比较输出文件大小，提交。

### Task 4: 七牛上传与妙手图片保存回读

**Files:** `src/main/providers/storage/qiniu.ts`, `src/main/services/image-publish-service.ts`, `tests/contract/qiniu-provider.test.ts`, `tests/integration/image-save-readback.test.ts`

```ts
export interface ObjectStorageProvider { testConnection(): Promise<ConnectionResult>; upload(input: UploadInput): Promise<PublicObject> }
```

- [ ] 写上传 token、域名规范化、重复 key、失败重试和公开 URL 探测测试。
- [ ] 实现七牛 adapter；上传后 GET 验证可访问，再把 URL 映射到妙手 SKU/详情图结构。
- [ ] 保存后回读图片列表；不一致展示字段差异，并用回读图片触发侵权复检。
- [ ] 运行测试，提交 `feat: upload images to Qiniu and verify Miaoshou readback`。

### Task 5: 图片工作区与真实外链验收

**Files:** `src/ui/features/images/*`, `tests/ui/image-workspace.test.tsx`, `tests/e2e/image-workspace.spec.ts`, `docs/acceptance/phase-5-checklist.md`

- [ ] 写 UI 测试覆盖选参考图、SKU 主图、共用详情图、生成/重绘/排序/删除/下载/上传重试。
- [ ] 实现逐图状态与规则提示；失败不得丢本地结果。
- [ ] 用至少两个 SKU 实测生图差异、5–6 张详情图复用、压缩体积、七牛公开 URL、妙手保存回读。
- [ ] 若妙手拒绝外链，停止并记录准确响应与 URL 形态，不自动切换付费图片管理。
- [ ] 跑全量测试/构建/占位扫描，提交并停止等待验收。

## Phase 5 Acceptance Gate

- [ ] 无参考图无法生成最终商品图。
- [ ] 多 SKU 主图不同、详情图复用且与实物参考一致。
- [ ] 图片 ≥800×800、压缩可用、规则问题可见。
- [ ] 七牛 URL 可公开访问并被妙手真实保存/回读。
- [ ] 用户明确确认“阶段 5 通过”。
