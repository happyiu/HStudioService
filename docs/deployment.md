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

Lucky 的上游地址配置为 `http://<Docker 主机局域网 IP>:3000`。只把 Lucky 的 HTTPS 入口转发到公网，不要在路由器上转发 3000 端口。当前后端提供 HTTP API，源码尚未实现 WebSocket 网关。

更新代码后在项目目录执行 `docker compose up -d --build`。备份前停止后端，再复制 SQLite 文件；备份完成后重新启动：

```sh
docker compose stop backend
cp data/home-hub.sqlite /path/to/backup/home-hub.sqlite
docker compose start backend
```
