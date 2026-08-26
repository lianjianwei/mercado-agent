# 获取尺码表domain列表

> 来源：[妙手开放平台 · 获取尺码表domain列表](https://s.apifox.cn/fd54e57e-9b98-4c34-bada-306221c39e68/api-482753635)

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 方法 | `POST` |
| 路径 | `/open/v1/product/collect_box/mercadolibre/collect_box/get_size_chart_domain_list` |
| API ID | `482753635` |
| Operation ID | `fbe72d824d2178c2899f83e2a28058c7` |
| 更新时间 | `2026-07-06T06:26:10.000Z` |

## 请求参数

_无接口专属 Path、Query、Header 或 Cookie 参数。_

## 请求体

- Media Type：`application/json`
- 必填：否

| 字段 | 类型 | 必填 | 说明 | 枚举/示例 |
| --- | --- | --- | --- | --- |
| `shopId` | integer | 否 | 店铺ID | — |

<details>
<summary>原始 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "shopId": {
      "type": "integer",
      "description": "店铺ID"
    }
  },
  "x-apifox-orders": [
    "shopId"
  ]
}
```

</details>

## 返回响应

### 200 成功

- Media Type：`application/json`

引用模型：`openJavaPartner_product_collectBox_mercadolibre_collectBox_getSizeChartDomainListResponse`（ID: `286457601`）

| 字段 | 类型 | 必填 | 说明 | 枚举/示例 |
| --- | --- | --- | --- | --- |
| `result` | string | 否 | — | — |
| `code` | string | 否 | — | — |
| `data` | object | 否 | — | — |
| `data.domains` | array | 否 | domain列表 | — |
| `data.domains[].domainId` | string | 否 | domain ID | — |
| `data.domains[].domainName` | string | 否 | domain英文名称 | — |
| `data.domains[].domainZhName` | string | 否 | domain中文名称 | — |

<details>
<summary>原始 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "result": {
      "type": "string"
    },
    "code": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "properties": {
        "domains": {
          "type": "array",
          "items": {
            "type": "object",
            "x-apifox-orders": [
              "domainId",
              "domainName",
              "domainZhName"
            ],
            "properties": {
              "domainId": {
                "type": "string",
                "description": "domain ID"
              },
              "domainName": {
                "type": "string",
                "description": "domain英文名称"
              },
              "domainZhName": {
                "type": "string",
                "description": "domain中文名称"
              }
            }
          },
          "description": "domain列表"
        }
      },
      "x-apifox-orders": [
        "domains"
      ]
    }
  },
  "x-apifox-orders": [
    "result",
    "code",
    "data"
  ]
}
```

</details>


### 500 error

- Media Type：`application/json`

引用模型：`SimpleErrorResponse`（ID: `267781751`）

| 字段 | 类型 | 必填 | 说明 | 枚举/示例 |
| --- | --- | --- | --- | --- |
| `result` | string | 是 | 返回结果 | success |
| `code` | string | 是 | 结果码/错误码 | — |
| `reason` | string | 是 | 错误信息 | 参数错误 |

<details>
<summary>原始 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "result": {
      "type": "string",
      "description": "返回结果",
      "examples": [
        "success"
      ]
    },
    "code": {
      "type": "string",
      "description": "结果码/错误码"
    },
    "reason": {
      "type": "string",
      "description": "错误信息",
      "examples": [
        "参数错误"
      ]
    }
  },
  "required": [
    "result",
    "code",
    "reason"
  ],
  "x-apifox-orders": [
    "result",
    "code",
    "reason"
  ]
}
```

</details>


## Apifox 原始补充信息

<details>
<summary>参数、公共参数与响应元数据</summary>

```json
{
  "parameters": {
    "query": [],
    "path": [],
    "cookie": [],
    "header": []
  },
  "commonParameters": {
    "query": [
      {
        "name": "XDEBUG_SESSION_START"
      },
      {
        "name": "timerToken"
      }
    ],
    "body": [],
    "cookie": [
      {
        "name": "cookie"
      },
      {
        "name": "mserp"
      },
      {
        "name": "accountId"
      }
    ],
    "header": [
      {
        "name": "X-language"
      },
      {
        "name": "Cookie"
      }
    ]
  },
  "requestBody": {
    "type": "application/json",
    "parameters": [],
    "jsonSchema": {
      "type": "object",
      "properties": {
        "shopId": {
          "type": "integer",
          "description": "店铺ID"
        }
      },
      "x-apifox-orders": [
        "shopId"
      ]
    },
    "required": false,
    "mediaType": "application/json",
    "examples": [],
    "oasExtensions": ""
  },
  "responses": [
    {
      "id": 101150187,
      "name": "",
      "code": 200,
      "contentType": "json",
      "jsonSchema": {
        "$ref": "#/definitions/286457601"
      },
      "itemSchema": {},
      "description": "成功",
      "mediaType": "application/json",
      "headers": [],
      "oasExtensions": ""
    },
    {
      "id": 198288855,
      "name": "",
      "code": 500,
      "contentType": "json",
      "jsonSchema": {
        "$ref": "#/definitions/267781751"
      },
      "itemSchema": {},
      "description": "error",
      "mediaType": "application/json",
      "headers": [],
      "oasExtensions": ""
    }
  ],
  "responseExamples": [],
  "codeSamples": [],
  "auth": {},
  "securityScheme": {}
}
```

</details>

