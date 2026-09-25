# Home Hub 后端 Web 服务技术方案

针对你现在的家庭服务器环境，我建议为 App 开发一个独立的 Home Hub Server（家庭服务管理后端）。

这个后端的定位不是重新实现 PVE、飞牛 NAS、Lucky 等服务，而是作为它们的统一管理入口，为 uni-app 提供登录鉴权、站点配置、服务监控和后续扩展能力。

你目前提出的三个核心功能是：

1. 登录鉴权：用户登录后返回 Token，后续请求统一验证身份。

2. Lucky 数据：获取已有的反向代理规则、站点域名和服务配置，自动生成 App 中的站点列表。

3. 服务监控：监控 PVE、虚拟机、NAS、Docker 和其他网络设备的在线状态、资源使用情况及服务可用性。

我建议采用 NestJS + TypeScript + SQLite + Redis（可选）+ Docker 部署，前端使用 Vue 3 + Vite 开发一个轻量级 Web 管理后台。

你已经熟悉 Node.js、Vue 和 Docker，这套组合能够充分复用现有经验，也方便以后把 Home Hub 从站点聚合工具扩展为家庭服务器监控控制台。

## 一、整体架构

建议将整个系统划分为四层：

客户端

uni-app App + Vue 3 Web 管理后台

统一登录、服务入口、监控面板、站点管理、告警设置

网络入口层

Lucky 反向代理 / HTTPS / VPN

Home Hub Server

Auth

登录与 Token

Sites

Lucky 站点同步

Monitor

状态与资源采集

Alert

异常告警

SQLite · Redis（可选）· 定时任务

现有家庭服务器与服务

Lucky

PVE

fnOS

Docker

iKuai

Hermes

这里有一个重要的设计原则：

App 打开站点走原来的 Lucky 反向代理；只有登录、站点配置和监控数据等新功能才走 Home Hub Server。

例如，用户点击 App 中的 PVE 卡片时，WebView 直接访问 PVE 的 HTTPS 地址，不需要让 Node.js 后端转发整个 PVE 网页。

这样既减少了后端负担，也能保留各个现有服务独立升级、运行和登录的能力。


## 二、Web 服务技术栈选型

我建议后端采用模块化单体架构：一个 NestJS 项目，内部划分登录、Lucky、监控等模块。

你的家庭服务器只有一套管理系统，不需要为了几个功能引入微服务、消息队列、服务注册中心或 Kubernetes。

