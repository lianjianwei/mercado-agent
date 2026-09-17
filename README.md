# Mercado Agent

> 对接妙手 ERP「Mercadolibre 采集箱」的**纯本地 Electron 桌面应用**，把美客多（Mercado Libre）商品的
> **侵权检测 → AI 编辑（文本 + 生图 + 净收益）→ 发布跟踪**串成一条可复核的工作流。

当前版本：`0.1.0`　平台：macOS / Windows　最后验证：2026-09-17（`npm test` 72 个文件 / 439 项全通过）

---

## 1. 这个项目解决什么问题

用户通过妙手浏览器插件把 1688 商品采集进妙手，然后在妙手后台手工删 SKU、改类目、调货源价、选参考图。
剩下的重复劳动——**判断侵权风险、写西语/葡语标题描述、估包裹尺寸重量、算每个站点的净收益、按规则出图并上传 CDN**——
由本应用批量完成，且**只做提示和草稿，不替用户做决定、不自动发布**。

应用**不负责** 1688 选品与采集。

### 三条核心流程是严格分离的

| 流程 | 做什么 | 是否自动触发 |
|---|---|---|
| 侵权检测 | 分析妙手**原始**商品，给出风险等级 + 证据 | 用户手动发起（单个 / 批量） |
| 产品编辑 | AI 生成本地草稿 → 用户逐项修改 → 手动「保存到妙手」 | 不自动保存、**绝不自动发布** |
| 产品发布 | 用户单独发起，跟踪妙手异步队列 | 发布阶段尚未实现（见 §6） |

### 贯穿全局的约束

- **纯本地**：无服务端、无登录、无远程数据库。
- **凭证无默认值**：妙手 / 七牛 / 模型的 Key 全部由用户自己填，明文存本地 SQLite，界面持续提示这一点。
- **风险只提示**：侵权、类目、重量尺寸、图片问题一律只做标记，不擅自替用户决策。
- **不丢历史**：本地记录不因妙手列表状态变化或临时查不到而删除。

---

## 2. 已实现的功能

### 2.1 模型与凭证配置

- **文本 / 多模态模型**：豆包、DeepSeek、OpenAI 三种 provider，可保存多套配置，同一用途只有一个启用项；
  支持自定义 Base URL、模型名、推理强度。
- **生图模型**：与文本模型完全独立配置，支持 OpenAI（`/images/edits` 图生图）与**本地 codex CLI**
  （调用本机 `codex exec`，无需 API Key）。
- **妙手凭证**：App Key / App Secret / Base URL（由同步流程实际验证）。
- **七牛云凭证**：Access Key / Secret Key / Bucket / 公开域名 / 区域（由上传流程实际验证）。
- **模型网络代理**：可让文本与生图模型流量走指定 HTTP 代理，在**独立 Electron session** 中隔离，
  不影响应用其它网络请求。
- **帮助与诊断**：查看数据库路径、网络出口（直连 / 代理）、四类凭证的配置完整度，
  并对文本 / 生图模型逐项「测试连接」，诊断日志可复制。
  （目前连接测试只覆盖模型 provider，妙手与七牛由实际同步 / 上传验证。）

### 2.2 妙手同步与工作台

- 一键同步妙手 `notPublished` 商品（列表 + 逐商品详情），**每条商品写入不可变快照**。
- 同步以终端式滚动日志实时展示：第几页、每条商品结果、失败原因、重试、耗时。
- 网络 / 超时 / 限流类错误自动重试 1 次；业务错误不重试、直接记录。
- 商品列表列：选择框 / 商品 / 类目 / 净收益 / 库存 / 站点 / 货源价 / **本地发布** / 侵权 / 编辑 / 操作；支持分页与多选。
- 状态页签：**未发布** / **本地已发布**。表格含「本地发布」列与本地发布时间。
- 右侧检查面板三个页签：**快速检查** / **侵权检测** / **发布**。
- 日志面板分类：同步日志 / 侵权检测日志 / 发布日志，每类独立保留最多 500 行。
- 「清理数据」按钮：清空商品、快照与侵权记录，**保留**凭证、代理与模型配置。

