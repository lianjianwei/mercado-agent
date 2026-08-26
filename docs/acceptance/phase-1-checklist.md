# Phase 1 应用骨架与配置验收记录

验收日期：2026-08-27（Asia/Shanghai）

## 自动化结果

- [x] Vitest 全量测试通过：19 个测试文件、70 项测试。
- [x] Electron Playwright E2E 通过：1 项完整配置与重启流程。
- [x] TypeScript 严格类型检查通过。
- [x] ESLint 检查通过。
- [x] Git 差异格式检查通过。
- [x] Electron Forge `make` 成功。

E2E 使用全新的临时用户目录执行以下真实桌面流程：

1. 首次打开确认文本模型、生图模型、妙手、七牛和代理均无默认密钥或可用默认配置。
2. 创建两套文本模型配置和一套生图模型配置。
3. 分别启用一套文本配置和一套生图配置。
4. 保存妙手 App Key/Secret 与七牛 Access Key/Secret、Bucket、区域和公开域名。
5. 完全关闭 Electron 应用。
6. 使用同一用户数据目录重新启动，确认配置、凭证和启用状态完整保留。

测试结束后会删除临时 E2E 用户目录，不接触用户日常使用的数据。

## macOS 发行烟测

- 平台：macOS arm64。
- 产物：`out/make/zip/darwin/arm64/Mercado Agent-darwin-arm64-0.1.0.zip`
- SHA-256：`ac577f7403c0e128d171d0e76d13918c550e7474e9925cf33693fc6da3eba9bc`
- ZIP 已解压到独立临时目录并从解压后的 `Mercado Agent.app` 成功启动。
- 启动后已在临时用户目录创建 `mercado-agent.sqlite3` 磁盘数据库。
- 配置编辑与重启恢复由同一正式打包 App 的 Playwright E2E 覆盖。

## Phase 1 验收门槛

- [x] macOS App 和 ZIP 产物可生成、启动。
- [x] SQLite 使用磁盘文件，应用完全重启后配置不丢失。
- [x] 所有 Secret 初始为空，可查看、复制、修改和删除。
- [x] 文本与生图模型可以分别保存多套配置并独立切换启用项。
- [x] Renderer 保持 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`。
- [x] 诊断与 IPC 返回值不包含 API Key、App Secret 或 Secret Key。
- [x] 模型 HTTP 代理只作用于文本和生图网络；妙手和七牛保持直连。
- [ ] 用户确认“阶段 1 通过”。

## 已知边界

- Windows 安装包与启动尚未验证，必须在 Windows runner 或 Windows 实机完成，不能用 macOS 结果代替。
- 当前 macOS ZIP 未做 Apple Developer ID 签名和公证；发给其他用户时可能出现 Gatekeeper 提示，正式签名、公证和跨平台安装验收安排在 Phase 6。
- 本阶段只验证凭证存储和模型连接框架，不调用妙手或七牛的真实业务接口；真实读取从 Phase 2 开始。
- 源码扫描命中的 `placeholder=` 均为表单输入提示属性，不是未完成实现；未发现新增的 TODO、TBD、FIXME 或 coming-soon 标记。
- Forge Vite 插件构建时会输出其上游 `inlineDynamicImports` 弃用警告，但生产打包与发行制作均成功。

## 本地查看

开发模式：

```bash
npm start
```

重新执行完整持久化 E2E：

```bash
npm run test:e2e
```
