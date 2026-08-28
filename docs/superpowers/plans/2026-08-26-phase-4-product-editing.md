# Phase 4: 产品编辑 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal（本次范围）:** AI 生成本地编辑草稿，工作台提供「妙手详情」与「AI 编辑详情」双视图对比。本子阶段**不写妙手、不保存回读、不触发侵权复检**。

**Architecture（双快照模型）:** 每件商品维护两份本地快照（复用 `product_snapshots` 表 + `kind` 字段）：

| kind | 含义 | 何时有 |
|---|---|---|
| `miaoshou` | 对标妙手的数据（同步时写入） | 同步后即有 |
| `aiDraft` | 对标 AI 编辑的数据 | 点击 AI 编辑后生成/更新 |

生命周期：同步 → 只有 `miaoshou`；点击 AI 编辑 → 生成/更新 `aiDraft`（两快照不一致）；保存到妙手后 → 两快照一致（本次不做，但模型支持）；再次 AI 编辑 → `aiDraft` 更新（又不一致）。

**Tech Stack:** Phase 3 技术栈、文本模型 provider、`product_snapshots` 表。

**Spec:** 设计规格第 7 节（本次只实现「AI 生成本地草稿 + 双详情查看」子集；保存妙手/回读/复检属后继子阶段）。

## Global Constraints

- AI 只生成本地草稿；本次不写妙手，任何 AI 编辑保存都不得自动发布。
- 品牌固定为 `Generic`，型号必填，标题最长 60 字符。
- 包裹尺寸/计费重量由 AI 结合标题/描述/图片 + 妙手 skuMap 原尺寸/重量校验预估；所有估算字段带来源和置信度。
- 不做多语言站点标题（`siteAndTitleList`）、类目属性规则、价格。
- 净收益公式未提供前不涉及定价。

---

### Task 1: 双快照模型与商品详情透出尺寸/重量

**Files:** `src/domain/product.ts`, `src/main/ipc/product-detail-mapper.ts`, `tests/unit/product-detail-mapper.test.ts`

- [ ] 在 `ProductDetailSku` 增加 `length`/`width`/`height`/`lengthWidthHeightUnit`/`weight`/`weightUnit` 字段（从妙手 `skuMap` 透出，可能为空）。
- [ ] 更新 `product-detail-mapper.ts` 从 `skuMap` 读取并透出这些字段。
- [ ] 写测试：多 SKU、尺寸/重量存在、尺寸/重量为空。
- [ ] 运行测试，提交 `feat: expose sku package dimensions in product detail`。

### Task 2: 编辑领域模型与 AI 输出 schema

**Files:** `src/domain/edit.ts`, `src/shared/edit-output-schema.ts`, `tests/unit/edit-output-schema.test.ts`

```ts
export type EditDraft = {
  version: number;
  createdAt: string;
  title: EditField;            // ≤60 字符
  description: EditField;
  brand: EditField;            // 固定 Generic
  model: EditField;            // 明确型号直接用；否则从标题/描述挑选
  skus: SkuEditField[];        // 每个 SKU 名称翻译
  package: PackageEditField;   // 长×宽×高 + 单位
  weight: WeightEditField;     // 重量 + 单位
};
export interface EditField { value: string; source: 'remote' | 'ai' | 'user'; confidence: number }
```

- [ ] 写 Zod schema 校验测试：标题≤60、字段必填、坏响应拒绝。
- [ ] 实现 `EditDraft` 领域类型与 schema。
- [ ] 运行测试，提交 `feat: model AI edit draft and output schema`。

### Task 3: AI 编辑生成服务

**Files:** `src/main/services/edit-generation-service.ts`, `tests/unit/edit-generation-service.test.ts`

```ts
export interface EditGenerationService {
  generate(productId: string, signal: AbortSignal): Promise<EditDraft>;
}
```

- [ ] 写测试：prompt 组装（含原尺寸/重量 + 图片 URL）、schema 校验、无 provider 时抛错、坏响应不覆盖已有草稿。
- [ ] 实现服务：读商品详情快照 → 组装 prompt → `provider.generate({prompt, imageUrls}, signal)` → Zod 校验 → 组装 `EditDraft`。
- [ ] 包裹尺寸/重量提示词规则：参考妙手原 skuMap 尺寸/重量 + 图片，校验/预估，标注来源与置信度。
- [ ] 运行测试，提交 `feat: generate AI edit drafts`。

### Task 4: 编辑 IPC 与草稿保存

**Files:** `src/main/ipc/edit-handlers.ts`, `src/shared/ipc-contract.ts`, `src/preload.ts`, `src/main/ipc/register-handlers.ts`, `src/main.ts`, `tests/integration/edit-draft-ipc.test.ts`

- [ ] 定义 IPC 通道：`edit:generate`、`edit:draft`（读当前草稿）、`edit:save-draft`（用户确认后更新 aiDraft 快照）。
- [ ] 写集成测试：生成→读→保存草稿→回读 aiDraft 快照。
- [ ] 实现 handler、preload 暴露、register 挂载、main 装配 `EditGenerationService`。
- [ ] 运行测试，提交 `feat: expose AI edit draft over IPC`。

### Task 5: 工作台双视图编辑面板

**Files:** `src/ui/features/editor/EditPanel.tsx`, `src/ui/pages/WorkbenchPage.tsx`, `tests/ui/edit-panel.test.tsx`

- [ ] 写 UI 测试：生成草稿、妙手详情与 AI 编辑详情切换、逐字段编辑、来源/置信度展示、保存草稿。
- [ ] 实现编辑面板：右侧 `edit` tab 从占位符改为双视图（妙手详情 / AI 编辑详情），字段含标题/描述/品牌/型号/SKU/尺寸/重量。
- [ ] 商品行「编辑」列从「未编辑」→「已编辑」（有 aiDraft 快照时）。
- [ ] 运行 UI 测试，提交 `feat: build dual-view AI edit panel`。

### Task 6: 全量验证与文档同步

**Files:** `docs/acceptance/phase-4-checklist.md`, `docs/superpowers/plans/2026-08-26-mercado-agent-roadmap.md`

- [ ] 跑全量测试 / lint / typecheck / 生产构建。
- [ ] 更新 roadmap 阶段 4 描述：草稿生成已实现，保存妙手/回读/复检待后续。
- [ ] 更新验收清单，提交 `docs: document AI draft generation sub-phase`。

---

## 后继子阶段（本次不实现，保留路线）

- [ ] **保存妙手**：`MiaoshouEditGateway` 只接收已校验 command；成功后强制重新获取详情、保存 readback 快照、字段 diff、触发侵权复检。
- [ ] **多语言站点标题**：`siteAndTitleList` 回读验证与西语主标题降级。
- [ ] **类目属性规则**：必填属性、单品/多 SKU、服装过滤。
- [ ] **SKU 定价与净收益**：净收益公式未提供前只允许人工值，保留策略接口。

## Phase 4 Acceptance Gate（本子阶段）

- [ ] AI 草稿可逐字段人工修改，只生成本地草稿不写妙手。
- [ ] 工作台提供「妙手详情」与「AI 编辑详情」双视图，含来源/置信度标注。
- [ ] 商品从「未编辑」→「已编辑」由 aiDraft 快照驱动。
- [ ] 用户明确确认“阶段 4 草稿生成通过”。