### 2.3 侵权检测

- **本地受限品牌快照**：99 个受限品牌，大小写 / 标点不敏感，支持别名展开（`AP`↔Audemars Piguet 等）。
- **确定性本地规则**先跑：品牌本体 → 高风险；`Generic` 兼容配件不因品牌词直接判高、转 AI 复核；
  仿冒 / 复刻表述提级；服装敏感类目命中受限品牌判高。
- **多模态 AI 判定**：豆包 / DeepSeek / OpenAI 统一 OpenAI 兼容图文请求，提示词要求区分
  「品牌本体 vs 第三方兼容配件」并引用可见图片证据。
- **内容指纹**（canonical JSON SHA-256）：标题、品牌、类目、属性、SKU 名、图片变化才失效；
  价格、库存、净收益、重量尺寸变化**不**导致结果过期。
- **不可变版本历史**：指纹不变则复用现有结果；指纹变化则版本递增（V1 → V2），旧版本永久保留。
- **批量检测**：并发 3 个，单商品失败不终止整批，逐商品报告失败。

### 2.4 AI 编辑草稿（文本）

- 读取最新妙手快照 → 组装 prompt → 模型生成 → **Zod 严格结构化校验** → 草稿。
- 字段：标题（≤60 字符，站点语言）、描述、品牌（固定 `Generic`）、型号、SKU 名称翻译、
  包裹尺寸（长×宽×高 + 单位）、计费重量（+ 单位）。
- 每个字段带 `source`（remote / ai / user）与 `confidence`（0–1）；用户改过即标「人工修改」、置信度置 1。
- 坏响应（标题超 60、缺字段、多余字段、置信度越界）**拒绝且不覆盖已有草稿**。
- **双快照模型**：`miaoshou` 快照对标妙手原始数据，`aiDraft` 快照对标 AI 编辑结果；
  商品列表的「已编辑 / 未编辑」由 `aiDraft` 驱动。
- **双视图对照**：编辑弹窗内可切换「妙手详情」与「AI 编辑详情」，逐字段对照。
- 「保存草稿」只写本地 `aiDraft` 快照，**不触碰妙手**。

### 2.5 保存回妙手

- 以**妙手原始数据为底、草稿字段增量覆盖**的方式构造完整 `siteCollectItemInfo`
  （妙手保存接口要求整包必传，因此只覆盖用户真正编辑过的字段，其余保留原值，降低写坏平台数据的风险）。
- 保存前弹**变更清单确认框**，用户确认后才发请求。
- 覆盖范围：标题 / 描述 / 品牌 / 型号 / SKU 名称 / 包裹尺寸重量 / 站点净收益 / 产品类型 / 图片。

### 2.6 净利润计算器（本地计算，不依赖 AI）

- 按 **每 SKU × 每站点**算出净收益与产品类型，字段结构**与妙手完全一致**
  （`siteAndPriceMap` / `siteAndListingTypeInfoMap`），保存时逐字段直映射。
- **产品类型规则**：货源价 < 10 元 且 重量 < 200g → 经典（`gold_special`），否则铂金（`gold_pro`）；
  **阿根廷（AR）强制经典**。
- **运费阶梯表**：内置 MX / BR / AR 三站，按计费重与售价阈值核价预估（非实时账单）。
- **汇率**：主进程拉取 + 本地缓存（带时间戳），失败降级到缓存 / 内置默认值。
- 全球净收益 = 所有 SKU 所有站点净收益的最大值（对齐妙手回退默认值）。
- 工作台提供「利润率配置」弹窗（目标利润率、口径、经典/铂金佣金、打包费）。
- 计算方法学见 [`docs/美客多净利润计算器.md`](docs/美客多净利润计算器.md)。

### 2.7 AI 生图与七牛回写

