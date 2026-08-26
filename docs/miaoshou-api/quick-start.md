# 快速接入

# 开放平台 - 对接文档

## 一、概述

本文档面向妙手用户，介绍如何接入开放平台，完成应用注册、签名生成、API 调用等操作。

---

## 二、接口域名说明

### 2.1 正式环境域名
- **接口基础域名**：`https://openapi-erp.91miaoshou.com`
- **接口完整地址格式**：`正式域名 + 接口路径`
- **示例**：  
  接口路径 `/open/v1/order/create`  
  完整请求地址：`https://openapi-erp.91miaoshou.com/open/v1/order/create`

> 注意：签名拼接时 **只传接口路径** `/open/v1/order/create`，**不要带域名、不要带 query 参数**。

---

## 三、接入流程

```
注册应用 → 获取密钥 → 生成签名 → 调用 API
```

### 3.1 注册应用

1. 登录妙手
2. 进入「开放平台」→「创建应用」
3. 填写应用名称、描述等信息
4. 提交审核（审核通过后即可使用）

### 3.2 获取密钥

应用创建成功后，系统会分配：

| 字段 | 说明 | 示例 |
|------|------|------|
| AppKey | 应用标识（公开） | `ak_1234567890abcdef` |
| AppSecret | 应用密钥（保密） | `as_xxxxxxxxxxxxxxxx` |

**⚠️ 安全提示**：AppSecret请妥善保存，不要泄露给他人。

### 3.3 IP 白名单配置（可选）

用户可在后台配置 IP 白名单：

| 配置情况 | 效果 |
|----------|------|
| 不配置 | 该用户下的所有应用允许任意 IP 访问 |
| 配置白名单 | 仅允许白名单内的 IP 访问该用户下的所有应用 |

**说明**：
- 白名单是**账户级别**的配置，一个用户只有一份白名单
- 该用户下的**所有应用共享同一份白名单**
- 配置白名单后，该用户的所有应用都只能从指定 IP 调用
- 不同用户的白名单相互独立

---

## 四、签名机制

### 4.1 签名算法

- **算法**：HmacSHA256
- **输出**：hex 字符串（小写）
- **签名有效期**：5分钟（timestamp 与服务器时间偏差超过 300 秒则拒绝）

### 4.2 签名公式

```
sign = HmacSHA256(appSecret, appSecret + path + timestamp + appKey + bodyJson + appSecret)
```

**拼接规则**：
1. 以 AppSecret 开头
2. 拼接请求路径（不含域名、不含Query参数）
3. 拼接时间戳（秒级 Unix 时间戳）
4. 拼接 AppKey
5. 拼接请求 Body（JSON 字符串，无 body 则拼空字符串）
6. 以 AppSecret 结尾

### 4.3 请求头参数

每次请求需在 HTTP Header 中携带以下参数：

| 参数名 | 必填 | 说明 |
|--------|------|------|
| x-app-key | 是 | 应用 Key |
| x-timestamp | 是 | 秒级 Unix 时间戳 |
| x-sign | 是 | 签名值 |

---

## 五、代码示例

### 5.1 Java 示例

```java
import cn.hutool.crypto.SecureUtil;

public class SignUtil {
    
    /**
     * 生成签名
     * @param appSecret 应用密钥
     * @param path 请求路径（不含域名）
     * @param timestamp 秒级 Unix 时间戳
     * @param appKey 应用 Key
     * @param bodyJson 请求 Body JSON 字符串
     */
    public static String generateSign(String appSecret, String path,
                                       long timestamp, String appKey,
                                       String bodyJson) {
        StringBuilder sb = new StringBuilder();
        sb.append(appSecret);
        sb.append(path);
        sb.append(timestamp);
        sb.append(appKey);

        // 拼接请求 Body
        if (bodyJson != null && !bodyJson.isEmpty()) {
            sb.append(bodyJson);
        }

        sb.append(appSecret);

        return SecureUtil.hmacSha256(appSecret).digestHex(sb.toString());
    }

    public static void main(String[] args) {
        String appSecret = "as_xxxxxxxxxxxxxxxx";
        String appKey = "ak_1234567890abcdef";
        String path = "/open/v1/order/create";
        long timestamp = System.currentTimeMillis() / 1000;

        // POST 请求示例
        String bodyJson = "{\"orderNo\":\"ORD2024001\",\"amount\":100.00}";
        String sign = generateSign(appSecret, path, timestamp, appKey, bodyJson);
        System.out.println("POST sign: " + sign);
    }
}
```

### 5.2 Python 示例

```python
import hmac
import hashlib
import time

def generate_sign(app_secret, path, timestamp, app_key, body_json=None):
    """生成签名
    :param app_secret: 应用密钥
    :param path: 请求路径（不含 Query String、不含域名）
    :param timestamp: 秒级 Unix 时间戳
    :param app_key: 应用 Key
    :param body_json: 请求 Body JSON 字符串
    """
    content = app_secret + path + str(timestamp) + app_key

    if body_json:
        content += body_json
    content += app_secret

    sign = hmac.new(
        app_secret.encode('utf-8'),
        content.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()

    return sign

# 使用示例
app_secret = "as_xxxxxxxxxxxxxxxx"
app_key = "ak_1234567890abcdef"
path = "/open/v1/order/create"
timestamp = int(time.time())

# POST 请求示例
body_json = '{"orderNo":"ORD2024001","amount":100.00}'
sign = generate_sign(app_secret, path, timestamp, app_key, body_json)
print(f"POST sign: {sign}")
```

