# Phase 2: 妙手同步与工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 读取妙手 Mercadolibre 采集箱并交付不会因远端状态变化而丢历史的本地工作台。

**Architecture:** `MiaoshouGateway` 只处理签名与 DTO；应用服务把 DTO 归一化为领域快照；Repository 事务保存当前生命周期与不可变快照；renderer 通过分页查询 IPC 展示。

**Tech Stack:** Phase 1 技术栈、Zod、原生 `fetch`。

**Spec:** 设计规格第 4、5、12、13、14、15 节；`docs/miaoshou-api/商品/Mercadolibre采集箱/采集箱/`。

## Global Constraints

- 默认只请求/显示 `notPublished`，用户可切换未发布、定时发布、已发布历史、全部记录。
- 远端消失只改变状态，不删除本地商品、快照或历史。
- 未进入 `published` 不得显示为发布成功。
- 本阶段只读妙手，不编辑、不发布。

---

### Task 1: 妙手签名客户端与 DTO 校验

**Files:** `src/main/gateways/miaoshou/*`, `src/shared/miaoshou-schemas.ts`, `tests/unit/miaoshou-signature.test.ts`, `tests/contract/miaoshou-responses.test.ts`

```ts
export interface MiaoshouGateway {
  listCollectBox(input: ListCollectBoxInput): Promise<CollectBoxPageDto>;
  getCollectBoxDetail(detailId: string): Promise<CollectBoxDetailDto>;
}
```

- [ ] 从本地 API 文档提取固定请求/响应 fixture，先写签名顺序、时间戳、错误码和坏响应红灯测试。
- [ ] 实现请求签名、超时、脱敏日志、Zod 响应校验；禁止把 App Secret 放入 renderer。
- [ ] 运行定向测试、typecheck，提交 `feat: add validated Miaoshou collect-box client`。

### Task 2: 商品、快照与同步状态 Repository

**Files:** `src/main/db/migrations/002_products.sql`, `src/domain/product.ts`, `src/main/repositories/product-repository.ts`, `src/main/repositories/snapshot-repository.ts`, `tests/integration/product-sync-repository.test.ts`

```ts
export type MiaoshouProductState = 'notPublished' | 'timingPublish' | 'published' | 'missing';
export interface ProductRepository {
  upsertRemoteIdentity(product: RemoteProductIdentity): Product;
  transition(id: string, state: MiaoshouProductState, at: string): void;
  page(query: ProductPageQuery): ProductPage;
}
```

- [ ] 写迁移与状态转换测试，覆盖 notPublished→timingPublish→published、三处均未命中→missing、重现时恢复。
- [ ] 实现 `products`、`product_snapshots` 严格表和事务；快照只插入不覆盖。
- [ ] 运行集成测试并扫描 SQL 边界，提交 `feat: persist product lifecycle and immutable snapshots`。

### Task 3: 三状态对账同步服务

**Files:** `src/main/services/product-sync-service.ts`, `src/main/ipc/product-handlers.ts`, `tests/unit/product-sync-service.test.ts`

```ts
export interface ProductSyncService {
  syncDefault(signal: AbortSignal): Promise<SyncSummary>;
  reconcileTracked(productIds: string[], signal: AbortSignal): Promise<SyncSummary>;
}
```

- [ ] 用 fake gateway 写分页、单品失败不终止批次、远端去重、三个状态对账和取消测试。
- [ ] 最小实现默认同步 notPublished；只对本地曾跟踪但消失的商品补查 timingPublish/published。
- [ ] 每个商品在同一事务更新身份、状态、快照和同步事件；运行测试并提交 `feat: reconcile Miaoshou product lifecycle`。

### Task 4: A 列表工作台与本地历史

**Files:** `src/ui/pages/WorkbenchPage.tsx`, `src/ui/features/workbench/*`, `tests/ui/workbench-page.test.tsx`

- [ ] 先写 UI 红灯测试：默认未发布、四状态 tab、分页、行选择、右侧快速检查、同步失败逐商品提示。
- [ ] 实现高密度列表；暂未实现的侵权/编辑列显示“未检测/未编辑”，不伪造结果。
- [ ] 双击进入只读详情概要；timingPublish/published/missing 明确只读与最后同步时间。
- [ ] 运行 UI 测试和 1280×800 视觉检查，提交 `feat: build synchronized product workbench`。

### Task 5: 真实妙手账号契约验收

**Files:** `scripts/verify-miaoshou-read.ts`, `docs/acceptance/phase-2-checklist.md`, `tests/e2e/workbench-sync.spec.ts`

- [ ] 使用用户输入凭证读取测试商品列表/详情，不把响应和凭证提交到 Git。
- [ ] 记录字段差异、分页行为、状态枚举和详情可读性；据实更新 Zod schema 和 mapper。
- [ ] 模拟本地已有商品远端消失，验证历史保留且标记 missing。
- [ ] 跑全量测试、打包、占位扫描，提交 `test: verify phase two Miaoshou synchronization`，停止等待验收。

## Phase 2 Acceptance Gate

- [ ] 真实未发布商品出现在工作台，列表和详情关键字段一致。
- [ ] 未发布、定时发布、已发布历史、全部记录可区分。
- [ ] 状态变化和远端暂时查不到不会删除本地历史。
- [ ] 日志及 UI 不暴露妙手 Secret。
- [ ] 用户明确确认“阶段 2 通过”。