- **每个 SKU 主图**：取该 SKU 第 1 张参考图生成白底主图。
- **详情图**：由多模态模型按类目 / 标题 / 描述 / 参考图**规划 4 张**，仅基于第一个 SKU 的参考图，
  所有 SKU 共用；参考图中没有的步骤或内容禁止生成。
- **AI 自检**：每张生成图由多模态模型复查是否虚构 / 与产品不符 / 异常，不合格则重生成，**每图最多再试 2 次**；
  单图失败隔离，不阻断其它图，最终汇总为 `partial`。
- **本地落盘**：`<用户数据目录>/images/<商品ID>/<可读文件名>.png`（如 `main-1.png`、详情图带序号），
  OpenAI 返回的临时 URL 不作依赖。
- **压缩**：`nativeImage` 等比缩放 + PNG IDAT zlib level 9 压缩，不引原生依赖，压缩失败自动回退不阻断上传。
- **七牛上传**：官方 qiniu SDK 表单上传，公网 URL **回写草稿**，保存时随草稿写入妙手。
- **重新生成**：可多选图片单独重生成，每张图可带独立的补充提示词。
- **恢复已生成图片**：不重新生成，直接把之前已上传的公网 URL 重新写回草稿。
- **上传已有图片**：跳过生成，仅把已有图片上传七牛。

---

## 3. 技术栈

| 层 | 选型 |
|---|---|
| 运行时 | Electron 44（内置 Node 24，用 `node:sqlite`） |
| 构建 | Electron Forge + Vite |
| 界面 | React 19 + TypeScript 6（strict） |
| 校验 | Zod 4（所有 IPC 入参与模型输出结构化校验） |
| 存储 | SQLite（`node:sqlite`）+ 集中式迁移脚本 |
| 测试 | Vitest（单元 / 集成 / 组件）、React Testing Library、Playwright（Electron E2E） |
| 质量 | ESLint 10、`tsc --noEmit` |
| 外部 | 妙手开放 API、豆包 / DeepSeek / OpenAI、七牛云 SDK、本机 codex CLI |

### 架构分层

```
src/renderer.tsx        React 渲染层（nodeIntegration:false / contextIsolation:true / sandbox:true）
   │  仅通过类型化 IPC（src/shared/ipc-contract.ts）调用主进程
   ▼
src/main/ipc/*          IPC handler：Zod 校验 → 调用 service → 统一 { ok, data | error } 返回
src/main/services/*     领域服务：编辑生成、生图编排、净收益、侵权、同步、七牛、压缩
src/main/providers/*    Provider 适配器：文本 / 多模态 / 生图，按配置派发
src/main/gateways/*     妙手网关：签名、限流间隔、字段映射
src/main/repositories/* Repository 隔离 SQLite，对外只暴露领域对象
src/domain/*            领域类型与纯函数（无 IO）
```

关键设计：**主进程持有数据库、网络、文件与任务编排；渲染进程不碰 Node，也不写 SQL。**

---

## 4. 目录结构

```
src/
  domain/            领域类型（config / edit / images / infringement / net-profit / product / providers / proxy）
  main/
    db/              SQLite 连接与迁移（migrations/*.sql）
    gateways/        miaoshou 网关（签名、HTTP、错误映射）
    ipc/             各模块 IPC handler 注册
    network/         模型网络客户端与代理隔离 session
    providers/       text（doubao / deepseek / openai）、image（openai / codex）
    qiniu/           七牛区域与域名
    repositories/    products / snapshots / credentials / provider-config / fx-rate / infringement
    risk/            受限品牌、本地规则、风险指纹、风险相关字段映射
    services/        编辑生成、生图编排、图片规划/自检/压缩、净收益引擎、同步、七牛上传、保存回写
  shared/            主进程与渲染层共享的 IPC 契约与 Zod schema
  ui/                React 页面、组件与 features（editor / netprofit / settings）
docs/
  superpowers/specs/     设计规格（桌面应用总设计、生图、净收益、网络代理）
  superpowers/plans/     分阶段实施计划（含 6 阶段路线图）
  acceptance/            各阶段验收记录
  miaoshou-api/          妙手开放接口文档（本地参考）
  *.md                   净利润计算器算法、受限品牌列表
scripts/                 妙手只读契约验收脚本、SKU 结构探针
skills/                  妙手官方三个 Skill（类目推荐 / 商品编辑 / 商品发布），仅作接口行为参考
tests/                   unit / integration / ui / contract / smoke / e2e
```

