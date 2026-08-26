# 模型网络 HTTP 代理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为文本模型和生图模型增加一套可持久化、可即时启停、与妙手和七牛网络隔离的本机 HTTP 代理。

**Architecture:** 使用现有 SQLite `app_settings` 保存代理配置；主进程创建专用 Electron Session 并通过 `session.fetch()` 作为全部模型请求的统一网络入口。Renderer 只通过类型化 IPC 管理配置，不能访问 Session 或 Node 网络能力。

**Tech Stack:** Electron 44、TypeScript 6、React 19、`node:sqlite`、Zod、Vitest、React Testing Library。

**Spec:** `docs/superpowers/specs/2026-08-27-model-network-proxy-design.md`

## Global Constraints

- 首版只支持无需认证的 HTTP 代理，典型地址为 `127.0.0.1:7890`。
- 代理只作用于文本模型和生图模型；妙手 ERP、七牛云和 Renderer 保持直连。
- 默认关闭代理，主机和端口不得有可用默认值。
- 启用代理时不得在失败后静默回退直连。
- 保存代理后立即生效，不要求重启 App。
- 所有配置继续保存在本地 SQLite，不引入服务端或云数据库。
- Renderer 保持 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`。
- 每个任务独立提交并暂停等待用户验收；未经确认不得开始下一任务。

---

### Task 1: 建立代理领域模型、校验与持久化

**Files:**
- Create: `src/domain/proxy.ts`
- Create: `src/main/repositories/app-settings-repository.ts`
- Modify: `src/shared/config-schemas.ts`
- Test: `tests/unit/model-proxy-schema.test.ts`
- Test: `tests/integration/app-settings-repository.test.ts`

**Interfaces:**
- Consumes: 现有 SQLite `app_settings(key, value_json)` 表和 `DatabaseSync`。
- Produces:

```ts
export type ModelProxyConfig = {
  enabled: boolean;
  protocol: 'http';
  host: string;
  port: number | null;
};

export const DISABLED_MODEL_PROXY: ModelProxyConfig;

export interface AppSettingsRepository {
  getModelProxy(): ModelProxyConfig;
  saveModelProxy(value: ModelProxyConfig): void;
}

export const modelProxyConfigSchema: z.ZodType<ModelProxyConfig>;
```

- [ ] **Step 1: 写代理配置 schema 失败测试**

在 `tests/unit/model-proxy-schema.test.ts` 写入：

```ts
import { describe, expect, it } from 'vitest';
import { modelProxyConfigSchema } from '../../src/shared/config-schemas';

describe('model proxy configuration', () => {
  it('accepts an explicitly disabled empty configuration', () => {
    expect(modelProxyConfigSchema.parse({
      enabled: false,
      protocol: 'http',
      host: '',
      port: null,
    })).toEqual({ enabled: false, protocol: 'http', host: '', port: null });
  });

  it.each([
    { host: '', port: 7890 },
    { host: 'http://127.0.0.1', port: 7890 },
    { host: '127.0.0.1/path', port: 7890 },
    { host: 'user@127.0.0.1', port: 7890 },
    { host: '127.0.0.1', port: 0 },
    { host: '127.0.0.1', port: 65536 },
    { host: '127.0.0.1', port: 7890.5 },
  ])('rejects unsafe enabled values: %o', ({ host, port }) => {
    expect(modelProxyConfigSchema.safeParse({
      enabled: true,
      protocol: 'http',
      host,
      port,
    }).success).toBe(false);
  });

  it('trims a valid host and preserves the numeric port', () => {
    expect(modelProxyConfigSchema.parse({
      enabled: true,
      protocol: 'http',
      host: ' 127.0.0.1 ',
      port: 7890,
    })).toEqual({ enabled: true, protocol: 'http', host: '127.0.0.1', port: 7890 });
  });
});
```

- [ ] **Step 2: 运行 schema 测试确认红灯**

Run: `npm test -- model-proxy-schema.test.ts`  
Expected: FAIL，提示 `modelProxyConfigSchema` 尚未导出。

- [ ] **Step 3: 实现领域对象和严格校验**

`src/domain/proxy.ts`：

```ts
export type ModelProxyConfig = {
  enabled: boolean;
  protocol: 'http';
  host: string;
  port: number | null;
};

