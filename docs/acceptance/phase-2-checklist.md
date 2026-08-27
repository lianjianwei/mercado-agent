# Phase 2 妙手同步与工作台验收记录

验收日期：2026-08-27（Asia/Shanghai）

## 自动化验证

- [x] `npm test` 全量测试通过：26 个测试文件、115 项测试。
- [x] `npm run typecheck` 与 `npm run lint` 通过。
- [x] `npm run package` 正式打包通过。
- [x] `npm run test:e2e:run -- tests/e2e/workbench-sync.spec.ts` 通过同步、详情、远端缺失、快照保留和重启持久化验证：1 项通过。
- [x] 占位与泄密扫描通过：真实 App Key/Secret 未出现在 Git 跟踪或未跟踪文件中，无待替换占位；Renderer 中仅保留既有凭证表单字段引用，无凭证字面量或网关签名逻辑。

## 真实账号只读契约

真实请求只允许读取采集箱列表和详情。默认只读使用 Mercado Agent 本地 SQLite 中已保存的凭证；也可通过环境变量覆盖。脚本不写入凭证，不记录响应正文；契约失败时仅输出字段路径、类型和校验问题。

```bash
RUN_MIAOSHOU_READ_ACCEPTANCE=1 npm run verify:miaoshou-read
```

- [x] `notPublished` 列表包含用于验收的测试商品；真实账号读取到第一页 20 条、第二页 10 条。
- [x] `timingPublish`、`published` 状态枚举与妙手后台一致；本次定时发布为 0 条，已发布前两页各 20 条。
- [x] 第一页、第二页和 `hasMore` 的抽样分页行为一致且跨页无异常重复；真实响应未提供 `total`，客户端按固定每页 20 条推导是否继续翻页。
- [x] 至少一个详情可读取，详情 ID 与列表 ID 一致。
- [x] 标题、商品编号、图片和属性字段与妙手后台完成人工逐项抽查；自动验收已确认标题、图片和属性可读。
- [x] 真实响应与原 schema 的差异已据实更新 schema、mapper 和合成契约 fixture，且未保存原始响应。

字段差异记录（不含响应值）：

- 列表响应不提供 `total`，服务端固定每页 20 条；`itemNum`、`breadcrumb`、`cid`、`editModel`、`subAppAccountId`、`remark` 可能为 `null`。
- 详情属性规则的 `values` 可能为 `null`；属性值的 `metadata` 可能为 `null`。
- 详情 `siteCollectItemInfo` 中 `itemNum`、`firstSkuKey`、`warrantyTime`、`hasSaveSite`、`saveDetailTs`、`hasSavePrice`、`site`、`registrationType` 可能为 `null`。
- 连续列表请求会收到未文档化的安全业务错误；网关按前一请求完成时间间隔 1.1 秒后，真实账号列表第二页与详情读取通过。
- 真实只读验收结果：未发布 20+10 条、定时发布 0 条、已发布抽查 20+20 条，跨页重复 ID 均为 0，详情标题、图片和属性可读。

## 工作台真实同步记录

验收日期：2026-08-27（Asia/Shanghai）。在打包应用中通过“同步未发布商品”按钮，以本地 SQLite 已保存凭证同步真实账号：

- 同步结果：本地数据库新增未发布商品 29 条，快照 29 条；定时发布、已发布、远端缺失均为 0。
- 商品字段均已填充可读：标题、商品编号、缩略图、最后同步时间（同步后立即显示当前时间）。
- 列表与详情关键字段一致；仅列展示只读概要，无编辑或发布入口。

## 工作台滚动修复

验收时发现表格滚动时整个右侧/表头一起上移；已修复为仅表格内容滚动：

- 工作台视图固定为视口高度，顶部工具栏、状态标签、分页控件和右侧快速检查面板保持固定。
- 表格容器独占剩余空间并纵向滚动，表头行随内容滚动保持固定（`position: sticky`）。
- 提交：`fix: scroll only the workbench product table body`（随 Phase 2 合并进 main）。

## 工作台人工复核

- [x] 默认进入“未发布”，真实测试商品的标题、编号、缩略图和最后同步时间正确。
- [x] “未发布”“定时发布”“已发布历史”“远端缺失”“全部记录”可区分。
- [x] 双击商品显示只读详情概要，不出现编辑或发布入口。
- [x] 单个商品同步失败时显示商品 ID 与安全错误信息，其他商品继续同步。
- [x] 本地已有商品在远端三状态均消失后标记为 `missing`，商品与快照历史仍保留。
- [x] UI、日志、测试输出和 Git diff 中均不出现妙手 App Secret。

## 阶段结论

- [x] 用户明确确认“阶段 2 通过”。