![Maximizing Efficiency with Task Scheduling in NestJS: A Practical Guide](https://images.openai.com/static-rsc-4/BsvFmT0jxQrm5MuWwNWJVq_XYhNdZeF9TgIalZgfo45erzaCgTZobZEUuHFK6eSHBn9WvAlxQVI2X6wjcEB18O3c9VuTl0AYCaXfeDs4S9HJWcCzuDUOsaUOBBPpU5MiyeynNs2Tkf0rV4VpINRG_qzXlS93bewJum32CC0sauY?purpose=inline)

## NestJS + TypeScript

后端核心框架

适合将鉴权、Lucky 接入、设备监控、任务调度和实时消息分别封装为独立模块。后续新增 PVE、Docker 等设备适配器也比较方便。

<table class="_6IUVGW_Table" data-d-column-sizing="auto" data-d-dividers="" style="table-layout: auto;"><tbody><tr data-d-component="table-row"><td data-d-component="table-cell" data-d-has-width="" data-d-valign="start" style="width: 35%;">运行环境</td><td data-d-component="table-cell" data-d-valign="start">Node.js LTS + pnpm</td></tr><tr data-d-component="table-row"><td data-d-component="table-cell" data-d-valign="start">后端框架</td><td data-d-component="table-cell" data-d-valign="start">NestJS + TypeScript</td></tr><tr data-d-component="table-row"><td data-d-component="table-cell" data-d-valign="start">HTTP 服务</td><td data-d-component="table-cell" data-d-valign="start">默认 Express 适配器</td></tr><tr data-d-component="table-row"><td data-d-component="table-cell" data-d-valign="start">数据库</td><td data-d-component="table-cell" data-d-valign="start">SQLite + TypeORM</td></tr><tr data-d-component="table-row"><td data-d-component="table-cell" data-d-valign="start">身份认证</td><td data-d-component="table-cell" data-d-valign="start">JWT + Refresh Token + Argon2id</td></tr><tr data-d-component="table-row"><td data-d-component="table-cell" data-d-valign="start">接口验证</td><td data-d-component="table-cell" data-d-valign="start">class-validator + class-transformer</td></tr><tr data-d-component="table-row"><td data-d-component="table-cell" data-d-valign="start">外部服务请求</td><td data-d-component="table-cell" data-d-valign="start">Axios / @nestjs/axios</td></tr><tr data-d-component="table-row"><td data-d-component="table-cell" data-d-valign="start">后台定时任务</td><td data-d-component="table-cell" data-d-valign="start">@nestjs/schedule</td></tr><tr data-d-component="table-row"><td data-d-component="table-cell" data-d-valign="start">实时数据</td><td data-d-component="table-cell" data-d-valign="start">SSE，按需增加 Socket.IO</td></tr><tr data-d-component="table-row"><td data-d-component="table-cell" data-d-valign="start">API 文档</td><td data-d-component="table-cell" data-d-valign="start">Swagger / OpenAPI</td></tr><tr data-d-component="table-row"><td data-d-component="table-cell" data-d-valign="start">部署</td><td data-d-component="table-cell" data-d-valign="start">Docker Compose + Lucky HTTPS</td></tr></tbody></table>

NestJS 官方提供 JWT 鉴权、TypeORM 数据库集成和定时任务组件，可以直接作为上述架构的基础。

![](https://www.google.com/s2/favicons?domain=https://docs.nestjs.com\&sz=32)

NestJS - A progressive Node.js framework

+2

### 1. 为什么选择 NestJS，而不是 EggJS？

你现在的项目可以继续使用 EggJS，但我更倾向于 NestJS。

主要是因为你要接入的设备和系统越来越多，后端最终可能存在以下模块：

```
AuthModule
LuckyModule
PveModule
DockerModule
NetworkModule
MonitorModule
AlertModule
```

NestJS 的依赖注入、模块组织、Guard 和定时任务机制比较适合这种结构。

不过，如果你想直接复用一个现成的 EggJS 项目，完全没有必要为了框架迁移而重写。这里的 NestJS 是新建后端项目时的技术选择。

### 2. 数据库：第一版直接使用 SQLite

你目前需要保存的数据主要包括用户、登录会话、站点配置、设备信息、监控任务、状态记录和告警记录。

对于单人或少量家庭成员使用、单实例运行的服务，SQLite 足够作为第一版数据库。

通过 TypeORM 可以直接使用 SQLite，未来如果确实出现大量并发写入或多实例部署需求，再考虑 PostgreSQL。

![](https://www.google.com/s2/favicons?domain=https://docs.nestjs.com\&sz=32)

NestJS - A progressive Node.js framework

+1

我不建议现在就为了这个项目部署 MongoDB + MySQL + Redis 三套存储。

SQLite 只需要持久化一个数据库文件，备份和迁移都比较简单。

监控数据需要设置保留期限，避免将每次检测得到的原始数据无限制写入数据库。

### 3. Redis：目前不必部署

Redis 可以用于缓存、会话、分布式任务和消息广播，但第一版只有一个 Node.js 实例，没有必要额外增加服务。

你可以先使用：

* SQLite 保存用户、Refresh Token 会话和监控历史。

* 内存缓存保存最近一次服务监控结果。

* NestJS Scheduler 执行周期性检测。

如果后续要运行多个后端实例，或者需要持久化任务队列、分布式锁等，再加入 Redis。

第一版实际只需要一个 Node.js 容器和一个 SQLite 数据文件。

## 三、功能模块 1：登录鉴权与 Token

建议为 Home Hub 建立独立的身份认证机制，不要直接使用 Lucky、PVE 或 Hermes 的管理员 Token 作为 App 的登录凭据。

三个系统的 Token 应该完全隔离。

uni-app 登录页面

用户名 + 密码

AuthModule

校验用户 · 密码 · 账号状态

返回 Access Token + Refresh Token

Access Token 用于 API 请求，Refresh Token 用于续期

### Token 设计

|
类型

|

建议有效期

|

用途

|
| --- | --- | --- |
|

Access Token

|

15 分钟

|

App 日常调用后端 API

|
|

Refresh Token

|

30 天以内

|

获取新的 Access Token

|

Access Token 使用 JWT，包含用户 ID、会话 ID、签发时间和过期时间。不要将用户密码或其他服务的凭据写进 JWT。

Refresh Token 建议使用随机生成的不透明字符串，而不是再签发一个长期有效的管理员 JWT。

服务端只保存 Refresh Token 的哈希值，并将其与设备会话关联。每次刷新时轮换 Refresh Token，旧 Token 立即失效；如果检测到旧 Token 被重复使用，可以撤销对应的会话族。

这样用户可以长期保持登录，而不需要让一个具有管理权限的 JWT 持续有效 30 天。

### 建议实现的 API

|
方法

|

接口

|

功能

|
| --- | --- | --- |
|

POST

|

`/api/v1/auth/login`

|

用户登录

|
|

POST

|

`/api/v1/auth/refresh`

|

刷新 Token

|
|

POST

|

`/api/v1/auth/logout`

|

退出当前设备

|
|

POST

|

`/api/v1/auth/logout-all`

|

撤销所有登录设备

|
|

GET

|

`/api/v1/auth/me`

|

获取当前用户信息

|
|

GET

|

`/api/v1/auth/sessions`

|

查看已登录设备

|
|

DELETE

|

`/api/v1/auth/sessions/:id`

|

撤销指定设备会话

|

登录成功后，返回格式可以约定为：

JSON

```
{
  "accessToken": "<ACCESS_TOKEN>",
  "refreshToken": "<REFRESH_TOKEN>",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "user": {
    "id": "user_001",
    "username": "admin",
    "role": "admin"
  }
}
```

这里的 Token 字符串是接口结构占位符，并非真实凭据。

### App 如何保存 Token？

Android 和 iOS 端建议使用系统安全存储机制，例如 Android Keystore、iOS Keychain，通过经过验证的原生插件进行封装。

Access Token 可以主要保存在运行时内存中，Refresh Token 存放在安全存储中。

不建议直接使用普通的 `uni.setStorageSync()` 长期明文保存 Refresh Token。

Web 管理后台则可以采用另一种方式：通过受保护的 HttpOnly、Secure、SameSite Cookie 维护刷新会话，减少 JavaScript 直接接触长期凭据的机会。

服务端还需要实现登录限流、失败次数限制、密码哈希、首次管理员初始化、重要操作重新验证等安全措施。

## 四、功能模块 2：Lucky 数据接入

这是你整个项目里比较有特点的功能。

你已经通过 Lucky 管理多个反向代理站点。后端的 LuckyModule 可以将这些配置读取出来，转换为 App 能直接使用的站点列表。

### 1. Lucky 能不能直接通过 API 读取规则？

可以将 API 读取作为优先方案。

Lucky 官方文档明确介绍了 OpenToken，允许第三方程序通过它调用 Lucky 后端接口，且 Lucky 本身具有 Web 服务主规则、子规则和反向代理配置。

![](https://www.google.com/s2/favicons?domain=https://lucky666.cn\&sz=32)

Lucky开发分享

+2

不过，当前公开文档没有让我确认到适用于你所安装版本的完整「Web 服务规则列表」接口路径、请求参数和响应结构。

因此，第一步应当在你自己的 Lucky 管理页面中确认实际接口，而不是根据网上其他版本的接口直接写死。

具体可以这样做：

1. 打开 fnOS 中的 Lucky 管理页面，进入「Web 服务规则列表」。

2. 在浏览器开发者工具中打开 Network，选择 Fetch/XHR。

3. 刷新规则列表，找到返回主规则、子规则数据的请求。

4. 记录请求路径、请求方法、字段结构和认证方式，在隔离环境中验证 OpenToken 是否支持这个读取接口。

使用测试账号或专用凭据进行验证，不要把 Lucky 管理员 Cookie 或 OpenToken 粘贴到 App、提交到 Git 仓库，或者放到前端配置文件中。

如果实际版本支持读取规则，就把对应的路径和数据结构封装到 `LuckyAdapter` 内部。

### 2. LuckyModule 应该做什么？

我建议它包含三个独立功能：

规则读取

从 Lucky 获取已配置的 Web 服务规则，并提取前端域名、监听端口、TLS、目标地址、规则状态等必要字段。

站点同步

将 Lucky 规则转换为 Home Hub 的站点记录，识别新增、修改和已删除规则，保留用户自定义的图标、名称和排序。

站点访问控制

决定哪些站点允许在 App 中显示、哪些只能通过 VPN 打开、哪些属于内部管理服务，不向普通用户展示。

### 3. 不要直接把 Lucky 原始数据返回给 App

Lucky 规则可能包含内网 IP、管理后台地址、认证配置等信息。

建议在后端进行字段过滤和标准化，只返回 App 打开站点真正需要的数据。

例如：

JSON

```
{
  "id": "site_pve",
  "name": "PVE 虚拟机管理",
  "icon": "server",
  "category": "system",
  "url": "https://pve.example.com",
  "accessMode": "vpn",
  "enabled": true,
  "favorite": true,
  "order": 1
}
```

`url` 是已经由服务端校验和批准的站点访问地址，不是用户可以任意指定的请求转发目标。

尤其不能让 App 传入任意 URL，再由服务器携带 Lucky 管理凭据去请求，否则容易出现 SSRF（服务端请求伪造）及凭据泄露风险。

### 4. 站点同步不能简单地全量覆盖

假设你在 Lucky 中新增了一个反向代理规则，Home Hub 应该自动创建对应的站点。

但如果你已经在 App 中设置了站点名称、图标和排序，再次同步时不应该把这些自定义配置覆盖掉。

建议采用以下数据归属设计：

|
配置项

|

数据来源

|
| --- | --- |
|

反向代理规则 ID

|

Lucky

|
|

原始前端域名、端口、协议

|

Lucky

|
|

规则启用状态

|

Lucky

|
|

App 显示名称

|

Home Hub

|
|

站点图标、分类、排序

|

Home Hub

|
|

是否在 App 中展示

|

Home Hub

|
|

是否需要 VPN 访问

|

Home Hub

|

如果 Lucky 中的某个规则被删除，Home Hub 应该先将对应站点标记为 `missing`，而不是立即删除用户自定义配置和监控历史。

第二阶段先只提供手动同步按钮，自动同步后续按实际需要再增加。

### 5. Lucky 相关接口

```
GET    /api/v1/lucky/status
POST   /api/v1/lucky/sync

GET    /api/v1/sites
GET    /api/v1/sites/:id
PATCH  /api/v1/sites/:id
```

其中 `/api/v1/lucky/*` 是你自己开发的 Home Hub 接口，不是 Lucky 官方接口。

第一版建议只读 Lucky 配置，不开放新增、删除、修改 Lucky 反向代理规则的能力，避免 App 的一个误操作影响整个家庭网络的访问入口。


## 五、功能模块 3：服务监控系统

监控模块建议分成两种能力：

第一种是可用性监控，判断服务能否正常访问；第二种是资源监控，获取 CPU、内存、磁盘、网络和虚拟机运行状态。

这两种监控不能完全混为一谈。

例如，PVE 主机可能在线，但其中一台虚拟机已经停止；也可能 PVE 的 Web 管理页面无法打开，但节点上的虚拟机仍然正常运行。

因此，我建议后端使用统一的 MonitorModule，内部通过不同的监控适配器采集数据。

### 1. 服务可用性监控

对于 Lucky 中已经配置好的所有站点，可以先建立通用的 HTTP/HTTPS 监控。

## 服务监控面板

示意数据

PVE 管理后台

28 ms

在线

飞牛 NAS

36 ms

在线

Homarr

42 ms

在线

Hermes AI

超时

异常

建议实现以下几种检测方式：

|
监控类型

|

检测内容

|

适用场景

|
| --- | --- | --- |
|

HTTP/HTTPS

|

HTTP 状态码、响应时间、响应内容

|

普通 Web 站点

|
|

TCP

|

指定 IP 和端口是否接受连接

|

SSH、数据库、非 HTTP 服务

|
|

ICMP

|

设备是否响应 Ping

|

路由器、交换机、物理主机

|
|

WebSocket

|

握手和必要的应用层通信

|

Hermes 等实时服务

|
|

API Health

|

业务接口返回的健康状态

|

自己开发的服务

|

对于 Hermes，尤其要注意：网页首页返回 HTTP 200，并不代表 Socket.IO 连接或者 AI 服务本身正常。

你可以分别监控 Web UI、Socket.IO 握手和真正的业务健康接口，但业务健康检测应当使用受支持的只读接口，避免周期性创建真实 AI 会话。

对于需要登录的管理站点，返回 401、403 或跳转到登录页不一定代表服务不可用。

需要针对每个站点定义成功条件，或者优先使用独立的健康检查接口。

### 2. 服务状态如何判断？

我建议不要一次请求超时就立即标记离线。

可以采用下面的状态机：

UNKNOWN：尚未检测

UP

检测通过

DEGRADED

超时或部分检测异常

DOWN

连续检测失败，确认服务不可用

建议默认参数如下：

|
参数

|

初始建议

|
| --- | --- |
|

检测间隔

|

30 秒

|
|

单次超时

|

5 秒

|
|

连续失败阈值

|

3 次

|
|

恢复阈值

|

连续成功 2 次

|
|

最近原始记录

|

保留 7 天

|
|

历史可用率

|

按小时或天聚合保存

|

例如，某服务连续三次检测失败后，才将状态变更为 DOWN；恢复后连续两次检测成功，再标记为 UP。

这些阈值应该在后端配置，而不是写死在监控代码中。

另外，必须分别监控站点的内网地址和外网入口。

例如，PVE 内网管理页面正常，但 Lucky 的公网 HTTPS 入口不可用时，应该显示为「内网正常、外网异常」，而不是简单地判断 PVE 离线。

服务端执行的外网检测也只代表服务端所在网络的访问结果。如果你希望确认手机移动网络能否访问，后续可增加 App 侧检测，或者部署独立的外部探测节点。

### 3. PVE 资源监控

PVE 可以直接使用它自己的 API 获取节点、虚拟机以及容器相关数据。

建议为 Home Hub 单独创建只读的 PVE API Token，而不是复用 root 管理员凭据。PVE 官方管理指南也提供了通过权限分离 Token 进行监控的配置方式。

![](https://www.google.com/s2/favicons?domain=https://pve.proxmox.com\&sz=32)

Proxmox VE

第一阶段可以采集：

|
监控对象

|

指标

|
| --- | --- |
|

PVE 节点

|

CPU、内存、运行时间、节点状态

|
|

虚拟机

|

开机/关机、CPU、内存、运行时间

|
|

LXC 容器

|

运行状态、CPU、内存

|
|

存储

|

容量、使用量、可用空间

|
|

集群

|

节点及资源状态（如适用）

|

PVE 监控建议单独封装为 `PveAdapter`，不要把具体 API 请求写进通用的 MonitorService。

后续需要新增虚拟机启停控制时，也可以在独立的控制模块中使用不同权限的凭据，而不是扩大监控 Token 的权限。

### 4. fnOS、Docker 和其他设备监控

其他服务可以按支持的接口分别接入：

飞牛 NAS

优先使用当前版本能够提供的状态接口；如果没有稳定的公开接口，可以考虑部署只读的系统指标采集组件，获取 CPU、内存、磁盘容量和网络流量。

Docker

可以使用 Docker Engine API 获取容器列表、运行状态和资源数据。第一版建议通过受限的本地采集组件获取必要信息，不直接将 Docker Socket 暴露给 Home Hub 主服务或公网。

iKuai、iStoreOS

优先验证当前固件支持的状态 API、SNMP 或其他只读采集方式。暂时没有合适接口时，先使用 ICMP、TCP 或 HTTP 检测在线状态。

Docker 官方明确指出，Docker Daemon 的控制接口具有很高权限，可以通过容器挂载主机目录等方式影响宿主机。因此不要为了查询容器状态就直接将 Docker Socket 开放到公网。

![](https://www.google.com/s2/favicons?domain=https://docs.docker.com\&sz=32)

Docker Docs

+1

如果需要通过标准化组件获取 Linux 系统的 CPU、内存和磁盘指标，可以研究 Node Exporter。它能够提供较丰富的主机级指标，Home Hub 再通过内网采集组件读取这些数据。

![](https://www.google.com/s2/favicons?domain=https://prometheus.io\&sz=32)

Prometheus

## 六、监控应该采用什么运行机制？

我推荐采用：

定时采集 + 内存缓存 + 数据库存储 + SSE 推送。

不建议让 App 每打开一次监控页面，就直接调用所有 PVE、NAS、Docker 和 Lucky 接口。

正确的流程应该是：

NestJS Scheduler

定时触发监控任务

MonitorService

并发控制 · 超时处理 · 状态计算

HTTP 检测

PVE API

设备适配器

最新状态缓存 + SQLite

最新监控数据 · 历史趋势 · 状态事件

REST API + SSE

向 App 和 Web 管理后台提供监控数据

### 1. 定时采集

NestJS 的 `@nestjs/schedule` 支持周期性任务和动态任务管理，可以直接用于监控调度。

![](https://www.google.com/s2/favicons?domain=https://docs.nestjs.com\&sz=32)

NestJS - A progressive Node.js framework

不同指标使用不同的采集频率：

|
监控项目

|

建议间隔

|
| --- | --- |
|

站点在线状态

|

30 秒

|
|

PVE 节点及虚拟机状态

|

15～30 秒

|
|

CPU、内存、磁盘

|

30 秒

|
|

Lucky 规则同步

|

手动触发

|
|

证书过期时间

|

每天一次

|

监控任务需要限制并发、配置请求超时，并避免同一个任务尚未结束就重复执行。

### 2. 实时推送

你的 App 已经有 SSE 开发经验，因此第一版可以直接选择 SSE，而不必额外引入 Socket.IO。

后端通过：

```
GET /api/v1/monitor/events
```

向已认证的客户端推送状态变化，例如：

JSON

```
{
  "type": "service.status.changed",
  "data": {
    "serviceId": "pve",
    "status": "DOWN",
    "checkedAt": "2026-09-24T06:00:00Z"
  }
}
```

NestJS 原生提供 SSE 支持，能够将服务端状态事件通过 HTTP 持续发送给客户端。

![](https://www.google.com/s2/favicons?domain=https://docs.nestjs.com\&sz=32)

NestJS - A progressive Node.js framework

你现有的 uni-app 原生端可以使用支持请求头的流式 HTTP 客户端，携带 Bearer Token 进行认证。

如果 Web 管理后台使用原生 `EventSource`，要注意它不支持任意自定义 Authorization 请求头。可以采用安全的 Cookie 会话，或者由后端签发短期、单用途的 SSE 连接凭据。不要把长期 Access Token 放在 URL 查询参数中。

SSE 主要用于 App 前台的实时展示。App 进入后台后，手机系统可能暂停网络连接；真正的后台异常通知需要由服务端持续监控，并通过手机推送或其他通知渠道送达。


## 七、数据库设计

我建议第一版先建立 7 张核心表，覆盖登录、站点同步和服务监控。

|
表名

|

主要用途

|
| --- | --- |
|

`users`

|

用户账号、密码哈希、角色及账号状态

|
|

`auth_sessions`

|

登录设备、Refresh Token 哈希及会话状态

|
|

`sites`

|

站点信息、Lucky 规则关联、图标及分类

|
|

`monitor_targets`

|

监控目标、检测类型、频率、超时设置

|
|

`monitor_results`

|

历史检测结果及响应时间

|
|

`monitor_metrics`

|

CPU、内存等资源指标及采集时间

|
|

`monitor_events`

|

离线、恢复、异常等状态变化事件

|

另可增加 `integration_configs` 表，记录 Lucky、PVE 等外部系统的接入配置。

外部服务的 Token 应通过服务端密钥管理或受保护的加密配置保存，不能像普通业务字段一样直接明文存储并返回前端。

### 重点：站点和监控目标要分开

我建议不要把 `sites` 和 `monitor_targets` 设计成同一张表。

例如，一个 PVE 站点可能需要监控：

* 外网 HTTPS 管理入口。

* 内网 PVE API。

* 节点自身运行状态。

它们是三个不同的检测目标，但都属于同一个站点。

反过来，一台物理主机上也可能运行多个站点，这些站点可以关联到相同的宿主设备。

因此，后续可以进一步增加 `devices` 表，用于管理物理机、虚拟机、路由器等设备实体。

这样你就能构建出完整的设备、服务、站点之间的关联关系，而不只是简单地检查 URL 是否在线。

## 八、后端项目目录结构

建议项目名称为 `home-hub`，使用 pnpm workspace 管理 App、后端和 Web 管理后台。

```
home-hub/
│
├── apps/
│   │
│   ├── server/                 # NestJS 后端
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   │
│   │   │   ├── modules/
│   │   │   │   ├── auth/       # 登录、JWT、会话
│   │   │   │   ├── users/      # 用户管理
│   │   │   │   ├── lucky/      # Lucky API 接入
│   │   │   │   ├── sites/      # 站点配置
│   │   │   │   ├── devices/    # 设备信息
│   │   │   │   ├── monitor/    # 监控管理
│   │   │   │   └── alerts/     # 告警
│   │   │   │
│   │   │   ├── integrations/
│   │   │   │   ├── lucky/
│   │   │   │   ├── pve/
│   │   │   │   ├── docker/
│   │   │   │   └── http/
│   │   │   │
│   │   │   ├── database/
│   │   │   │   ├── entities/
│   │   │   │   └── migrations/
│   │   │   │
│   │   │   ├── common/
│   │   │   │   ├── guards/
│   │   │   │   ├── filters/
│   │   │   │   └── decorators/
│   │   │   │
│   │   │   └── config/
│   │   │
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── admin-web/              # Vue 3 管理后台
│   │
│   └── mobile/                 # uni-app
│
├── packages/
│   └── shared/                 # 公共类型和接口 DTO
│
├── deploy/
│   └── docker-compose.yml
│
└── pnpm-workspace.yaml
```

这里要特别注意 `modules` 和 `integrations` 的区别。

`modules` 负责你的业务逻辑，比如站点列表、监控状态和用户权限。

`integrations` 只负责调用外部服务、处理外部系统的数据结构，以及将外部数据转换为统一格式。

这样以后 Lucky 的接口发生变化时，只需要调整 Lucky 适配器，不必修改站点管理、监控和 App 接口的业务逻辑。

## 九、Web 管理后台怎么设计？

你明确希望开发一个后端 Web 服务，因此我建议同时提供一个轻量管理页面，而不只是 REST API。

技术上可以选择：

|
项目

|

技术

|
| --- | --- |
|

前端框架

|

Vue 3 + TypeScript

|
|

构建工具

|

Vite

|
|

UI 框架

|

Element Plus

|
|

状态管理

|

Pinia

|
|

请求封装

|

Axios

|
|

图表

|

ECharts

|

管理后台不需要重新实现 PVE 或 Homarr，而是负责配置 Home Hub 自己的能力。

# Home Hub Admin

管理中心

概览

运行状态

站点管理

Lucky 同步

设备管理

PVE / NAS

监控管理

检测和历史

告警中心

异常通知

系统设置

用户与接入

尤其是 Lucky 和设备接入配置，我建议放在 Web 管理后台进行管理，App 主要负责查看站点和监控状态。

这样就不需要在手机上编辑 PVE API 地址、监控规则、设备凭据等复杂配置。

如果你暂时不想开发管理页面，也可以先使用 NestJS Swagger 调试接口，并将少量配置写入服务端环境变量。

## 十、后端如何部署到你现有的小主机？

你已经有 PVE、Ubuntu 虚拟机、fnOS 和 Lucky，不需要额外购买服务器。

我建议将 Home Hub Server 作为一个独立 Docker 容器运行。

有两个适合的部署位置：

|
部署位置

|

特点

|
| --- | --- |
|

Ubuntu 虚拟机

|

适合开发、持续集成、Docker 管理和后期扩展

|
|

fnOS Docker

|

可以与 Lucky、NAS 服务部署在同一台系统中，减少跨虚拟机管理成本

|

如果你希望在 PVE 宿主节点故障时，Home Hub 仍然能够监测并记录故障，建议优先部署在 fnOS 上。

因为你的 fnOS 本身是 PVE 中的虚拟机，所以这只能实现服务级别的故障隔离，并不能实现物理故障隔离。

如果整个 PVE 宿主机宕机，fnOS 和 Home Hub 也会一起停止。想要监控整台物理主机是否离线，需要另外部署独立的外部监测节点。

### Docker Compose 示例

第一版可以只部署一个后端容器：

YAML

```
services:
  home-hub-server:
    image: home-hub-server:latest
    container_name: home-hub-server

    restart: unless-stopped

    ports:
      - "192.168.1.3:3000:3000"

    environment:
      NODE_ENV: production
      PORT: "3000"
      DB_PATH: /app/data/home-hub.sqlite

    env_file:
      - ./secrets/server.env

    volumes:
      - ./data:/app/data
```

其中 IP、镜像名称和数据路径都是部署示例，需要根据实际的 fnOS 网络和构建方式调整。

数据库、密钥及配置必须放在持久化目录中，数据库目录还要保证运行容器的用户具有正确的读写权限。

生产环境不要启用 TypeORM 的自动表结构同步，使用数据库迁移管理版本变化，并定期进行可恢复性验证的数据库备份。

### 网络配置

通过 Lucky 为 Home Hub 配置一个独立的 HTTPS 域名，例如：

```
https://hub.example.com
```

转发到：

```
http://192.168.1.3:3000
```

可以把路由划分为：

```
https://hub.example.com/
    → Vue Web 管理后台

https://hub.example.com/api/v1/
    → NestJS REST API
```

Web 管理后台和 API 使用同一个域名，能够减少跨域和 Cookie 配置的复杂度。

外网访问建议优先使用 VPN；如果确实需要通过公网访问 Home Hub API，应对登录、管理及设备操作接口设置相应的访问控制和限流，并确保只有预期的 API 暴露在公网。

Lucky 管理接口、PVE API、Docker Socket、SQLite 文件和后端内部凭据都不应该因为新增 Home Hub 而直接暴露到公网。

## 十一、最终的开发顺序

建议采用分阶段实施的方式，每完成一个阶段，就可以独立使用其中的功能。

第一阶段

搭建后端及完成登录鉴权

初始化 NestJS、SQLite、JWT 鉴权、Refresh Token、全局异常处理及 Swagger。完成 uni-app 登录和自动续期流程。

交付目标：App 能够安全登录、退出并调用受保护的 API。

第二阶段

Lucky 接入与站点同步

确认当前 Lucky 的规则读取接口，完成 LuckyAdapter、站点数据库及同步机制，支持 App 动态获取站点列表。

交付目标：Lucky 新增站点后，Home Hub 能够自动发现并同步。

第三阶段

服务可用性监控

实现 HTTP、TCP 等检测器，提供在线状态、响应时间、异常恢复及历史记录。

交付目标：App 首页能够实时显示各个服务的访问状态。

第四阶段

设备资源监控与告警

对接 PVE、NAS、Docker 等设备，增加 CPU、内存、虚拟机状态和资源历史趋势，并支持异常事件推送。

交付目标：形成自己的家庭服务器监控控制台。

## 最终技术方案汇总

建议采用

# Home Hub Server

模块化单体架构 · Node.js 技术栈

<table class="_6IUVGW_Table" data-d-column-sizing="auto" data-d-dividers="" style="table-layout: auto;"><tbody><tr data-d-component="table-row"><td data-d-component="table-cell" data-d-valign="start">移动端</td><td data-d-component="table-cell" data-d-valign="start">uni-app + WebView</td></tr><tr data-d-component="table-row"><td data-d-component="table-cell" data-d-valign="start">Web 管理端</td><td data-d-component="table-cell" data-d-valign="start">Vue 3 + Vite + Element Plus</td></tr><tr data-d-component="table-row"><td data-d-component="table-cell" data-d-valign="start">后端</td><td data-d-component="table-cell" data-d-valign="start">NestJS + TypeScript</td></tr><tr data-d-component="table-row"><td data-d-component="table-cell" data-d-valign="start">数据存储</td><td data-d-component="table-cell" data-d-valign="start">SQLite + TypeORM</td></tr><tr data-d-component="table-row"><td data-d-component="table-cell" data-d-valign="start">鉴权</td><td data-d-component="table-cell" data-d-valign="start">短期 JWT + 可撤销 Refresh Token</td></tr><tr data-d-component="table-row"><td data-d-component="table-cell" data-d-valign="start">Lucky 接入</td><td data-d-component="table-cell" data-d-valign="start">OpenToken + 独立 API 适配器</td></tr><tr data-d-component="table-row"><td data-d-component="table-cell" data-d-valign="start">监控系统</td><td data-d-component="table-cell" data-d-valign="start">NestJS Scheduler + 多种设备适配器</td></tr><tr data-d-component="table-row"><td data-d-component="table-cell" data-d-valign="start">实时更新</td><td data-d-component="table-cell" data-d-valign="start">REST API + SSE</td></tr><tr data-d-component="table-row"><td data-d-component="table-cell" data-d-valign="start">部署</td><td data-d-component="table-cell" data-d-valign="start">Docker Compose + Lucky HTTPS</td></tr></tbody></table>

这套架构的关键不是堆积技术，而是将 Lucky 站点同步、设备监控和身份认证设计成相互独立的模块。第一版只需要 Node.js、SQLite 和 Docker 就可以运行；以后增加 Redis、Prometheus 或新的设备适配器时，不需要重新设计整个系统。
