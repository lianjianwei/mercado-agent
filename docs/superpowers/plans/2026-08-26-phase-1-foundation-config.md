# Phase 1: 应用骨架与配置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个可安装、可重启持久化、具有完整配置管理与诊断入口的纯本地 Electron 桌面应用骨架。

**Architecture:** 主进程按 domain/application/infrastructure/ipc 分层；SQLite 和凭证只能由主进程访问；preload 暴露最小类型化 API；React renderer 实现已确认的导航和配置页。

**Tech Stack:** Electron 44、Electron Forge Vite TypeScript、React、TypeScript、`node:sqlite`、Zod、Vitest、React Testing Library、Playwright。

**Spec:** `docs/superpowers/specs/2026-08-26-mercado-agent-desktop-design.md` 第 2、3、11、12、13、14、16 节。

## Global Constraints

- 不引入服务端和云数据库。
- renderer 禁止 `nodeIntegration`，启用 `contextIsolation` 与 sandbox。
- App Key、Secret、API Key 均无默认值；用户可查看、复制、编辑和删除。
- 每种用途只允许一个 active 配置，文本模型和生图模型互不影响。
- 数据库存放于 `app.getPath('userData')/mercado-agent.sqlite3`。
- 所有 SQL 只能存在于 migration 和 repository 文件。

---

### Task 1: 初始化可打包的安全 Electron 壳

**Files:**
- Create: `package.json`, `package-lock.json`, `forge.config.ts`
- Create: `src/main.ts`, `src/preload.ts`, `src/renderer.tsx`, `src/index.html`
- Create: `src/ui/App.tsx`, `src/ui/styles/tokens.css`, `src/ui/styles/global.css`
- Test: `tests/smoke/window-security.test.ts`

**Interfaces and types:**

```ts
export type AppInfo = { version: string; platform: NodeJS.Platform };
export interface DesktopApi { getAppInfo(): Promise<AppInfo> }
```

- [ ] 先写 `window-security.test.ts`，断言窗口选项为 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- [ ] 运行 `npm test -- window-security.test.ts`，确认因窗口工厂尚不存在而失败。
- [ ] 用 Forge `vite-typescript` 结构创建最小主进程、preload 和 React 根节点；抽出 `createMainWindow()` 供测试。
- [ ] 实现深海蓝侧栏、黄色品牌点和七个一级导航占位页，不实现业务。
- [ ] 运行测试、`npm run lint`、`npm run typecheck`、`npm run package`。
- [ ] 启动应用检查窗口和导航，再提交 `feat: scaffold secure Electron desktop shell`。

### Task 2: 建立 SQLite 迁移与 Repository 基础

**Files:**
- Create: `src/main/db/database.ts`, `src/main/db/migrator.ts`
- Create: `src/main/db/migrations/001_initial.sql`
- Create: `src/main/repositories/provider-config-repository.ts`
- Create: `src/main/repositories/credential-repository.ts`
- Create: `src/domain/config.ts`
- Test: `tests/integration/database-migrations.test.ts`
- Test: `tests/integration/config-repositories.test.ts`

**Interfaces and types:**

```ts
export interface ProviderConfigRepository {
  list(kind: 'text' | 'image'): ProviderConfig[];
  save(input: ProviderConfigInput): ProviderConfig;
  activate(id: string): void;
  delete(id: string): void;
}
export interface CredentialRepository {
  getMiaoshou(): MiaoshouCredential | null;
  saveMiaoshou(value: MiaoshouCredential): void;
  getQiniu(): QiniuCredential | null;
  saveQiniu(value: QiniuCredential): void;
}
```

- [ ] 写空文件数据库迁移测试：首次创建表、二次运行幂等、外键开启、数据库重开后数据仍在。
- [ ] 运行 `npm test -- database-migrations.test.ts` 确认失败。
- [ ] 创建 `schema_migrations`、`provider_configs`、`app_credentials`、`app_settings`，使用 `STRICT` 表和 prepared statements。
- [ ] 写 Repository 测试：同 kind 激活新配置时旧配置自动失活，text/image 可分别激活。
- [ ] 实现事务与领域对象映射，运行两组测试和 typecheck。
- [ ] 扫描 `rg "prepare\(|exec\(" src --glob '!src/main/db/**' --glob '!src/main/repositories/**'` 应无结果。
- [ ] 提交 `feat: add SQLite migrations and configuration repositories`。

### Task 3: 定义安全 IPC 合约

**Files:**
- Create: `src/shared/ipc-contract.ts`, `src/shared/config-schemas.ts`
- Create: `src/main/ipc/config-handlers.ts`, `src/main/ipc/register-handlers.ts`
- Update: `src/preload.ts`
- Test: `tests/unit/config-schemas.test.ts`
- Test: `tests/integration/config-ipc.test.ts`

**Interfaces and types:**

```ts
export interface ConfigApi {
  listProviders(kind: ProviderKind): Promise<ProviderConfigPublic[]>;
  saveProvider(input: ProviderConfigInput): Promise<ProviderConfigPublic>;
  activateProvider(id: string): Promise<void>;
  deleteProvider(id: string): Promise<void>;
  getCredentials(): Promise<AppCredentials>;
  saveCredentials(input: AppCredentialsInput): Promise<void>;
}
```

