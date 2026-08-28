# Phase 4 产品编辑验收记录（草稿生成子阶段）

验收日期：2026-08-28（Asia/Shanghai）

> 本子阶段范围：AI 生成本地编辑草稿 + 工作台双视图（妙手详情 / AI 编辑详情）。
> 不写妙手、不保存回读、不触发侵权复检——这些属后继子阶段。

## 自动化验证

- [x] `npm test` 全量测试通过：41 个测试文件、254 项测试。
- [x] `npm run typecheck` 通过。
- [x] `npm run lint` 通过（无 error/warning）。
- [x] `npm run package` 正式打包通过（darwin arm64）。

## 双快照模型

- [x] 每件商品维护两份本地快照（`product_snapshots.kind`）：
  - `miaoshou`：同步时写入，对标妙手数据。
  - `aiDraft`：点击 AI 编辑后生成/更新，对标 AI 编辑数据。
- [x] 同步后只有 `miaoshou`，无 `aiDraft`。
- [x] 生成/保存草稿只写 `aiDraft` 快照，不触碰妙手。
- [x] 商品行「编辑」列由 `aiDraft` 快照驱动：有草稿显示「已编辑」，否则「未编辑」。

## 商品详情透出

- [x] `ProductDetailSku` 透出妙手 `skuMap` 的 `length`/`width`/`height`/`lengthWidthHeightUnit`/`weight`/`weightUnit`（可能为空）。
- [x] `ProductDetail` 透出品牌/型号（从详情 attributes 提取，支持英文 Brand/Model 与中文 品牌/型号）。

## AI 编辑草稿生成

- [x] `EditGenerationService` 读取最新 `miaoshou` 快照 → 组装 prompt（含标题/描述/品牌/型号/SKU 列表 + 原尺寸/重量 + SKU 图片）→ `provider.generate` → Zod 结构化校验 → `EditDraft`。
- [x] 字段：标题（≤60 字符）、描述、品牌（固定 Generic）、型号、SKU 名称翻译、包裹尺寸（长×宽×高 + 单位）、计费重量（重量 + 单位）。
- [x] 每个字段带 `source`（remote/ai/user）和 `confidence`（0-1）。
- [x] 坏响应（标题超 60、缺字段、多余字段、置信度越界）拒绝，不覆盖已有草稿。
- [x] 无同步快照时抛清晰错误（「请先同步商品」）。

## 工作台双视图

- [x] 右侧 `edit` tab 提供「妙手详情」与「AI 编辑详情」切换。
- [x] 妙手详情展示标题/描述/品牌/型号/货号/类目/站点/库存/货源价 + SKU 表（名称/尺寸/重量）。
- [x] AI 编辑详情展示各字段可编辑输入，带来源与置信度徽标。
- [x] 用户修改字段后来源标为「人工修改」、置信度置 1。
- [x] 生成草稿 / 重新生成 / 保存草稿均走 `edit:*` IPC。

## 编辑与发布分离

- [x] 保存草稿仅写入本地 `aiDraft` 快照，不写妙手、不自动发布。
- [x] 发布功能保持占位符未实现（后续阶段）。

## 后续子阶段（本次未实现，路线保留）

- [ ] 保存到妙手 `save_site_collect_item_info` + 回读验证 + 字段 diff。
- [ ] 保存后侵权复检（V2）。
- [ ] 多语言站点标题 `siteAndTitleList` 回读与西语主标题降级。
- [ ] 类目属性规则、SKU 定价与净收益。