---

## 5. 快速开始

```bash
npm install

# 开发运行（Electron + Vite 热更新）
npm start

# 代码质量
npm test            # Vitest：72 个文件 / 439 项
npm run typecheck   # tsc --noEmit
npm run lint        # ESLint

# 打包
npm run package     # 生成 out/ 下的可运行应用
npm run make        # 生成安装包（macOS: zip / Windows: squirrel）

# Electron 端到端测试（先 package 再跑 Playwright）
npm run test:e2e        # = npm run package && playwright test
npm run test:e2e:run    # 已打包时只跑 Playwright

# 妙手真实账号「只读」契约验收（不写凭证、不记录响应正文）
RUN_MIAOSHOU_READ_ACCEPTANCE=1 npm run verify:miaoshou-read
```

> ⚠️ 首次启动时**所有凭证均为空**，需要到「模型与凭证」页自行填写。凭证当前为**本地明文存储**，
> 界面会持续提示这一点。

### 本地数据位置

- 数据库：`<用户数据目录>/mercado-agent.sqlite3`
  （macOS：`~/Library/Application Support/Mercado Agent/`）
- 生成的图片：`<用户数据目录>/images/<商品ID>/`

---

## 6. 当前完成进度

路线图把交付拆成 6 个可独立验收的阶段（见
[`docs/superpowers/plans/2026-08-26-mercado-agent-roadmap.md`](docs/superpowers/plans/2026-08-26-mercado-agent-roadmap.md)）。

| 阶段 | 内容 | 状态 |
|---|---|---|
| 1 | 应用骨架与配置（SQLite、配置页、连接测试、网络代理） | ✅ 已验收 2026-08-27 |
| 2 | 妙手同步与工作台（未发布商品、快照、生命周期） | ✅ 已验收 2026-08-27 |
| 3 | 侵权检测（受限品牌、指纹、不可变版本、批量 + AI 判定） | ✅ 已验收 2026-08-27；含 4 轮 Phase 3.5 追加改造 |
| 4 | 产品编辑（AI 草稿、双视图、净收益、保存回妙手） | 🟡 主体完成，见下方未完项 |
| 5 | 图片工作区（生图、自检、压缩、七牛上传、URL 回写） | 🟡 核心完成，见下方未完项 |
| 6 | 发布队列与发行 | ⬜ **未开始**（导航为占位） |

### 已完成并验收的证据

- Phase 1：19 文件 / 70 项测试、E2E 配置持久化、macOS ZIP 产物启动烟测通过。
- Phase 2：26 文件 / 115 项测试、真实妙手账号只读契约验收通过（未发布 20+10 条）、
  打包应用中真实同步 29 条商品入库。
- Phase 3：33 文件 / 169 项测试、E2E 侵权流程通过、99 个受限品牌解析与别名展开验证通过。
- Phase 4（草稿生成子阶段）：41 文件 / 254 项测试、双快照模型与双视图验收通过。
- 当前全量：**72 个测试文件 / 439 项测试全通过**（`npm test`，2026-09-17 实测）。

### 尚未完成 / 待办

**发布（阶段 6，全部未做）**

- [ ] 发布前检查清单（侵权复检有效性、类目属性完整、SKU 定价、包裹超限、图片合规）。
- [ ] 发布提交与异步状态机：待提交 / 提交中 / 提交失败 / 妙手队列中 / 可能失败 / 已确认失败 / 发布成功 / 状态未知 / 已放弃。
- [ ] **1 小时规则**（满 1 小时仍 `notPublished` 只能标记「可能失败」，绝不提前判失败）与
      本地发布 **2 小时规则**；字段已落库，等发布接口接入后启用。