### 5.3 HTTP 请求示例

```bash
# 接口正式域名
BASE_URL="https://openapi-erp.91miaoshou.com"
# 参数
APP_KEY="ak_1234567890abcdef"
APP_SECRET="as_xxxxxxxxxxxxxxxx"
PATH="/open/v1/order/create"
TIMESTAMP=$(date +%s)
BODY='{"orderNo":"ORD2024001","amount":100.00}'

# 生成签名（注意要包含 body）
SIGN=$(generate_sign "$APP_SECRET" "$PATH" "$TIMESTAMP" "$APP_KEY" "$BODY")

# 发起请求
curl -X POST "${BASE_URL}${PATH}" \
  -H "x-app-key: ${APP_KEY}" \
  -H "x-timestamp: ${TIMESTAMP}" \
  -H "x-sign: ${SIGN}" \
  -H "Content-Type: application/json" \
  -d "$BODY"
```

---

## 六、响应格式

### 6.1 成功响应

```json
{
    "result": "success",
    "code": "success",
    "message": "success",
    "data": {
        "orderId": "12345",
        "orderNo": "ORD2024001",
        "status": "pending"
    }
}
```

### 6.2 失败响应

```json
{
    "result": "fail",
    "code": "signInvalid",
    "message": "签名验证不通过",
    "data": null
}
```

### 6.3 常见错误码

| 错误码 | 说明 | 处理建议 |
|--------|------|---------|
| success | 成功 | - |
| appNotFound | 应用不存在或已禁用 | 检查 x-app-key 是否正确，应用是否已审核通过 |
| signMissing | 缺少签名参数 | 检查请求头是否包含 x-app-key、x-timestamp、x-sign |
| signExpired | 请求已过期 | 检查本机时间是否准确，timestamp 是否为秒级 Unix 时间戳 |
| signInvalid | 签名验证不通过 | 检查签名算法是否正确，AppSecret 是否正确 |
| appNoPermission | 应用无权限访问该接口 | 检查应用是否有该接口的调用权限 |
| ipNotInWhitelist | IP 不在白名单中 | 检查请求 IP 是否在账户白名单配置中 |
| accountQpsRateLimit | 账户每秒请求频率超限 | 降低请求频率，或联系平台提升限额 |
| accountQpmRateLimit | 账户每分钟请求频率超限 | 降低请求频率，或联系平台提升限额 |
| accountQpdRateLimit | 账户每天请求频率超限 | 降低请求频率，或联系平台提升限额 |
| appQpsRateLimit | 应用每秒请求频率超限 | 降低请求频率，或联系平台提升限额 |
| appQpmRateLimit | 应用每分钟请求频率超限 | 降低请求频率，或联系平台提升限额 |
| appQpdRateLimit | 应用每天请求频率超限 | 降低请求频率，或联系平台提升限额 |
| apiQpsRateLimit | 应用接口每秒请求频率超限 | 降低请求频率，或联系平台提升限额 |
| apiQpmRateLimit | 应用接口每分钟请求频率超限 | 降低请求频率，或联系平台提升限额 |
| apiQpdRateLimit | 应用接口每天请求频率超限 | 降低请求频率，或联系平台提升限额 |
| platformQpsRateLimit | 平台接口每秒请求频率超限 | 降低请求频率，或联系平台提升限额 |
| platformQpmRateLimit | 平台接口每分钟请求频率超限 | 降低请求频率，或联系平台提升限额 |
| platformQpdRateLimit | 平台接口每天请求频率超限 | 降低请求频率，或联系平台提升限额 |
| routeNotFound | 路由不存在 | 检查请求路径是否正确、域名路径是否拼接错误 |
| upstreamError | 下游服务连接失败 | 下游服务异常，稍后重试 |
| upstreamConnectTimeout | 下游服务连接超时 | 下游服务异常，稍后重试 |
| upstreamReadTimeout | 下游服务响应超时 | 下游服务异常，稍后重试 |
| upstreamDnsError | 下游服务域名解析失败 | 检查接口域名是否正确、本地DNS是否可正常解析 |
| upstreamReset | 下游服务连接被重置 | 下游服务异常，稍后重试 |
| systemError | 系统内部错误 | 稍后重试，或联系平台技术支持 |
| redisConnectionError | 缓存服务连接失败 | 稍后重试，或联系平台技术支持 |
| redisTimeout | 缓存服务响应超时 | 稍后重试，或联系平台技术支持 |

---

## 七、常见问题

### Q1: 签名总是验证失败？

检查以下几点：
1. AppSecret 是否正确（注意区分大小写）
2. 时间戳是否为**秒级** Unix 时间戳（不是毫秒）
3. 签名路径是否带了域名、多余参数（只能传纯接口路径）
4. POST 请求是否正确拼接了 Body，无 body 需拼空串
5. 签名输出是否为**小写 hex**

### Q2: 返回 "请求已过期"？

检查服务器时间是否与标准时间同步，timestamp 偏差不能超过 300 秒；必须使用**秒级**时间戳。

### Q3: 域名解析失败、ping 找不到主机？
1. 确认域名拼写：`openapi-erp.91miaoshou.com`
2. 切换本地公共 DNS：阿里 223.5.5.5 或 114.114.114.114
3. 检查本地网络防火墙、代理是否拦截域名解析

### Q4: 支持哪些 HTTP 方法？

目前仅支持 **POST** 方法，Content-Type 固定为 `application/json`。
