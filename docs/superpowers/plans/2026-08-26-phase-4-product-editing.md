# Phase 4: 产品编辑 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生成可人工修改的本地 AI 草稿，保存到妙手后逐字段回读验证，并对实际保存内容自动执行侵权复检。

**Architecture:** `EditDraftService` 生成领域草稿；字段估算保留来源/置信度；`MiaoshouEditGateway` 只接收已校验 command；保存后重新读取并由 diff service 比较；最终回读快照触发 V2 检测。

**Tech Stack:** Phase 3 技术栈、妙手类目/编辑 API。

**Spec:** 设计规格第 7、9、13、14、15 节；妙手类目推荐和产品编辑 Skill 仅作参考。

## Global Constraints

- AI 只生成本地草稿；必须由用户点击保存才写妙手。
- 品牌固定为 `Generic`，型号必填，标题最长 60 字符。
- 主标题西班牙语；MX/AR 西语覆盖，BR 葡语覆盖；描述只有一份时用西语。
- 服装不走尺码表；争议字段必须显示来源和置信度。
- 净收益公式未提供前只允许人工值，并保留策略接口，绝不猜公式。

---

### Task 1: 编辑领域模型、草稿和字段差异

**Files:** `src/domain/edit.ts`, `src/main/db/migrations/004_edit_sessions.sql`, `src/main/repositories/edit-session-repository.ts`, `src/main/services/product-diff.ts`, `tests/unit/product-diff.test.ts`, `tests/integration/edit-session.test.ts`

```ts
export interface Estimated<T> { value: T; source: 'remote' | 'ai' | 'user'; confidence: number; disputed: boolean }
export interface NetProceedsStrategy { calculate(input: NetProceedsInput): NetProceedsResult }
```

- [ ] 写草稿不可变版本、用户覆盖优先级和字段级 diff 红灯测试。
- [ ] 实现 `edit_sessions`、草稿序列化、来源/置信度及策略接口；提供 `ManualNetProceedsStrategy`，拒绝空值。
- [ ] 运行测试，提交 `feat: model versioned edit drafts and field provenance`。

### Task 2: 类目、属性与商品规则服务

**Files:** `src/main/gateways/miaoshou/category-api.ts`, `src/main/services/category-service.ts`, `src/main/services/product-rule-service.ts`, `tests/contract/category-api.test.ts`, `tests/unit/product-rule-service.test.ts`

- [ ] 从本地文档构造 fixture，测试类目属性必填、单品/多 SKU、品牌/型号、服装过滤和未知规则。
- [ ] 实现类目规则归一化；只填写确定属性，不确定项留空并警告。
- [ ] 包裹规则计算实际重量/体积重，最终超过 3000g 标记不推荐但不锁死。
- [ ] 实现刊登类型：净收益 >3 USD 时 MX/BR 铂金，否则经典；AR 永远经典；运行测试并提交。

### Task 3: 多语言 AI 编辑生成

**Files:** `src/main/edit/edit-generation-service.ts`, `src/shared/edit-output-schema.ts`, `tests/unit/edit-generation-service.test.ts`

```ts
export interface EditGenerationService {
  createDraft(input: ProductEditContext, signal: AbortSignal): Promise<EditDraft>;
}
```

- [ ] 写结构化输出测试：60 字符、MX/AR 西语、BR 葡语、西语描述、SKU 名称、Generic、必填型号、坏响应不覆盖原值。
- [ ] 实现提示词、Zod schema 和合并规则；重量尺寸争议阈值必须由纯规则产生。
- [ ] 运行测试和三 provider contract，提交 `feat: generate localized Mercado Libre edit drafts`。

### Task 4: 保存妙手、回读验证与 V2 复检

**Files:** `src/main/gateways/miaoshou/edit-api.ts`, `src/main/services/save-edit-service.ts`, `tests/contract/miaoshou-edit-api.test.ts`, `tests/integration/save-readback-rescan.test.ts`

```ts
export interface SaveEditService {
  save(detailId: string, draftId: string, signal: AbortSignal): Promise<SaveVerification>;
}
```

- [ ] 写测试覆盖保存失败、回读失败、字段不一致、`siteAndTitleList` 丢失降级和成功后 V2。
- [ ] 实现保存 command 映射；成功后强制重新获取详情、保存 readback 快照、字段 diff、触发侵权复检。
- [ ] 若站点标题未保留，保存能力标记并显示全站使用西语主标题；运行测试并提交。

### Task 5: 完整产品编辑页与真实写入验收

**Files:** `src/ui/pages/ProductEditorPage.tsx`, `src/ui/features/editor/*`, `tests/ui/product-editor.test.tsx`, `tests/e2e/edit-save-readback.spec.ts`, `docs/acceptance/phase-4-checklist.md`

- [ ] 写 UI 测试覆盖基础信息、类目属性、SKU 定价、争议标记、AI 变更记录、保存确认和回读差异。
- [ ] 实现单个与批量 AI 编辑；批量中单品失败不终止。
- [ ] 用测试商品实测类目必填属性、单/多 SKU、`siteAndTitleList`、保存详情结构与已发布详情可读性。
- [ ] 用户提供净收益公式后，先补策略契约测试再实现；未提供则将自动定价明确列为未解锁，不阻塞其他编辑验收。
- [ ] 跑全量测试/构建/占位扫描，提交并停止等待验收。

## Phase 4 Acceptance Gate

- [ ] AI 草稿可逐字段人工修改，保存动作明确且不发布。
- [ ] 妙手回读验证显示真实一致/不一致结果。
- [ ] 站点标题真实能力已经验证并正确降级。
- [ ] 保存后用回读内容自动生成当前有效 V2。
- [ ] 净收益公式已实现并验收，或用户明确接受暂时人工填写。
- [ ] 用户明确确认“阶段 4 通过”。