export const DISABLED_MODEL_PROXY: ModelProxyConfig = {
  enabled: false,
  protocol: 'http',
  host: '',
  port: null,
};

export interface AppSettingsRepository {
  getModelProxy(): ModelProxyConfig;
  saveModelProxy(value: ModelProxyConfig): void;
}
```

在 `src/shared/config-schemas.ts` 增加基础对象和 `superRefine`：

```ts
const proxyHost = z.string().trim().refine(
  (value) => value === '' || !/[\s/:@?#]/.test(value),
  'Enter a host without protocol, path or credentials',
);

export const modelProxyConfigSchema = z
  .strictObject({
    enabled: z.boolean(),
    protocol: z.literal('http'),
    host: proxyHost,
    port: z.number().int().min(1).max(65535).nullable(),
  })
  .superRefine((value, context) => {
    if (!value.enabled) return;
    if (!value.host) {
      context.addIssue({ code: 'custom', path: ['host'], message: 'Proxy host is required' });
    }
    if (value.port === null) {
      context.addIssue({ code: 'custom', path: ['port'], message: 'Proxy port is required' });
    }
  });
```

- [ ] **Step 4: 运行 schema 测试确认绿灯**

Run: `npm test -- model-proxy-schema.test.ts`  
Expected: 4 组行为全部 PASS。

- [ ] **Step 5: 写 Repository 失败测试**

在 `tests/integration/app-settings-repository.test.ts` 使用临时磁盘数据库，覆盖：

```ts
it('returns a disabled configuration without inventing an address', () => {
  expect(repository.getModelProxy()).toEqual({
    enabled: false,
    protocol: 'http',
    host: '',
    port: null,
  });
});

it('persists the model proxy after reopening the database', () => {
  repository.saveModelProxy({
    enabled: true,
    protocol: 'http',
    host: '127.0.0.1',
    port: 7890,
  });
  database.close();

  const reopened = openAppDatabase(databasePath);
  expect(new SqliteAppSettingsRepository(reopened).getModelProxy()).toEqual({
    enabled: true,
    protocol: 'http',
    host: '127.0.0.1',
    port: 7890,
  });
});
```

- [ ] **Step 6: 运行 Repository 测试确认红灯**

Run: `npm test -- app-settings-repository.test.ts`  
Expected: FAIL，提示 Repository 模块不存在。

- [ ] **Step 7: 实现 SQLite Repository**

`src/main/repositories/app-settings-repository.ts` 只能在此文件中包含 SQL：

```ts
export class SqliteAppSettingsRepository implements AppSettingsRepository {
  constructor(private readonly database: DatabaseSync) {}

  getModelProxy(): ModelProxyConfig {
    const row = this.database
      .prepare('SELECT value_json FROM app_settings WHERE key = ?')
      .get('model_proxy') as { value_json: string } | undefined;
    if (!row) return { ...DISABLED_MODEL_PROXY };
    return modelProxyConfigSchema.parse(JSON.parse(row.value_json));
  }

  saveModelProxy(value: ModelProxyConfig): void {
    const normalized = modelProxyConfigSchema.parse(value);
    this.database.prepare(`
      INSERT INTO app_settings (key, value_json)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
    `).run('model_proxy', JSON.stringify(normalized));
  }
}
```

- [ ] **Step 8: 验证 Task 1 并提交**

Run:

```bash
npm test -- model-proxy-schema.test.ts app-settings-repository.test.ts
npm run typecheck
rg "prepare\(|exec\(" src --glob '!src/main/db/**' --glob '!src/main/repositories/**'
```

Expected: 测试和 typecheck PASS；SQL 扫描不新增 Repository 之外的结果。

Commit:

```bash
git add src/domain/proxy.ts src/shared/config-schemas.ts src/main/repositories/app-settings-repository.ts tests/unit/model-proxy-schema.test.ts tests/integration/app-settings-repository.test.ts
git commit -m "feat: persist model proxy settings"
```

停止并等待用户验收 Task 1。

---

### Task 2: 建立模型专用 Session 与代理应用服务

**Files:**
- Create: `src/main/network/model-network-client.ts`
- Create: `src/main/network/electron-model-session.ts`
- Create: `src/main/network/model-network-errors.ts`
- Create: `src/main/services/model-proxy-service.ts`
- Test: `tests/unit/model-proxy-service.test.ts`
- Test: `tests/unit/model-network-client.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `ModelProxyConfig`、`AppSettingsRepository`。
- Produces:

```ts
export type NetworkRoute = 'direct' | 'http_proxy';

export type ElectronProxyConfig =
  | { mode: 'direct' }
  | { mode: 'fixed_servers'; proxyRules: string };

export interface ModelSessionAdapter {
  setProxy(config: ElectronProxyConfig): Promise<void>;
  closeAllConnections(): Promise<void>;
  fetch(input: string, init: RequestInit): Promise<Response>;
}

export interface ModelNetworkTransport {
  fetch(input: string, init: RequestInit): Promise<Response>;
  getRoute(): NetworkRoute;
}

export class ModelProxyService {
  initialize(): Promise<ModelProxyConfig>;
  get(): ModelProxyConfig;
  save(input: ModelProxyConfig): Promise<ModelProxyConfig>;
}

export class ModelProxyApplyError extends Error {}
export class ModelProxyPersistenceError extends Error {}
export class ModelProxyConnectionError extends Error {}
```

- [ ] **Step 1: 写代理规则与切换失败测试**

在 `tests/unit/model-proxy-service.test.ts` 用记录调用的 fake Repository 和 fake Session 覆盖：

```ts
it('initializes the model session in direct mode when disabled', async () => {
  await service.initialize();
  expect(session.setProxyCalls).toEqual([{ mode: 'direct' }]);
});

it('applies an enabled HTTP proxy and closes existing model connections', async () => {
  await service.save({ enabled: true, protocol: 'http', host: '127.0.0.1', port: 7890 });
  expect(session.setProxyCalls.at(-1)).toEqual({
    mode: 'fixed_servers',
    proxyRules: 'http://127.0.0.1:7890',
  });
  expect(session.closeCalls).toBe(1);
});

it('does not persist when applying the proxy fails', async () => {
  session.setProxyError = new Error('ERR_PROXY_CONNECTION_FAILED');
  await expect(service.save(enabledProxy)).rejects.toThrow('无法应用模型网络代理配置');
  expect(repository.saved).toEqual([]);
});

it('restores the old route when persistence fails', async () => {
  repository.saveError = new Error('disk full');
  await expect(service.save(enabledProxy)).rejects.toThrow();
  expect(session.setProxyCalls).toEqual([
    { mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:7890' },
    { mode: 'direct' },
  ]);
});
```

- [ ] **Step 2: 运行服务测试确认红灯**

Run: `npm test -- model-proxy-service.test.ts`  
Expected: FAIL，提示 `ModelProxyService` 不存在。

- [ ] **Step 3: 实现单一职责的代理服务**

核心实现必须：

```ts
function electronProxyConfig(value: ModelProxyConfig): ElectronProxyConfig {
  if (!value.enabled) return { mode: 'direct' };
  return {
    mode: 'fixed_servers',
    proxyRules: `http://${value.host}:${value.port}`,
  };
}

