# 模型网络 HTTP 代理设计

**日期：** 2026-08-27  
**状态：** 待用户审核  
**适用范围：** Mercado Agent 文本模型与生图模型网络请求

## 1. 背景与目标

用户配置的模型网关 `https://api.86gamestore.com` 在当前直连网络下会间歇返回 HTTP 451。实测响应表明当前 IPv4 出口 IP 所在地区不受服务支持；同一域名偶尔通过其他线路可达，因此应用中的连接测试表现为大部分失败、偶尔成功。通过本机 HTTP 代理 `127.0.0.1:7890` 请求时能够稳定到达接口鉴权层。

本功能为模型网络增加一套可选的本地 HTTP 代理配置。启用后，文本模型和生图模型的连接测试、文本生成、多模态理解、文生图与图生图请求都必须走代理；妙手 ERP、七牛云和应用其他网络请求继续直连。

## 2. 范围

### 2.1 本次包含

- 保存一套模型网络代理配置。
- 启用或关闭代理。
- 首版支持 HTTP 代理，字段为主机和端口。
- 保存后立即生效，不要求重启应用。
- 使用独立 Electron Session 隔离模型流量。
- 现有文本、生图连接测试遵循当前代理配置。
- 诊断页面展示代理是否启用及代理地址，但不展示任何模型 API Key。
- 关闭代理后保留主机和端口，方便再次启用。

### 2.2 本次不包含

- SOCKS4、SOCKS5、PAC 和系统代理模式。
- 代理用户名、密码认证。
- 多套代理配置和代理自动切换。
- 妙手、七牛或应用界面请求走代理。
- 代理故障时自动回退直连。自动回退可能绕过用户预期的出口线路，因此禁止静默回退。

## 3. 用户界面

“模型与凭证”页面新增“模型网络代理”分组，位置在模型配置之后、平台与存储凭证之前。

字段和操作：

- `启用 HTTP 代理`：开关，默认关闭。
- `代理主机`：文本输入，无默认值；示例提示 `127.0.0.1`。
- `代理端口`：数字输入，无默认值；示例提示 `7890`。
- `保存代理配置`：单击一次保存并立即应用。

交互规则：

- 未启用时允许主机和端口为空。
- 启用时主机不能为空，端口必须是 1–65535 的整数。
- 关闭开关不会清空已保存的主机和端口。
- 保存成功后立即显示“模型网络代理配置已保存并生效”。
- 保存失败时保留用户输入，并显示稳定、可理解的错误信息。
- 文本模型和生图模型的测试结果附加“当前使用：HTTP 代理”或“当前使用：直连”。

## 4. 数据模型与持久化

领域对象：

```ts
export type ModelProxyConfig = {
  enabled: boolean;
  protocol: 'http';
  host: string;
  port: number | null;
};
```

配置保存在现有 SQLite `app_settings` 表，键固定为 `model_proxy`，值为 JSON。无需修改现有表结构，也无需新增数据库文件。

Repository 接口隔离 SQL：

```ts
export interface AppSettingsRepository {
  getModelProxy(): ModelProxyConfig;
  saveModelProxy(value: ModelProxyConfig): void;
}
```

首次运行或没有保存记录时，Repository 返回明确的关闭状态：

```ts
{ enabled: false, protocol: 'http', host: '', port: null }
```

这是功能关闭状态，不包含可用代理地址，也不会让网络请求自动走代理。

## 5. IPC 与输入校验

Renderer 不能直接访问 Electron Session 或 SQLite。新增最小化 IPC：

```ts
interface ProxyConfigApi {
  get(): Promise<ModelProxyConfig>;
  save(input: ModelProxyConfigInput): Promise<ModelProxyConfig>;
}
```

主进程必须重新校验 Renderer 输入：

- `enabled` 必须是布尔值。
- `protocol` 只能为 `http`。
- 启用时 `host` 去除首尾空格后不能为空。
- 启用时 `port` 必须为 1–65535 的整数。
- 禁止在 `host` 中混入协议、路径和凭证，例如 `http://127.0.0.1` 必须被拒绝，用户应只填写 `127.0.0.1`。
- 关闭时允许空主机和空端口；非空值仍需符合格式。

保存流程必须先验证、再应用网络配置、最后持久化。若 Electron 代理配置应用失败，不写入 SQLite，界面显示保存失败，避免“数据库显示已启用、实际未生效”的不一致状态。

## 6. 模型网络架构

### 6.1 独立 Session

应用 ready 后创建专用于模型请求的持久 Session：

```ts
session.fromPartition('persist:model-network')
```

此 Session 不绑定 Renderer 窗口，只供主进程模型网络客户端使用。

### 6.2 应用代理

启用时：

```ts
await modelSession.setProxy({
  mode: 'fixed_servers',
  proxyRules: 'http://127.0.0.1:7890',
});
```

关闭时：

```ts
await modelSession.setProxy({ mode: 'direct' });
```

配置切换后关闭该 Session 已存在的网络连接，防止旧连接继续沿用之前的线路。不会关闭默认 Session 或妙手、七牛正在使用的连接。

