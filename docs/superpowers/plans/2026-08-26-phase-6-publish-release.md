# Phase 6: 发布队列与发行 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付与编辑完全分离的发布功能、可恢复的妙手异步队列追踪，以及经 macOS/Windows 验证的本地安装包。

**Architecture:** `PublishPreflight` 生成非破坏性检查报告；`PublishService` 创建 attempt 后提交 `detailIds`；`PublishTracker` 只依据妙手列表状态和时间阈值转移；事件时间线与 attempt 永久保存。

**Tech Stack:** Phase 5 技术栈、Electron Forge makers、Playwright、Windows CI runner。

**Spec:** 设计规格第 9、10、13、14、15、16 节；`docs/miaoshou-api/商品/Mercadolibre采集箱/发布产品/发布产品.md`。

## Global Constraints

- 发布只能由用户在产品发布页面明确触发。
- 提交成功只进入 `queued`；只有明确命中 `published` 才进入 `succeeded`。
- 提交后不足 1 小时一律不得推断失败；满 1 小时仍 `notPublished` 仅为 `possibly_failed`。
- 查询异常和三个状态都找不到不得标记成功或确定失败。
- App 关闭不承诺后台运行；重启恢复未完成追踪。

---

### Task 1: 发布前检查纯规则

**Files:** `src/domain/publish.ts`, `src/main/publish/publish-preflight.ts`, `tests/unit/publish-preflight.test.ts`

```ts
export type CheckSeverity = 'info' | 'warning' | 'error';
export interface PublishPreflight { check(product: PublishCandidate): PublishCheckReport }
```

- [ ] 写侵权过期、类目/必填属性、SKU/库存/收益/类型、重量尺寸、图片、站点标题测试。
- [ ] 实现纯规则；侵权风险本身只 warning，缺失必填内容才 error，用户可看到全部问题。
- [ ] 运行测试，提交 `feat: add deterministic publish preflight checks`。

### Task 2: 发布 attempt、事件和严格状态机

**Files:** `src/main/db/migrations/006_publish.sql`, `src/main/repositories/publish-repository.ts`, `src/main/publish/publish-state-machine.ts`, `tests/unit/publish-state-machine.test.ts`, `tests/integration/publish-repository.test.ts`

```ts
export type PublishStatus = 'pending' | 'submitting' | 'submit_failed' | 'queued' | 'possibly_failed' | 'confirmed_failed' | 'succeeded' | 'unknown' | 'abandoned';
export function transitionPublish(input: TransitionInput): PublishTransition;
```

- [ ] 为每个合法/非法转换写表驱动红灯测试，固定阈值 `60 * 60 * 1000`。
- [ ] 实现 `publish_attempts`、`publish_events` 和 append-only 时间线；状态更新和事件插入同事务。
- [ ] 用 fake clock 验证 59:59 queued、60:00 notPublished→possibly_failed、published→succeeded。
- [ ] 运行测试，提交 `feat: persist strict asynchronous publish state machine`。

### Task 3: 妙手发布提交与恢复追踪

**Files:** `src/main/gateways/miaoshou/publish-api.ts`, `src/main/services/publish-service.ts`, `src/main/services/publish-tracker.ts`, `tests/contract/miaoshou-publish-api.test.ts`, `tests/unit/publish-tracker.test.ts`

```ts
export interface PublishTracker { resume(): Promise<void>; poll(attemptId: string, signal: AbortSignal): Promise<PublishAttempt> }
```

- [ ] 从本地文档写仅提交 `detailIds` 的 contract 测试；覆盖即时错误和响应成功。
- [ ] 实现先建 attempt 再提交；接口成功转 queued，错误转 submit_failed。
- [ ] tracker 对账 notPublished/timingPublish/published/missing；网络错误只写事件，不制造终态。
- [ ] App ready 后恢复所有未终态 attempt；运行测试并提交。

### Task 4: 发布页、任务记录与人工确认

**Files:** `src/ui/pages/PublishPage.tsx`, `src/ui/pages/TaskHistoryPage.tsx`, `src/ui/features/publish/*`, `tests/ui/publish-page.test.tsx`, `tests/e2e/publish-queue.spec.ts`

- [ ] 写 UI 测试覆盖独立发布确认、批量仅接收通过 preflight、倒计时、状态文字、打开妙手、确认失败原因、放弃追踪。
- [ ] 实现只读队列详情和事件时间线；进入队列的商品不可编辑，确认失败后才可重新编辑。
- [ ] “打开妙手”只打开已配置的官方页面；人工失败必须二次确认并保存备注。
- [ ] 运行 UI/E2E 测试，提交 `feat: build asynchronous publish queue and task history`。

### Task 5: 真实队列行为验收

**Files:** `docs/acceptance/phase-6-live-publish.md`, `scripts/verify-publish-lifecycle.ts`

- [ ] 用可发布测试商品验证提交成功时 UI 只显示队列中。
- [ ] 记录商品在 notPublished/timingPublish/published 的真实变化；检查是否存在文档未说明的失败信号，仅记录不依赖私有网页接口。
- [ ] 验证 published 命中才成功；准备一个可控失败样例验证满 1 小时后的“可能失败”和人工确认。
- [ ] 验证 App 退出再启动后继续追踪；如果真实状态与设计不同，停下调整状态 mapper 后重验。
- [ ] 提交 `test: verify live Miaoshou publish lifecycle`。

### Task 6: macOS、Windows 打包与最终验收

**Files:** `forge.config.ts`, `.github/workflows/build-installers.yml`, `tests/e2e/critical-path.spec.ts`, `docs/acceptance/final-release-checklist.md`, `README.md`

- [ ] 先写关键路径 E2E：配置→同步→侵权→编辑保存回读→图片上传→独立发布→重启恢复。
- [ ] 配置 macOS DMG/ZIP 和 Windows Squirrel 安装产物；不把任何凭证打入包。
- [ ] 在 macOS 实机安装运行；在 Windows runner 构建，并在 Windows 测试机或 runner GUI 环境完成启动/SQLite/网络烟测。
- [ ] 运行 `npm test`、lint、typecheck、E2E、`npm run make`，保存输出和产物校验值。
- [ ] 扫描 secret、TODO/TBD/FIXME/placeholder、调试日志和开发 URL；处理全部阻断项。
- [ ] 按最终规格逐条自审，提交 `release: prepare Mercado Agent desktop acceptance build`，停止等待最终验收。

## Phase 6 Acceptance Gate

- [ ] 编辑不会自动发布，发布前有独立确认和完整检查报告。
- [ ] 接口 success 显示队列中；1 小时规则和成功终态严格正确。
- [ ] 发布失败可人工确认并留原因，重启可恢复追踪。
- [ ] macOS 和 Windows 安装包都在目标系统实际启动并运行关键烟测。
- [ ] 所有阶段验收文档、已知限制和降级行为已交付。
- [ ] 用户明确确认“阶段 6 / 首版通过”。
