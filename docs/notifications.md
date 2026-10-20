# Webhook 消息与手机通知

外部系统 → Webhook → SQLite 消息及发送任务 → 个推 REST V2 → uni-push 1.0 / APNs / Android 厂商通道。

消息保存、服务商接受、系统展示、用户阅读是不同状态。Webhook 返回 202 只表示事务已保存；`accepted` 只表示个推接受了发送。

## 使用

App 或 H5 打开「消息中心 → Webhook 设置」，创建一个来源，保存当次展示的接入信息。每个来源绑定当前账号；密钥不出现在列表，重置后旧密钥立即失效，停用后拒绝接收新消息。拒绝通知权限仍可查看站内消息。

```sh
curl -X POST 'https://<服务域名>/api/v1/webhooks/<sourceId>/messages' \
  -H 'Authorization: Bearer <创建时显示的密钥>' \
  -H 'Content-Type: application/json' \
  --data '{"eventId":"backup-20261019-001","title":"备份完成","content":"数据库已备份，用时 32 秒。","data":{"taskId":"backup-001"}}'
```

响应：`{"messageId":"<UUID>","duplicate":false}`。重试必须保留 `eventId`；相同来源及 eventId 返回同一消息，不重复创建发送任务。省略 eventId 时，每次请求视为新消息。不要把 Webhook 密钥放进 URL。

输入为 JSON：标题 1–100 字符、正文 1–16000 字符、可选 eventId 1–128 字符、可选 data 对象，总请求体不超过 64 KiB；来源名称 1–80 字符。内容以纯文本呈现，不执行 HTML。每个来源每分钟最多 60 次已通过鉴权的请求（含重复请求）；计数随服务重启重置。常见错误：400 格式无效、401 密钥无效、403 来源停用、413 请求过大、429 频率超限、5xx 保存失败。5xx/网络异常/429 可退避重试。

## 消息标签与指标卡片

Webhook 顶层可选 `tags` 字符串数组，最多 10 个标签，每个标签去除首尾空格后为 1–32 字符，不可重复，区分大小写。省略时为 `[]`，旧消息也默认无标签。消息在数据库中使用 `tagsJson` 保存标签；列表和详情返回解析后的 `tags` 与 `data`。相同来源及 `eventId` 的重试保留原消息及标签。

消息中心可按单个标签筛选：`GET /api/v1/messages?tag=indicator`，可与 `before` 游标组合。返回 `total` 为筛选结果数量，`unreadCount` 始终为当前账号全部消息的未读数，`availableTags` 为当前账号所有消息使用的标签（不受当前筛选影响）。

日历筛选使用 `from`、`to` 两个毫秒时间戳，按 `createdAt >= from AND createdAt < to` 查询，可与标签、游标组合。App 根据用户本地时区计算所选日期的当天零点和次日零点；省略两者表示全部日期。必须同时提供两个有效时间戳，且 `from < to`。

`indicator` 标签使用指标信号卡片；其余标签使用普通卡片。`data` 中的 `symbol`、`indicator_name`、`period`、`signal_name` 必须为非空字符串，缺失或类型不符时显示普通卡片。`price` 为可选有限数值，未提供时显示 `—`；`test: true` 显示「模拟测试」。详情仍保留原始正文和附加数据。

指标卡片可选 `data.symbol_name` 提供标的名称，未提供时显示代码；`asset_type` 为 `stock` 时价格显示两位小数，ETF 及未指定类型时显示三位小数。可选 `data.quote_url` 提供 HTTP(S) 行情链接，未提供合法链接时列表显示「查看详情」。`notification` 标签在界面显示为「系统通知」，`indicator` 显示为「交易信号」。

指标卡片使用 `phase`（缺失时使用 `type`）区分 `preview` 盘中预警、`confirmed` 收盘确认。`confirmation` 单独展示：`pending` 待收盘确认、`confirmed` 已确认、`unconfirmed` 收盘未确认、`missing_data` 数据缺失未能确认；缺失时不推断确认结果。`delayed: true` 显示延迟确认标记。列表展示 `bar_end` 的 K 线结束时间，右上角优先使用毫秒时间戳 `ts` 的事件生成时间，缺失时沿用消息接收时间。无时区的 `bar_end` 字符串保留发送端的原始钟面时间，不做 UTC 转换。

