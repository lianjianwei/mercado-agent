export class MiaoshouAuthenticationError extends Error {
  constructor(public readonly code: string) {
    super(
      '妙手凭证或访问权限校验失败，请检查 App Key、Secret、系统时间、接口权限和 IP 白名单。',
    );
    this.name = 'MiaoshouAuthenticationError';
  }
}

export class MiaoshouRateLimitError extends Error {
  constructor(public readonly code: string) {
    super('妙手接口调用频率已达到限制，请稍后重试。');
    this.name = 'MiaoshouRateLimitError';
  }
}

export class MiaoshouApiError extends Error {
  constructor(public readonly code: string) {
    super(`妙手接口返回错误（${code}），请稍后重试。`);
    this.name = 'MiaoshouApiError';
  }
}

export class MiaoshouInvalidResponseError extends Error {
  constructor() {
    super('妙手返回了无法识别的数据，请更新应用或稍后重试。');
    this.name = 'MiaoshouInvalidResponseError';
  }
}

export class MiaoshouTimeoutError extends Error {
  constructor() {
    super('妙手请求超时，请检查网络后重试。');
    this.name = 'MiaoshouTimeoutError';
  }
}

export class MiaoshouCancelledError extends Error {
  constructor() {
    super('妙手请求已取消。');
    this.name = 'MiaoshouCancelledError';
  }
}

export class MiaoshouUnavailableError extends Error {
  constructor() {
    super('暂时无法连接妙手服务，请检查网络和 Base URL 后重试。');
    this.name = 'MiaoshouUnavailableError';
  }
}

export class MiaoshouInvalidDetailIdError extends Error {
  constructor() {
    super('采集箱详情 ID 无效。');
    this.name = 'MiaoshouInvalidDetailIdError';
  }
}
