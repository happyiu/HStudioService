# Docker Compose 部署

在 Docker 主机上进入项目目录：

```sh
cp .env.example .env.production
mkdir -p data certs
```

编辑 `.env.production`：设置不少于 32 位的 `JWT_SECRET`、不少于 10 位的 `ADMIN_PASSWORD`，并填写 Lucky、PVE 的实际连接信息。首次启动时会用管理员用户名和密码创建账号。文件已加入 Git 忽略规则。

SQLite 文件保存在 `data/home-hub.sqlite`。容器以 UID/GID `1000:1000` 运行；Linux 主机上首次启动前，为数据目录授予该用户读写权限：

```sh
sudo chown -R 1000:1000 data
docker compose up -d --build
docker compose ps
docker compose logs -f backend
```

如 PVE 使用私有 CA，将证书放入 `certs/`，并在 `.env.production` 设置 `PVE_CA_CERT_PATH=/run/certs/<证书文件名>`。证书目录只读挂载进容器。

Lucky 的上游地址配置为 `http://<Docker 主机局域网 IP>:3000`。只把 Lucky 的 HTTPS 入口转发到公网，不要在路由器上转发 3000 端口。GHome 使用同端口 Colyseus WebSocket，代理应保持原始 URL 路径并支持 Upgrade；不要只转发 `/api/v1`。

更新代码后在项目目录执行 `docker compose up -d --build`。备份前停止后端，再复制 SQLite 文件；备份完成后重新启动：

```sh
docker compose stop backend
cp data/home-hub.sqlite /path/to/backup/home-hub.sqlite
docker compose start backend
```


## GHome WebSocket 代理

首版只运行一个后端实例，SQLite 数据目录必须持久挂载。Lucky 中为此服务启用 WebSocket 转发，将 HTTP API、`/matchmake/` 和 Colyseus 的动态房间路径一起转发到同一上游，不添加路径前缀或改写路径。代理空闲超时应至少 60 秒。

Nginx 等效配置如下（放在 HTTPS server 的 location 中）：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 90s;
    client_max_body_size 2m;
}
```

HTTP 的 JWT 入场接口仍由 Nest 认证。不要开放未认证原生房间创建接口。上线后用浏览器检查 WebSocket 返回 101，并验证断线重新预约；迁移前备份 SQLite 和原本地岛屿。协议和保存规则见 [ghome-world.md](ghome-world.md)。