详情展示 `data.message` 描述（缺失时回退消息正文）、K 线结束时间、事件生成时间、确认状态、是否延迟、消息接收时间。`indicator_id`、`signal_id`、`event_id`、`rule_id`、`generation`、`source`、`snapshot_id` 放在可展开的事件与规则信息中；原始消息数据另行折叠保留。

`PATCH /api/v1/messages/read-all` 使用登录 JWT，将当前账号所有未读消息（含未加载和其他标签）标记已读，保留原有已读时间，返回 `{success: true, readAt: <毫秒时间戳>}`。

消息删除同样需要登录 JWT：`DELETE /api/v1/messages/:id` 删除单条；`POST /api/v1/messages/delete` 接收 `{ "ids": ["消息UUID", "消息UUID"] }` 批量删除，每次 1–100 个不重复的 UUID。两者成功均返回 `{success: true}`。批量操作会先验证所有消息归属，混入其他账号或不存在的 ID 时整体失败；重复删除本人已经删除的消息不会报错。

迁移 `1710000000009` 添加 `deletedAt`。删除后消息不再出现在列表、详情、未读统计和标签分类中，待发送任务取消。数据库保留原始记录及 `eventId`，同一事件重试不会重新创建消息。已经交给系统推送服务的通知无法撤回。

```json
{
  "eventId": "indicator-20261020-001",
  "title": "指标监控",
  "content": "159605.SZ 天使魔鬼 · 30分钟 · 进攻信号",
  "tags": ["indicator", "etf"],
  "data": {
    "symbol": "159605.SZ",
    "indicator_name": "天使魔鬼",
    "period": "30m",
    "signal_name": "进攻",
    "price": 1.25,
    "test": true
  }
}
```

更新后端后，启动时自动执行迁移 `1710000000008`，增加 `tagsJson` 列，不改变旧消息的正文与附加数据。发送端需显式添加 `tags: ["indicator"]` 才会使用指标卡片。

## 推送服务配置

后端 `.env.production`（本地开发用 `.env`）设置：

```dotenv
GETUI_APP_ID=
GETUI_APP_KEY=
GETUI_MASTER_SECRET=
GETUI_ANDROID_PACKAGE=
```

前三项从 DCloud 开发者中心的 uni-push 1.0 应用信息获取。最后一项必须是 HBuilderX 云打包时实际使用的 Android 包名，用于生成厂商通知点击 Intent。凭据留在部署环境，不提交到 Git。缺少配置时消息照常保存，任务保持待发送至过期。

`HStudioApp/src/manifest.json` 已启用 Push 模块、uni-push 1.0、Android 通知权限和 iOS 手动权限申请。仍须在 DCloud 开发者中心开通对应 AppID 的 uni-push、配置 Android 各厂商参数、上传 iOS 推送证书，并使用匹配包名、签名与推送能力的描述文件重新打包。不要用标准调试基座的 CID 验证正式包离线推送。私有 APK 在部分厂商品牌上受上架/资质条件限制。

