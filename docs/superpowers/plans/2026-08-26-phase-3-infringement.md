# Phase 3: 侵权检测 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对妙手原始商品先做可解释、版本化、不会自动阻止用户操作的多模态侵权检测。

**Architecture:** 确定性本地规则先处理服装与受限品牌，再由 active `TextModelProvider` 同时接收文本和图片；结构化结果标准化为不可变 run，并以风险字段指纹判断有效性。

**Tech Stack:** Phase 2 技术栈、各模型官方 HTTP API、Zod structured output。

**Spec:** 设计规格第 6、13、14 节；`docs/美客多受限商品品牌列表.md`。

## Global Constraints

- 风险等级仅为无/低/中/高，结果仅提示。
- 兼容配件判断优先于受限品牌本体高风险规则。
- 修改标题、描述、品牌、类目、相关属性、SKU 名称或图片会使旧结果过期；价格等字段不会。
- 每次 run 永久保留，不更新旧 run 内容。

---

### Task 1: 受限品牌快照与风险指纹

**Files:** `src/main/risk/restricted-brands.ts`, `src/main/risk/fingerprint.ts`, `tests/unit/restricted-brands.test.ts`, `tests/unit/risk-fingerprint.test.ts`

```ts
export type RiskLevel = 'none' | 'low' | 'medium' | 'high';
export function riskFingerprint(input: RiskRelevantProduct): string;
```

- [ ] 写测试确认本地 99 个品牌可稳定解析，品牌大小写/标点归一化，非风险字段变化不改指纹。
- [ ] 实现内置只读品牌数据和 canonical JSON SHA-256 指纹；运行测试并提交。

### Task 2: 兼容配件与服装确定性规则

**Files:** `src/main/risk/local-rules.ts`, `tests/unit/local-risk-rules.test.ts`

- [ ] 写样例：品牌本体高风险、Generic 兼容配件不因品牌词直接高风险、Logo/官方授权暗示提高风险、服装过滤。
- [ ] 实现返回 `ruleHits` 和待 AI 复核上下文的纯函数；不在规则中自动阻止。
- [ ] 运行测试，提交 `feat: add restricted-brand accessory and clothing rules`。

### Task 3: 多模态 Provider 适配器与结构化检测

**Files:** `src/main/providers/text/{doubao,deepseek,openai}.ts`, `src/main/risk/infringement-engine.ts`, `src/shared/infringement-schema.ts`, `tests/contract/text-provider-contract.test.ts`, `tests/unit/infringement-engine.test.ts`

```ts
export interface InfringementEngine {
  analyze(product: RiskRelevantProduct, signal: AbortSignal): Promise<InfringementDecision>;
}
```

- [ ] 用统一 contract 测试三种 provider 的图文请求、超时、坏 JSON、未知等级和证据缺失。
- [ ] 实现 provider adapter 与 Zod 解析；提示词要求区分品牌本体和兼容配件，并引用可见图片证据。
- [ ] 合并本地规则与 AI 决策，不允许 AI 把确定品牌本体从高风险静默降级；运行测试并提交。

### Task 4: 不可变检测历史与过期机制

**Files:** `src/main/db/migrations/003_infringement.sql`, `src/main/repositories/infringement-repository.ts`, `src/main/services/infringement-service.ts`, `tests/integration/infringement-history.test.ts`

- [ ] 写 V1/V2、当前有效、旧版过期、重复相同指纹和单品失败批次继续测试。
- [ ] 实现 `infringement_runs` 插入式 Repository；同指纹最新完成 run 才是当前结果。
- [ ] 实现单个/批量检测服务及逐商品进度事件；运行测试并提交。

### Task 5: 侵权检测页面与阶段验收

**Files:** `src/ui/pages/InfringementPage.tsx`, `src/ui/features/infringement/*`, `tests/ui/infringement-page.test.tsx`, `tests/e2e/infringement-flow.spec.ts`, `docs/acceptance/phase-3-checklist.md`

- [ ] 写 UI 测试覆盖风险标签、证据、规则命中、V1/V2 差异、已过期、继续编辑按钮和批量进度。
- [ ] 实现页面；继续编辑只记录用户选择，不改变风险原结论。
- [ ] 用迪士尼品牌本体、Generic 拓竹兼容配件、普通无品牌商品、服装商品四个验收样例跑真实模型。
- [ ] 跑全量测试/构建/占位扫描，记录模型偏差，提交并停止等待验收。

## Phase 3 Acceptance Gate

- [ ] 原始商品先检测并形成不可变 V1。
- [ ] 受限品牌本体高风险，合规兼容配件不会仅因品牌词判高。
- [ ] 图片参与判断且证据可读；风险不阻止用户继续。
- [ ] 风险字段变化会正确过期，非风险字段变化不会。
- [ ] 用户明确确认“阶段 3 通过”。