- [ ] 写 Zod 测试覆盖空 API Key、非法 provider、空妙手/七牛必填字段、合法自定义 Base URL。
- [ ] 运行测试确认缺失 schema 而失败。
- [ ] 实现 schema；IPC handler 必须再次校验 renderer 输入并把未知异常转为稳定错误码。
- [ ] 写集成测试验证 IPC 只能返回请求用途的数据，并且删除/激活规则正确。
- [ ] preload 只暴露 `window.mercado.config` 和 `window.mercado.app`，不暴露 `ipcRenderer`。
- [ ] 运行 `npm test -- config-schemas.test.ts config-ipc.test.ts` 和 typecheck。
- [ ] 提交 `feat: expose validated configuration IPC`。

### Task 4: 实现模型与凭证配置界面

**Files:**
- Create: `src/ui/pages/SettingsPage.tsx`
- Create: `src/ui/features/settings/ProviderConfigForm.tsx`
- Create: `src/ui/features/settings/CredentialForm.tsx`
- Create: `src/ui/features/settings/ConfigList.tsx`
- Create: `src/ui/features/settings/settings.css`
- Test: `tests/ui/settings-page.test.tsx`

**Interfaces and types:**

```ts
type TextProvider = 'doubao' | 'deepseek' | 'openai';
type ImageProvider = 'doubao' | 'openai';
type SecretVisibility = Record<string, boolean>;
```

- [ ] 写 UI 测试：无默认凭证、密码默认遮挡、可切换查看、可保存多套配置、启用项快速切换、用途互不覆盖。
- [ ] 运行 `npm test -- settings-page.test.tsx` 确认失败。
- [ ] 实现文本/多模态、生图、妙手、七牛四个分组；字段与设计规格完全一致。
- [ ] 在页面顶部显示“凭证以明文保存在本机 SQLite，仅供本地使用”。
- [ ] 对删除、切换启用和未保存离开添加明确确认；成功提示不自动掩盖错误。
- [ ] 运行 UI 测试并人工检查 1280×800 和 1440×900 两种窗口尺寸。
- [ ] 提交 `feat: build local model and credential settings UI`。

### Task 5: 建立 Provider 注册与可替换连接测试

**Files:**
- Create: `src/domain/providers.ts`
- Create: `src/main/providers/provider-registry.ts`
- Create: `src/main/services/connection-test-service.ts`
- Create: `src/main/ipc/diagnostic-handlers.ts`
- Create: `src/ui/pages/DiagnosticsPage.tsx`
- Test: `tests/unit/provider-registry.test.ts`
- Test: `tests/integration/connection-test-service.test.ts`

**Interfaces and types:**

```ts
export interface TextModelProvider {
  testConnection(signal: AbortSignal): Promise<ConnectionResult>;
  generate(request: MultimodalRequest, signal: AbortSignal): Promise<unknown>;
}
export interface ImageModelProvider {
  testConnection(signal: AbortSignal): Promise<ConnectionResult>;
  generate(request: ImageGenerationRequest, signal: AbortSignal): Promise<ImageResult[]>;
}
```

- [ ] 写 registry 测试覆盖受支持 provider、未知 provider、text/image 分离和 active 配置缺失。
- [ ] 写连接测试服务用例，使用 fake provider 验证超时、取消、认证失败和安全错误信息。
- [ ] 运行测试确认失败，实现 registry、fake adapter 和诊断 IPC；本阶段不实现业务生成。
- [ ] 配置页加入“测试连接”，诊断页显示应用版本、平台、数据库路径、配置完整性，但不打印 secret。
- [ ] 运行全量测试和生产打包。
- [ ] 提交 `feat: add provider registry and safe connection diagnostics`。

### Task 6: 阶段 1 端到端验收与发行烟测

**Files:**
- Create: `tests/e2e/settings-persistence.spec.ts`
- Create: `docs/acceptance/phase-1-checklist.md`
- Update: `package.json`, `forge.config.ts`

- [ ] 写 E2E：首次打开无默认值，创建两套 text 配置与一套 image 配置，分别启用，保存妙手/七牛，重启后完整保留。
- [ ] 运行 E2E，先确认测试能在实现缺口上红灯，再补齐启动/重启辅助代码。
- [ ] 运行 `npm test`、`npm run lint`、`npm run typecheck`、`npm run make` 并记录真实输出。
- [ ] 安装 macOS 产物到临时用户目录，验证启动、编辑配置、重启恢复。
- [ ] 在验收文档记录 Windows 尚需 Windows runner 验证，不虚报跨平台运行成功。
- [ ] 扫描 `rg -n "TODO|TBD|FIXME|placeholder|coming soon" src tests`，逐项解决或在验收文档明确非业务导航占位。
- [ ] 提交 `test: verify phase one configuration persistence`，停止并等待用户验收。

## Phase 1 Acceptance Gate

- [ ] macOS 安装包可启动，导航和配置页符合 A 工作台视觉。
- [ ] SQLite 是磁盘文件，应用重启后配置与启用项不丢失。
- [ ] 所有 secret 初始为空、可查看、可复制、可修改、可删除。
- [ ] 文本与生图模型能保存多套配置并分别快速切换。
- [ ] renderer 无 Node 权限，诊断日志不泄露 secret。
- [ ] 用户明确确认“阶段 1 通过”。
