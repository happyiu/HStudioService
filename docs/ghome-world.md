# GHome 世界运行系统 v1

`GhomeWorldModule` 与 QWeather 模块独立。每个登录账号有一座岛，世界及操作回执由 TypeORM/SQLite 保存；启动时自动运行 `InitGhomeWorld1710000000004`。Colyseus 使用 Nest 的 HTTP server 和 `PORT`，单实例部署，不需要另外开放端口。服务器可独立构建，运行时不读取 HStudioApp。

## 协议

所有 HTTP 路径从 `/api/v1/ghome/world` 开始，必须携带现有 Bearer JWT，账号归属从 JWT 获取，不接受 ownerId。Swagger 在 `/docs`。

| 方法 | 子路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 完整地图及运行快照；未创建返回 404 |
| POST | `/bootstrap` | 可选 snapshot、appearance；已有世界直接返回，绝不覆盖 |
| POST | `/join` | 返回 `ghome_world` 席位，用 SDK `consumeSeatReservation` 消费 |
| POST | `/map` | commandId、baseMapRevision、snapshot；冲突 409，验证失败 400 |

地图请求体上限 2 MiB，完整地图不进入 Colyseus state。动态 state 的 `session` 是 JSON 字符串，包含世界 ID、地图版本、服务器时间、时间天气、角色、生物、资源、作物。首版使用一个 Schema 字段，便于跨 renderjs 传递；规模扩大时可改为细粒度 Schema。

房间消息：`move`（x/y/facing）、`checkpoint`（creatures）、`command`（commandId/type/payload）。经营 type 为 plant/harvest/appearance/environment；农田 payload 为 column/row。成功事务提交后发 `result`；失败返回 ok=false/status/message。保存故障发 `save-error`。commandId 为 1–80 位字母、数字、下划线或短横线，同世界同 ID 同内容返回原回执，异内容拒绝；前端不能把旧回执当作最新世界状态。

原生 create/join/joinOrCreate 不暴露，只允许续接已认证席位。新连接接管旧连接，关闭码 4100；登录失效 4101。4100 不使用 SDK 的 4010 自动重连码。短暂断线给服务器席位 30 秒续接期；超时、重启或登录到期后，Vue 通过 requestHub 刷新 JWT、重新预约同一世界。

## 保存与时间

模块写操作串行执行。地图、经营、外观、环境更改与去重回执处于同一数据库事务，失败不发布变更。角色移动校验身体占地、路径及速度；交互距离严格小于 34 像素。位置每 5 秒保存，关键事务保存最新有效位置，正常停机/空房销毁补存。异常停机最多回退 5 秒的位置，已确认经营不会丢失。

现实 24 分钟为一天，每 7 天换季，初始第 1 天 08:00；天气根据世界种子、日期、季节确定。时间由持久化锚点计算，不依赖房间运行。environment 仅允许非 production 环境修改，时间天气由服务器验证并持久化。

通用蔬菜在 0/100/200/300 秒进入 0/1/2/3 阶段。300 秒后可收获，永不自动收获或枯萎。新世界种子 20，种植 -1，收获蔬菜 +1、种子 +1。地图上传的作物阶段不影响生长与资源；未收获的格子不能删除或覆盖。

生物实例 ID 为 `type:spawnIndex`，沿用客户端闲逛，保存合法位置和朝向，恢复后重建 idle 行为计时器。离线停止闲逛；无水地图不创建鱼。目录参数在 `core/catalog.json`，新增生物或修改身体尺寸时同步更新该文件。

## 前端与迁移

初始化顺序为读取/创建世界 → 预约 → 连接 → 恢复地图和运行状态 → 开放操作。Vue 使用 requestHub 和 uni 存储；renderjs 使用 SDK 与 Phaser。新账号固定使用 `core/default-island.json` 中的用户提供的 128×96 默认地图（种子 `海岛-128-demo`，陆地比例 75%，大陆位置上/下/左，出生点 2/40），不再自动上传本地地图，也不额外铺设农田。外观可以首次沿用本地设定，原本地存档键不写入、不删除。已有世界始终恢复服务端存档；显式 snapshot 导入接口仍保留。默认模板保存完整地形快照，每次创建都复制，不根据种子重新生成；编辑一座岛不会影响后续新岛。测试固定其 SHA-256，防止误换成其他默认布局。

缓存按服务地址和账号隔离，只用于断线展示。断线保留画面，暂停经营和建造；新设备接管停止旧设备重连。地图修改等待 HTTP 确认，等待期间暂停后续编辑；失败恢复服务器地图并清理失效撤销记录。服务器状态更新不进入撤销历史。H5 visibility/pagehide 和 App、页面 onShow/onHide 提供补存机会，持久化不依赖卸载事件。

## 开发验证

```sh
npm test
npm run check
npm run build
```

测试使用临时 SQLite 和可控时钟，包含真实 HTTP/WebSocket、30 秒席位续接、同账号接管、空房销毁、服务关闭再启动。地图规则字节一致性测试要求 HStudioApp 与 HStudioService 位于同一父目录；部署构建不依赖前端目录。

前端执行 `pnpm test:ghome-build`、`pnpm type-check`、`pnpm build:h5`、`pnpm build:custom`。App 构建通过不等于真机验证。探险、AI 经营、工坊及多实例调度不在 v1 范围。