async save(input: ModelProxyConfig): Promise<ModelProxyConfig> {
  const next = modelProxyConfigSchema.parse(input);
  const previous = this.current;
  await this.apply(next);
  try {
    this.repository.saveModelProxy(next);
    this.current = next;
    return next;
  } catch (error) {
    await this.apply(previous);
    throw new ModelProxyPersistenceError('模型网络代理配置未能保存，已恢复原配置。');
  }
}
```

`apply()` 必须先 `setProxy()`，成功后再 `closeAllConnections()`；异常对外转换为不含 Electron 原始堆栈的稳定错误。

- [ ] **Step 4: 写统一网络客户端失败测试**

`tests/unit/model-network-client.test.ts`：

```ts
it('uses only the dedicated session fetch implementation', async () => {
  const response = await client.fetch('https://models.example.com/v1/models', { method: 'GET' });
  expect(response.status).toBe(200);
  expect(session.fetchCalls).toEqual(['https://models.example.com/v1/models']);
});

it('reports the current route without exposing proxy internals', () => {
  expect(client.getRoute()).toBe('http_proxy');
});

it('maps an unreachable local proxy without falling back to direct fetch', async () => {
  session.fetchError = new Error('net::ERR_PROXY_CONNECTION_FAILED');
  await expect(client.fetch(url, {})).rejects.toBeInstanceOf(ModelProxyConnectionError);
  expect(globalFetch).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: 实现网络客户端与 Electron 适配器**

`ModelNetworkClient` 只委托给 `ModelSessionAdapter.fetch()`，并依据 `ModelProxyService.get().enabled` 返回路线。只在代理已启用且底层错误可识别为 `ERR_PROXY_CONNECTION_FAILED` 时抛出 `ModelProxyConnectionError`，其他错误原样向 Provider 传播以便正确分类超时、取消和目标服务错误。

`createElectronModelSession()` 必须使用：

```ts
const modelSession = session.fromPartition('persist:model-network');
return {
  setProxy: (config) => modelSession.setProxy(config),
  closeAllConnections: () => modelSession.closeAllConnections(),
  fetch: (input, init) => modelSession.fetch(input, init),
};
```

- [ ] **Step 6: 验证 Task 2 并提交**

Run:

```bash
npm test -- model-proxy-service.test.ts model-network-client.test.ts
npm run typecheck
npm run lint
```

Commit:

```bash
git add src/main/network src/main/services/model-proxy-service.ts tests/unit/model-proxy-service.test.ts tests/unit/model-network-client.test.ts
git commit -m "feat: isolate model traffic in proxy-aware session"
```

停止并等待用户验收 Task 2。

---

### Task 3: 暴露代理 IPC 并实现配置界面

**Files:**
- Create: `src/main/ipc/proxy-config-handlers.ts`
- Create: `src/ui/features/settings/ProxyConfigForm.tsx`
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/main/ipc/register-handlers.ts`
- Modify: `src/preload.ts`
- Modify: `src/main.ts`
- Modify: `src/ui/pages/SettingsPage.tsx`
- Modify: `src/ui/features/settings/settings.css`
- Test: `tests/integration/proxy-config-ipc.test.ts`
- Test: `tests/ui/proxy-config-form.test.tsx`

**Interfaces:**
- Consumes: Task 2 的 `ModelProxyService`。
- Produces:

```ts
export interface ProxyConfigApi {
  get(): Promise<ModelProxyConfig>;
  save(input: ModelProxyConfig): Promise<ModelProxyConfig>;
}

export interface DesktopApi {
  // existing app/config/diagnostics
  proxy: ProxyConfigApi;
}
```

- [ ] **Step 1: 写 IPC 失败测试**

`tests/integration/proxy-config-ipc.test.ts` 使用 fake `ModelProxyService` 和真实 IPC registrar，验证：

```ts
it('rejects an unsafe enabled proxy before calling the service', async () => {
  const result = await invoke(IPC_CHANNELS.proxySave, {
    enabled: true,
    protocol: 'http',
    host: 'http://127.0.0.1',
    port: 7890,
  });
  expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  expect(service.saveCalls).toEqual([]);
});

it('returns only normalized proxy fields', async () => {
  const result = await invoke(IPC_CHANNELS.proxyGet);
  expect(result).toEqual({
    ok: true,
    data: { enabled: false, protocol: 'http', host: '', port: null },
  });
});
```

- [ ] **Step 2: 运行 IPC 测试确认红灯**

Run: `npm test -- proxy-config-ipc.test.ts`  
Expected: FAIL，提示代理 IPC channel/handler 不存在。

- [ ] **Step 3: 实现 IPC 合约、handler 和 preload**

增加 channel：

```ts
proxyGet: 'proxy:get',
proxySave: 'proxy:save',
```

handler 必须使用 `modelProxyConfigSchema.parse(payload)`，把 Zod 错误映射为 `VALIDATION_ERROR`，把代理应用或持久化错误映射为稳定 `INTERNAL_ERROR`。preload 只暴露 `window.mercado.proxy.get/save`，不暴露 `ipcRenderer`。

- [ ] **Step 4: 写代理表单失败测试**

`tests/ui/proxy-config-form.test.tsx` 使用真实组件和 fake `ProxyConfigApi`：

```tsx
it('starts disabled with no usable default address', async () => {
  render(<ProxyConfigForm api={apiReturningDisabled} onDirtyChange={vi.fn()} />);
  expect(await screen.findByRole('checkbox', { name: '启用 HTTP 代理' })).toHaveProperty('checked', false);
  expect(screen.getByLabelText('代理主机')).toHaveProperty('value', '');
  expect(screen.getByLabelText('代理端口')).toHaveProperty('value', '');
});

it('requires host and port only when enabled', async () => {
  await user.click(screen.getByRole('checkbox', { name: '启用 HTTP 代理' }));
  await user.click(screen.getByRole('button', { name: '保存代理配置' }));
  expect(await screen.findByText('启用代理时必须填写主机和端口。')).toBeTruthy();
  expect(api.save).not.toHaveBeenCalled();
});

it('saves once, applies immediately and keeps the address when disabled', async () => {
  await user.type(screen.getByLabelText('代理主机'), '127.0.0.1');
  await user.type(screen.getByLabelText('代理端口'), '7890');
  await user.click(screen.getByRole('checkbox', { name: '启用 HTTP 代理' }));
  await user.click(screen.getByRole('button', { name: '保存代理配置' }));
  expect(await screen.findByText('模型网络代理配置已保存并生效。')).toBeTruthy();
  expect(api.save).toHaveBeenCalledWith({
    enabled: true,
    protocol: 'http',
    host: '127.0.0.1',
    port: 7890,
  });
});
```

- [ ] **Step 5: 实现配置表单并接入 SettingsPage**

表单位置固定在“模型配置”与“平台与存储凭证”之间。主机和端口用 placeholder 展示 `127.0.0.1`、`7890`，但 input value 初始必须为空。表单成功提示保存在稳定组件内，不能通过动态 React `key` 强制重建。

`src/main.ts` 在 `app.whenReady()` 中创建 Repository、专用 Session、`ModelProxyService`，先 `await initialize()` 再创建 Provider/注册 IPC/显示窗口；初始化失败时保持窗口不创建并输出不含凭证的启动错误。

- [ ] **Step 6: 验证 Task 3 并提交**

Run:

```bash
npm test -- proxy-config-ipc.test.ts proxy-config-form.test.tsx settings-page.test.tsx
npm run typecheck
npm run lint
```

Commit:

```bash
git add src/main.ts src/main/ipc src/preload.ts src/shared/ipc-contract.ts src/ui/features/settings src/ui/pages/SettingsPage.tsx tests/integration/proxy-config-ipc.test.ts tests/ui/proxy-config-form.test.tsx
git commit -m "feat: add model proxy settings UI"
```

停止并等待用户验收 Task 3。

---

### Task 4: 将所有模型 Provider 接入代理网络客户端

**Files:**
- Modify: `src/domain/providers.ts`
- Modify: `src/main/providers/bearer-model-connection-provider.ts`
- Modify: `src/main/providers/default-provider-registrations.ts`
- Modify: `src/main/services/connection-test-service.ts`
- Modify: `src/main.ts`
- Modify: `src/ui/pages/SettingsPage.tsx`
- Modify: `src/ui/pages/DiagnosticsPage.tsx`
- Test: `tests/unit/bearer-model-provider.test.ts`
- Test: `tests/integration/connection-test-service.test.ts`
- Test: `tests/ui/settings-page.test.tsx`

**Interfaces:**
- Consumes: Task 2 的 `ModelNetworkTransport`。
- Produces:

```ts
export type ConnectionResult = {
  ok: boolean;
  status: ConnectionStatus;
  message: string;
  latencyMs: number;
  route: 'direct' | 'http_proxy';
};

export class ProviderRegionRestrictedError extends Error {}
```

- [ ] **Step 1: 写 Provider 路由和 451 失败测试**

扩展 `tests/unit/bearer-model-provider.test.ts`：

```ts
it.each([
  ['text', 'openai'],
  ['text', 'deepseek'],
  ['text', 'doubao'],
  ['image', 'openai'],
  ['image', 'doubao'],
])('routes %s/%s through the shared model transport', async (kind, providerName) => {
  const registrations = createDefaultProviderRegistrations(modelTransport);
  const provider = registrations.find((item) => item.kind === kind && item.provider === providerName)!.create(config);
  await provider.testConnection(new AbortController().signal);
  expect(modelTransport.fetchCalls).toEqual(['https://models.example.com/v1/models']);
});

it('classifies HTTP 451 as a restricted network exit', async () => {
  modelTransport.response = new Response('restricted', { status: 451 });
  await expect(provider.testConnection(signal)).rejects.toBeInstanceOf(ProviderRegionRestrictedError);
});
```

- [ ] **Step 2: 运行 Provider 测试确认红灯**

Run: `npm test -- bearer-model-provider.test.ts`  
Expected: FAIL，因为注册函数尚不接收 transport，且 451 没有独立错误类型。

- [ ] **Step 3: 注入统一网络客户端并禁止全局 fetch 回退**

`BearerModelConnectionProvider` 构造函数改为接收 `ModelNetworkTransport`，删除默认 `fetch`：

```ts
constructor(
  private readonly configuration: BearerConfiguration,
  private readonly network: ModelNetworkTransport,
) {}
```

请求只能使用 `this.network.fetch(...)`。状态为 451 时抛出 `ProviderRegionRestrictedError`；401/403 保持认证错误；其他非 2xx 保持不可用错误。`createDefaultProviderRegistrations(network)` 把同一个客户端注入文本和生图的全部注册项。

- [ ] **Step 4: 写连接结果路线失败测试**

扩展 `tests/integration/connection-test-service.test.ts`：

```ts
it('returns a safe region restriction message and the active route', async () => {
  provider.testConnection = async () => { throw new ProviderRegionRestrictedError(); };
  const result = await service.test('image');
  expect(result).toMatchObject({
    ok: false,
    status: 'unavailable',
    route: 'direct',
    message: '目标模型服务拒绝当前网络出口，请启用或检查模型 HTTP 代理。',
  });
});

it('reports an unreachable local proxy without exposing raw network errors', async () => {
  provider.testConnection = async () => { throw new ModelProxyConnectionError(); };
  const result = await service.test('text');
  expect(result).toMatchObject({
    ok: false,
    route: 'http_proxy',
    message: '无法连接本地 HTTP 代理，请确认代理应用已启动且端口正确。',
  });
  expect(JSON.stringify(result)).not.toContain('ERR_PROXY_CONNECTION_FAILED');
});
```

`ConnectionTestService` 新增 `getRoute(): NetworkRoute` 依赖；成功、失败、超时和取消结果都必须包含开始测试时的路线快照。

- [ ] **Step 5: 在配置页展示路线并更新 UI 测试**

连接测试结果格式：

```ts
const routeLabel = result.route === 'http_proxy' ? 'HTTP 代理' : '直连';
`${result.message}（${result.latencyMs} ms，当前使用：${routeLabel}）`
```

UI 测试必须断言文本和生图结果均能显示正确路线，不允许从代理表单状态猜测路线，必须使用主进程返回的 `ConnectionResult.route`。

- [ ] **Step 6: 验证 Task 4 并提交**

Run:

```bash
npm test -- bearer-model-provider.test.ts connection-test-service.test.ts settings-page.test.tsx diagnostics-page.test.tsx
npm test
npm run typecheck
npm run lint
```

Commit:

```bash
git add src/domain/providers.ts src/main/providers src/main/services/connection-test-service.ts src/main.ts src/ui/pages tests/unit/bearer-model-provider.test.ts tests/integration/connection-test-service.test.ts tests/ui/settings-page.test.tsx
git commit -m "feat: route model providers through configured proxy"
```

停止并等待用户验收 Task 4。

---

### Task 5: 完成诊断、真实代理烟测与正式打包

**Files:**
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/main/ipc/diagnostic-handlers.ts`
- Modify: `src/main.ts`
- Modify: `src/ui/pages/DiagnosticsPage.tsx`
- Modify: `src/ui/pages/diagnostics.css`
- Create: `docs/acceptance/model-http-proxy-checklist.md`
- Test: `tests/integration/diagnostic-ipc.test.ts`
- Test: `tests/ui/diagnostics-page.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `ModelProxyConfig` 和 Task 2 的路线状态。
- Produces:

```ts
export type DiagnosticSnapshot = {
  // existing app/databasePath/completeness
  modelNetwork: {
    route: 'direct' | 'http_proxy';
    proxyAddress: string | null;
  };
};
```

- [ ] **Step 1: 写不泄密的诊断失败测试**

扩展 `tests/integration/diagnostic-ipc.test.ts`：

```ts
it('reports model routing without any provider or credential secret', async () => {
  const response = await invoke(IPC_CHANNELS.diagnosticGetSnapshot);
  expect(response).toMatchObject({
    ok: true,
    data: {
      modelNetwork: {
        route: 'http_proxy',
        proxyAddress: '127.0.0.1:7890',
      },
    },
  });
  expect(JSON.stringify(response)).not.toContain('apiKey');
  expect(JSON.stringify(response)).not.toContain('appSecret');
  expect(JSON.stringify(response)).not.toContain('secretKey');
});
```

- [ ] **Step 2: 写诊断页面失败测试**

扩展 `tests/ui/diagnostics-page.test.tsx`，断言代理启用时显示“HTTP 代理”和 `127.0.0.1:7890`，关闭时显示“直连”且不渲染旧代理地址。

- [ ] **Step 3: 实现诊断快照和页面**

主进程从 `ModelProxyService.get()` 生成只读网络摘要。Renderer 不自行读取设置表。页面文案明确：代理仅用于文本和生图模型；妙手和七牛保持直连。

- [ ] **Step 4: 运行自动化全量验证**

Run:

```bash
npm test
npm run lint
npm run typecheck
rg -n "TODO|TBD|FIXME|placeholder|coming soon" src tests
git diff --check
```

Expected: 全部命令成功；扫描结果若命中既有业务导航占位文案，只记录既有范围，不新增代理相关占位实现。

- [ ] **Step 5: 执行真实直连与代理烟测**

在不输出 API Key 的前提下：

1. 关闭代理，测试 `https://api.86gamestore.com` 的已启用模型，确认当前网络仍可能返回地区限制并显示“当前使用：直连”。
2. 启动本机 HTTP 代理 `127.0.0.1:7890`。
3. 保存并启用代理，只单击一次应显示保存成功。
4. 分别测试文本和生图模型，确认都显示“当前使用：HTTP 代理”。
5. 临时停止本机代理，再测试一次，确认提示本地代理不可达且没有回退直连。
6. 重新启动代理并关闭应用；重开后确认代理设置仍保留并生效。

将结果和实际日期记录在 `docs/acceptance/model-http-proxy-checklist.md`，不得记录任何密钥或完整模型响应。

- [ ] **Step 6: 正式打包并启动 macOS 产物**

Run:

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run package
out/Mercado\ Agent-darwin-arm64/Mercado\ Agent.app/Contents/MacOS/Mercado\ Agent --user-data-dir=/private/tmp/mercado-agent-proxy-acceptance
```

Expected: arm64 macOS 包生成成功并能启动；Windows 仅记录待 Windows runner 验证。

- [ ] **Step 7: 提交并停止等待整体验收**

```bash
git add src/shared/ipc-contract.ts src/main/ipc/diagnostic-handlers.ts src/main.ts src/ui/pages docs/acceptance/model-http-proxy-checklist.md tests/integration/diagnostic-ipc.test.ts tests/ui/diagnostics-page.test.tsx
git commit -m "test: verify isolated model HTTP proxy"
```

停止并等待用户确认“模型 HTTP 代理功能通过”。不得自动开始下一阶段业务功能。

## Acceptance Gate

- [ ] 代理首次配置无默认地址，默认关闭。
- [ ] `127.0.0.1:7890` 保存后立即生效且重启后保持。
- [ ] 文本和生图连接测试均通过专用 Session 使用代理。
- [ ] 妙手 ERP 和七牛云没有使用模型代理 Session。
- [ ] 代理不可达时不静默回退直连。
- [ ] 451、代理不可达、认证失败、超时和取消具有不同安全提示。
- [ ] 诊断页显示路线但不泄露任何 secret。
- [ ] macOS arm64 正式包通过启动与配置烟测。
- [ ] 用户逐任务完成验收。