### 6.3 统一模型请求入口

新增 `ModelNetworkClient`，内部使用 `modelSession.fetch()`。Provider 不再默认调用 Node.js 全局 `fetch`。

```ts
interface ModelNetworkClient {
  fetch(input: string, init: RequestInit): Promise<Response>;
  getRoute(): 'direct' | 'http_proxy';
}
```

所有文本和生图 Provider 都必须通过此接口发出请求。后续增加豆包、DeepSeek、OpenAI 的生成能力时继续复用该客户端，避免只有连接测试走代理、真正生成请求却直连。

## 7. 启动与配置变更流程

应用启动：

1. 打开 SQLite 并执行迁移。
2. 创建模型专用 Session。
3. 从 `app_settings` 读取代理配置。
4. 应用 `direct` 或 `fixed_servers` 配置。
5. 创建 `ModelNetworkClient`。
6. 将客户端注入文本、生图 Provider Registry。
7. 注册 IPC 并创建窗口。

用户保存代理配置：

1. Renderer 提交配置。
2. 主进程校验。
3. `ModelProxyService` 保存旧配置并应用新的 Session 代理配置。
4. 关闭模型 Session 的旧连接。
5. Repository 保存配置。
6. 如果持久化失败，重新应用旧配置并关闭新线路连接；如果回滚也失败，返回稳定的内部错误并要求用户重启应用，启动流程会以数据库中的旧配置重新建立线路。
7. IPC 返回规范化后的配置。
8. 界面显示一次保存成功提示。

## 8. 连接测试与诊断

现有 `ConnectionTestService` 的超时、取消和安全错误规则保持不变。Provider 的网络请求入口改为 `ModelNetworkClient` 后，文本和生图测试会自动遵循当前代理配置。

诊断页面新增：

- 模型网络：直连 / HTTP 代理。
- 代理地址：仅在启用时显示，例如 `127.0.0.1:7890`。
- 不显示模型 API Key、妙手 Secret 或七牛 Secret。

错误区分：

- 本地代理端口未监听：提示“无法连接本地 HTTP 代理，请确认代理应用已启动且端口正确”。
- 代理可连接但目标模型服务超时：沿用模型连接超时提示。
- 模型服务返回 401/403：提示检查模型 API Key，不误判为代理失败。
- 目标服务返回 451：提示目标服务拒绝当前网络出口，并建议检查代理是否真正启用。
- 用户取消：提示连接测试已取消。

错误消息不得包含代理之外的凭证、模型 API Key、完整上游响应正文或异常堆栈。

## 9. 安全与隐私

- 代理配置仅含启用状态、主机和端口，不包含用户名和密码。
- Renderer 不能获得 Electron Session 对象。
- 代理只作用于模型专用 Session。
- 不记录请求头、API Key、请求正文、图片内容和上游完整响应。
- 诊断日志若后续实现，默认只记录路由类型、目标域名、状态分类和耗时。
- 禁止代理失败后自动回退直连。

## 10. 测试策略

### 10.1 单元测试

- 未配置时返回关闭状态且无默认地址。
- 启用配置要求合法主机和端口。
- 拒绝带协议、路径或凭证的主机字段。
- HTTP 代理规则正确生成。
- 关闭时生成 `direct` 配置。

### 10.2 Repository 与 IPC 集成测试

- 代理配置保存到 `app_settings` 并可在数据库重开后读取。
- 非法 Renderer 输入不写数据库、不调用代理应用服务。
- 代理应用失败时不持久化。
- 保存成功返回规范化配置，不返回任何其他凭证。

### 10.3 网络服务测试

- 使用 fake Session 验证启用、关闭和切换时调用正确代理配置。
- 切换后只关闭模型 Session 的连接。
- 文本和生图 Provider 都使用注入的模型网络客户端。
- 代理失败不回退到全局 `fetch`。

### 10.4 UI 测试

- 首次打开代理关闭、主机端口为空。
- 启用后必须填写主机和端口。
- 保存成功提示第一次点击即可显示。
- 关闭后保留已保存地址。
- 重新打开应用后恢复启用状态和地址。
- 连接测试显示当前使用的网络路线。

### 10.5 全量验收

- 全量 Vitest、Lint、TypeScript 检查通过。
- macOS arm64 正式打包并启动。
- 使用 `127.0.0.1:7890` 时，`api.86gamestore.com` 模型测试稳定到达鉴权层。
- 关闭代理后恢复直连行为。
- Windows 构建仍需 Windows runner 验证，不在 macOS 上虚报成功。

## 11. 分阶段实现建议

1. 代理领域模型、校验、Repository 与持久化。
2. 模型专用 Electron Session、代理应用服务与统一网络客户端。
3. IPC 和“模型网络代理”配置界面。
4. 现有 Provider 与连接测试迁移到代理网络客户端。
5. 诊断增强、真实代理烟测、正式打包与验收。

每个任务完成后单独运行相关测试与全量回归，提交独立 commit，并暂停等待用户确认后再进入下一任务。
