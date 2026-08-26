export class ModelProxyApplyError extends Error {
  constructor() {
    super('无法应用模型网络代理配置，请检查设置后重试。');
    this.name = 'ModelProxyApplyError';
  }
}

export class ModelProxyPersistenceError extends Error {
  constructor(message = '模型网络代理配置未能保存，已恢复原配置。') {
    super(message);
    this.name = 'ModelProxyPersistenceError';
  }
}

export class ModelProxyConnectionError extends Error {
  constructor() {
    super('无法连接本地 HTTP 代理，请确认代理应用已启动且端口正确。');
    this.name = 'ModelProxyConnectionError';
  }
}