参考：[DCloud uni-push 1.0](https://uniapp.dcloud.net.cn/unipush-v1.html)、[个推 REST V2](https://docs.getui.com/getui/server/rest_v2/push/)、[HTML5+ Push](https://www.html5plus.org/doc/zh_cn/push.html)。

## 数据与发送规则

- 迁移 `1710000000007` 增加 `webhook_sources`、`hub_messages`、`push_devices`、`push_deliveries`。沿用现有启动迁移和 SQLite 持久卷；正式更新前停止服务并备份数据库。消息不自动清理。
- 来源密钥使用 32 字节随机数，保存 SHA-256 摘要并恒时比较。消息与当时有效设备的任务在同一事务写入；没有设备时只保存消息，不为后来登录的手机补发历史通知。
- 单实例每 3 秒处理最多 20 个任务。临时错误按 5 秒起指数退避，最多间隔 5 分钟、总计 8 次尝试。启动恢复 `sending` 任务。失效会话、解绑、更换账号/CID 和过期任务会取消；发送途中撤销不能撤回已交给服务商的通知。
- 通知 TTL 为接收后 1 小时，推送仅包含标题、最多 160 字符摘要、消息 ID、账号 ID 及过期时间。data 和完整正文仅通过 JWT 接口读取。标题和摘要会经过个推及对应厂商服务，并可能显示在锁屏上。
- Android 通知按厂商最小限制截取标题 32 字符、正文 100 字符；点击 payload 只带标识和过期时间，并保证编码后的 Intent 不超过 2048 字符。消息详情保留完整文本。参见[个推公共参数](https://docs.getui.com/getui/server/rest_v2/common_args/)。
- 在线发送自定义透传结构，避开 uni-push 自动展示格式，由 App 创建本地通知。客户端持久化最近 200 个通知去重标识，避免本地消息回调和重复接收再次展示；离线由系统展示。服务商超时后的重试可能造成重复的离线通知，不能承诺端到端 exactly-once。
- Android 厂商通道与 iOS APNs 配置、通知权限、省电策略、系统强制停止、断网均影响实际展示。消息列表为最终可查询记录。H5 不调用原生 API，前台每 30 秒检查最新消息，重新显示立即检查；检查只更新已读状态和未读数，新消息通过浮动提示呈现，不重置已加载历史或滚动位置。
- CID 绑定安装、账号、登录会话。相同绑定重复注册不取消任务；退出当前设备、退出全部设备、撤销会话、Refresh Token 被判无效时禁用对应绑定。App 退出登录先请求后端撤销，失败时保留登录态并提示重试。

## 业务接口

除 Webhook 接收接口使用来源密钥外，以下接口均需现有 JWT；所有查询及修改按当前账号隔离。

| 方法与路径（前缀 `/api/v1`） | 用途 |
| --- | --- |
| `GET /webhook-sources` | 来源列表，不含摘要或密钥 |
| `POST /webhook-sources` | `{name}` 创建，返回一次性 secret |
| `PATCH /webhook-sources/:id` | `{name?,enabled?}` 修改 |
| `POST /webhook-sources/:id/reset-secret` | 返回新 secret |
| `GET /push-devices` | 推送配置状态及本人设备，不返回 CID |
| `POST /push-devices` | `{installationId,cid,platform,enabled}` 幂等绑定当前会话；platform 为 android/ios |
| `DELETE /push-devices/:id` | 解绑当前会话的设备 |
| `GET /messages?page=1` | 每页 20 条，返回 items、total、unreadCount、page、pageSize、nextCursor |
| `GET /messages?before=<nextCursor>` | 触底查询更早的 20 条；按 createdAt、id 稳定排序，nextCursor 为 null 时结束；保留旧 page 参数兼容 |
| `GET /messages/:id` | 完整消息、data 和设备发送状态 |
| `PATCH /messages/:id/read` | 幂等标记已读（同账号设备共享） |

消息列表触底自动加载，失败保留列表和游标并提供重试；下拉刷新或点击新消息提示才重新加载第一页。返回列表保留历史，详情已读通过账号隔离的事件同步到历史条目。

发送状态：`pending` 待发送、`sending` 发送中、`accepted` 服务商接受、`failed` 失败、`cancelled` 取消。客户端不会将 accepted 标成已送达。

## 验证

后端：`npm run check`、`npm run build`、`npm test`。新增测试使用独立临时 SQLite，覆盖 HTTP 鉴权/校验/限流、并发幂等、事务回滚、重启恢复、账号隔离、多设备和会话撤销；个推请求通过模拟响应验证鉴权与 Android/iOS 报文，不发送真实通知。

App：`pnpm type-check`、`pnpm test:notifications`、`pnpm build:h5`、`pnpm build:custom`。客户端测试覆盖在线去重、iOS 后台避免重复、过期/错账号过滤、通知点击等待登录恢复、权限与 H5 降级。

签名包真机仍需分别验证 Android/iOS 前台、后台、锁屏、进程结束、强制停止、拒绝权限、通知点击冷启动、CID 变化、切换账号与断网恢复。构建通过不能替代上述验收。