- [ ] 重启后恢复未完成的发布追踪；轮询与「打开妙手检查 / 我已确认失败」人工确认入口。
- [ ] 「任务记录」「产品发布」两个页面目前仍是占位。
- [ ] Windows 安装包需在 Windows 环境或 CI runner 上运行验收（不以 macOS 打包成功代替）。

**产品编辑（阶段 4 剩余子阶段）**

- [ ] 保存妙手后的**回读验证与字段级 diff**（当前保存后只提示「已保存」，需手动重新同步才能看到）。
- [ ] 保存成功后的**侵权复检（V2）**。
- [ ] 多语言站点标题 `siteAndTitleList` 的保存、回读验证与「西语主标题降级」提示。
- [ ] 类目推荐与类目属性规则的实际接入（`skills/` 下有官方 Skill 文档可参考）。

**图片（阶段 5 剩余）**

- [ ] 局部重绘、图片顺序调整、删除、设置为「主图」。
- [ ] 上传前的图片规则检查清单（尺寸、数量、主图白底、文本、Logo、水印、SKU 一致性）——
      目前只有 AI 自检，没有独立的确定性规则检查。
- [ ] 豆包生图 provider（接口与 OpenAI 规范不同，本阶段未做）。

**其它**

- [ ] Phase 3 验收清单中「工作台人工复核」若干项仍为未勾选（真实商品抽查类）。
- [ ] 多件装消耗品的包装/数量表达仍在迭代。

---

## 7. 文档索引

| 文档 | 说明 |
|---|---|
| [`docs/superpowers/specs/2026-08-26-mercado-agent-desktop-design.md`](docs/superpowers/specs/2026-08-26-mercado-agent-desktop-design.md) | **总设计规格**（范围、生命周期、各模块规则、验收标准） |
| [`docs/superpowers/plans/2026-08-26-mercado-agent-roadmap.md`](docs/superpowers/plans/2026-08-26-mercado-agent-roadmap.md) | 六阶段路线图与统一验收流程 |
| [`docs/superpowers/specs/2026-08-29-image-generation-design.md`](docs/superpowers/specs/2026-08-29-image-generation-design.md) | AI 生图设计 |
| [`docs/superpowers/specs/2026-08-29-net-profit-calculator-design.md`](docs/superpowers/specs/2026-08-29-net-profit-calculator-design.md) | 净收益计算器设计 |
| [`docs/superpowers/specs/2026-08-27-model-network-proxy-design.md`](docs/superpowers/specs/2026-08-27-model-network-proxy-design.md) | 模型网络代理与 session 隔离设计 |
| [`docs/acceptance/`](docs/acceptance/) | 各阶段验收记录（含测试数与真实账号验证结果） |
| [`docs/美客多净利润计算器.md`](docs/美客多净利润计算器.md) | 净收益公式与运费阶梯表依据 |
| [`docs/miaoshou-api/`](docs/miaoshou-api/) | 妙手开放接口文档（本地参考） |

---

## 8. 开发约定

- **每次提交必须**：`npm test` + `npm run typecheck` + `npm run lint` 全绿。
- **IPC 变更**：先在 `src/shared/ipc-contract.ts` 定义类型，入参一律 Zod `strictObject` 校验，
  返回值统一 `{ ok: true, data }` / `{ ok: false, error: { code, message } }`。
- **模型输出**：必须先过结构化校验，失败时保留原内容并允许重试，禁止直接落库。
- **持久化**：只走 Repository，UI 与 Provider 不写 SQL；迁移脚本集中在 `src/main/db/migrations/`。
- **编辑与发布严格分离**：任何 AI 编辑保存都不得自动触发发布。
- **密钥**：任何真实 App Key / Secret 都不许进入 Git 跟踪或未跟踪文件。
- `skills/` 下的妙手官方 Skill 仅作为接口行为与校验逻辑的参考，**不是运行时依赖**，正式应用直接调用妙手开放 API。
