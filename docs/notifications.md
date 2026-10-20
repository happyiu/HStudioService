# Webhook 消息与手机通知

外部系统 → Webhook → SQLite 消息及发送任务 → 个推 REST V2 → uni-push 1.0 / APNs / Android 厂商通道。

消息保存、服务商接受、系统展示、用户阅读是不同状态。Webhook 返回 202 只表示事务已保存；`accepted` 只表示个推接受了发送。

## 使用

App 或 H5 打开侧边栏的「Webhook 管理」，创建一个来源，保存当次展示的接入信息。每个来源绑定当前账号；密钥不出现在列表，重置后旧密钥立即失效，停用后拒绝接收新消息。手机打开「消息中心」，点击「开启 / 管理系统通知」。拒绝通知权限仍可查看站内消息。

```sh
curl -X POST 'https://<服务域名>/api/v1/webhooks/<sourceId>/messages' \
  -H 'Authorization: Bearer <创建时显示的密钥>' \
  -H 'Content-Type: application/json' \
  --data '{"eventId":"backup-20261019-001","title":"备份完成","content":"数据库已备份，用时 32 秒。","data":{"taskId":"backup-001"}}'
```

响应：`{"messageId":"<UUID>","duplicate":false}`。重试必须保留 `eventId`；相同来源及 eventId 返回同一消息，不重复创建发送任务。省略 eventId 时，每次请求视为新消息。不要把 Webhook 密钥放进 URL。

输入为 JSON：标题 1–100 字符、正文 1–16000 字符、可选 eventId 1–128 字符、可选 data 对象，总请求体不超过 64 KiB；来源名称 1–80 字符。内容以纯文本呈现，不执行 HTML。每个来源每分钟最多 60 次已通过鉴权的请求（含重复请求）；计数随服务重启重置。常见错误：400 格式无效、401 密钥无效、403 来源停用、413 请求过大、429 频率超限、5xx 保存失败。5xx/网络异常/429 可退避重试。

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
