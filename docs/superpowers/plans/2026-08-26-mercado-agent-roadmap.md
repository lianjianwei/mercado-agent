# Mercado Agent 分阶段实施与验收路线图

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把已确认的桌面应用设计拆成六个可独立运行、可独立验收、可在发现偏差时停止调整的交付阶段。

**Architecture:** Electron 主进程持有 SQLite、网络、文件与任务调度能力；React 渲染进程只通过类型化 IPC 调用应用服务；领域服务通过 Repository 和 Provider 接口隔离妙手、模型、七牛及未来数据库替换。

**Tech Stack:** Electron 44（内置 Node 24，支持 `node:sqlite`）、Electron Forge、Vite、React、TypeScript、Vitest、React Testing Library、Playwright、Zod、Sharp、七牛 Node SDK。

**Spec:** `docs/superpowers/specs/2026-08-26-mercado-agent-desktop-design.md`

## Global Constraints

- 纯本地应用，不新增服务端、登录系统或远程数据库。
- 所有凭证无默认值，由用户输入并明文保存到本地 SQLite；界面必须持续提示这一点。
- 编辑和发布严格分离；任何 AI 编辑保存都不得自动发布。
- 侵权、类目、尺寸、重量提示只做风险标记，不擅自替用户决策。
- 发布接口成功只代表进入妙手队列；只有在 `published` 查询结果中命中才算成功。
- 发布满 1 小时仍为 `notPublished` 只能标记“可能失败”。
- 本地历史不可因妙手列表状态变化或临时查询不到而删除。
- 文本/多模态模型与生图模型独立配置、独立启用。
- 不实现服装尺码表；识别为服装时标记过滤提示。
- 每阶段完成时先停下，交付验收清单和证据；用户明确通过后才开始下一阶段。
- 每个实现任务遵循红灯测试、最小实现、绿灯测试、局部提交。

---

## 阶段总览

| 阶段 | 可独立验收的结果 | 真实账号依赖 | 进入下一阶段的门槛 |
|---|---|---|---|
| 1. 应用骨架与配置 | 可安装/启动的桌面壳、SQLite、配置页、连接测试框架 | 可用测试凭证验证更好，但不阻断本地验收 | macOS 启动、配置重启保留、凭证无默认值、诊断通过 |
| 2. 妙手同步与工作台 | 能读取未发布商品、保存本地快照、展示四种列表和生命周期 | 妙手 App Key/Secret | 列表/详情真实读取成功，状态变化不丢历史 |
| 3. 侵权检测 | 原始商品先检测，保存不可变 V1/V2、证据与过期状态 | 至少一个可看图的文本模型配置 | 受限品牌、兼容配件、服装过滤和图片判断符合样例 |
| 4. 产品编辑 | AI 草稿、字段修改、保存妙手、回读差异、自动复检 | 妙手写入权限；净收益公式在定价任务前提供 | 标题/描述/属性/SKU 保存并回读；站点标题能力实测 |
| 5. 图片工作区 | 参考图生图、规则检查、压缩、七牛上传、保存妙手 | 生图模型、七牛、妙手测试商品 | SKU 主图区分、详情图复用、外链保存回读成功 |
| 6. 发布队列与发行 | 独立发布、异步状态机、恢复追踪、macOS/Windows 安装包 | 可发布的测试商品 | 1 小时规则、成功判定、人工失败、安装包验收全部通过 |

## 分阶段文档

1. `docs/superpowers/plans/2026-08-26-phase-1-foundation-config.md`
2. `docs/superpowers/plans/2026-08-26-phase-2-miaoshou-workbench.md`
3. `docs/superpowers/plans/2026-08-26-phase-3-infringement.md`
4. `docs/superpowers/plans/2026-08-26-phase-4-product-editing.md`
5. `docs/superpowers/plans/2026-08-26-phase-5-image-workspace.md`
6. `docs/superpowers/plans/2026-08-26-phase-6-publish-release.md`

## 统一验收流程

- [ ] 自动测试：单元、Repository 集成、UI 组件及该阶段关键端到端流程全部通过。
- [ ] 静态检查：TypeScript、lint、格式检查和生产构建通过。
- [ ] 数据检查：重启应用后状态仍存在；迁移可从空库重复执行。
- [ ] 界面检查：使用真实窗口尺寸核对已确认的 A 列表工作台视觉。
- [ ] 异常检查：断网、无凭证、API 错误、模型坏响应均有可理解提示。
- [ ] 真实账号检查：凡阶段涉及妙手、模型或七牛，执行对应的最小写入/回读测试。
- [ ] 验收交付：提供安装/运行方式、截图、测试结果、已知限制和待用户决定项。
- [ ] 用户明确回复阶段通过后，才解锁下一阶段。

## 已知外部依赖与停止条件

- 阶段 4 的自动净收益计算在用户提供正式公式前停止在 `NetProceedsStrategy` 接口与人工输入模式，不猜测公式。
- `siteAndTitleList` 如果真实回读不保留，立即启用西班牙语主标题降级方案，不在本地伪装成站点标题已生效。
- 七牛公开 URL 如果妙手拒绝，阶段 5 停止并记录格式差异，不自动购买或启用妙手图片管理。
- 妙手没有发布结果接口时继续使用已确认的列表对账与人工确认方案，不抓取网页私有接口。
- Windows 安装包必须在 Windows 环境或 CI 的 Windows runner 上验证，不以 macOS 上“打包成功”代替运行验收。

## 版本与兼容性依据

- Electron 44 内置 Node 24.18.1，满足 `node:sqlite` 自 Node 22.5.0 起可用的运行时要求。
- 使用 Electron Forge 官方 `vite-typescript` 模板；因为 Forge 的 Vite 插件仍标注实验性，锁定依赖和 lockfile，并以生产打包测试防止小版本漂移。
- 最终依赖版本以阶段 1 首次通过的 `package-lock.json` 为唯一来源，后续阶段不自动升级主版本。
