---
description: "部署托管的企业 Web 应用、租户运行时与 Windows 桌面更新源。"
---

# 实操手册：部署托管构建

[English](deploying-the-hosted-builds.md) | 中文

## 概述

本手册用于 `master` 进入部署之后的操作，按顺序覆盖重建、服务重启、租户冷启动、桌面端打包、更新源发布，以及证明改动已进入运行进程的检查。核心规则是：企业前端、`lib/client.js` 中的客户端包与 `lib/index.js` 中的宿主包作为一组部署；只更新其中一部分而让另一部分停留在旧构建，正是本部署出现过数据行为静默变化的原因。

命令使用运维机上的 SSH 别名：`server-162` 是应用主机，边缘主机是 `dev.echoai.best` 前面持有公网地址的那台机器。

## 目录

- [1. 认识部署拓扑](#map)
- [2. 按依赖顺序重建](#rebuild)
- [3. 重启并等待租户启动](#restart)
- [4. 打包并发布桌面端](#desktop)
- [5. 验证部署结果](#verify)
- [6. 启动性能与进入体验](#startup)
- [故障排查](#troubleshooting)
- [延伸阅读](#further-exploration)

<a id="map"></a>
## 1. 认识部署拓扑

两台主机共用一个公网地址，浏览器从不直接访问应用主机：

| 跳点 | 职责 | SSH 目标 |
|---|---|---|
| 边缘主机 | 为 `dev.echoai.best` 终止 TLS，提供 `/enterprise/`、`/t/` 与桌面更新源 | `ssh -p 22 root@<public-ip>` |
| 应用主机 | 构建宿主与客户端包，提供企业应用，运行租户容器 | `ssh server-162`（端口 2222） |

- 请求路径为浏览器 → 边缘 nginx → frp 端口 `<public-ip>:25203` → 应用主机上的 `127.0.0.1:3080`。
- `deepseek-harness-web.service` 以 `dsh-enterprise` 用户运行 `dsh --profile web`，从 `DSH_ENTERPRISE_DIST=/opt/deepseek-harness/apps/enterprise/dist` 读取控制台，并把租户状态保存在 `/var/lib/dsh-enterprise-tenants`。
- 每个团队有一个 rootless podman 容器，名为 `dsh-tenant-<team>-<nonce>`，在该团队首次认证请求时启动。

<a id="rebuild"></a>
## 2. 按依赖顺序重建

每种产物都消费上一行的产物，因此按下表从上往下重建：

| 产物 | 在 `/opt/deepseek-harness` 下执行的命令 | 输出 |
|---|---|---|
| 宿主包 | `node_modules/.bin/tsx scripts/compile-referenced-projects.ts host-libraries` | `packages/*/*/lib/index.js` |
| 客户端包 | 先 `node_modules/.bin/tsc -b tsconfig.client.json`，再 `node_modules/.bin/tsdown --config-loader native --env.DSH_BUILD_FACE client` | `packages/*/*/lib/client.js` |
| 企业前端 | `cd apps/enterprise && ../../node_modules/.bin/vite build` | `apps/enterprise/dist` |

每条命令前都加上 `PATH=/opt/node24/bin:$PATH`。只有单个客户端包变化时，用它包内的 `tsdown` 只重建该 bundle：

```sh
cd /opt/deepseek-harness/packages/experimental/client-ui-enterprise-resources
PATH=/opt/node24/bin:$PATH /opt/deepseek-harness/node_modules/.bin/tsdown
```

这条捷径只覆盖客户端 bundle。宿主包没有包内入口，因为根目录的 `tsdown` 会把每个 `lib/types/index.js` 映射为 `lib/index.js`。

这个顺序防范的故障是静默的。曾有一次，已部署的前端与客户端 bundle 运行在更早构建的宿主包上：`command/run` 事件不带 `conversation: true`，`session/list` 把每个智能体会话都保持为 `blank: true`，侧栏在首条消息之后丢掉了会话。页面看起来是新的，因为标记是新的；旧的只是宿主侧的数据行为。

<a id="restart"></a>
## 3. 重启并等待租户启动

控制台在每次请求时从磁盘读取 `apps/enterprise/dist`，所以只改前端不需要重启。宿主与客户端 bundle 的改动需要：

```sh
ssh server-162
systemctl restart deepseek-harness-web.service
systemctl is-active deepseek-harness-web.service
```

重启后，网关对该团队的首次认证请求返回 502，直到该租户容器完成启动，通常需要 30–40 秒。此时刷新页面而不是再次重启；第二次重启会丢弃正在启动的容器。控制台现在会先渲染进入页并轮询启动状态，浏览器不会再挂在一个没有反馈的 303 请求上。

<a id="desktop"></a>
## 4. 打包并发布桌面端

桌面端在 Windows 上构建，并发布到边缘主机。[Web 壳 README](../../apps/desktop/web-shell/README.zh.md)负责产物约定与更新行为。

1. 递增 `apps/desktop/web-shell/package.json` 中的 `version`；不要复用已发布的版本。
2. 构建机需要代理时设置 `HTTP_PROXY` 与 `HTTPS_PROXY`，因为 electron-builder 会下载 winCodeSign 工具链，否则要等满 600 秒超时。
3. 在 `apps/desktop/web-shell` 下运行 `node_modules\.bin\electron-builder.cmd --config electron-builder.cjs --win nsis --x64 --publish never`。
4. 把 `Zhiliu-Setup-<version>-x64.exe` 及其 `.blockmap` 复制到边缘主机的 `/var/www/zhiliu-desktop-updates/windows/x64/`。
5. 备份 `latest.yml`，把新清单上传为 `latest.yml.next`，再重命名为 `latest.yml`，确保客户端不会在安装包就绪前读到新清单。

<a id="verify"></a>
## 5. 验证部署结果

检查正在运行的部署，而不是工作区：

- 两个宿主包都带有会话标记：`grep -c 'conversation === true' packages/api/session-controller/lib/index.js` 与 `packages/interaction/commands/lib/index.js` 的同一条命令都输出 `2`。
- 发送的消息在刷新后仍在：向智能体发送一条消息，刷新页面，确认会话仍留在侧栏。
- 控制台提供新前端：`ls -l apps/enterprise/dist/assets` 显示新的哈希资源，硬刷新后能看到新布局。
- 更新源公告新构建：`curl -s https://dev.echoai.best/desktop-updates/windows/x64/latest.yml` 中的版本正确，且 `openssl dgst -sha512 -binary Zhiliu-Setup-<version>-x64.exe | base64 -w0` 与其 `sha512` 字段一致。

<a id="startup"></a>
## 6. 启动性能与进入体验

进入工作台的耗时几乎全在“租户容器冷启动”，控制台只负责把浏览器送到 `/t/<slug>/harness/`。本部署用三处配置把这段等待压到最短：

1. **systemd drop-in** `/etc/systemd/system/deepseek-harness-web.service.d/10-startup.conf`：用 `node apps/cli/lib/bin.js` 直接启动，跳过 `pnpm` 包装层（它每次都会先跑一遍依赖安装检查）；启用 `NODE_COMPILE_CACHE`；并设置 `DSH_ENTERPRISE_TENANT_IDLE_MINUTES=180`，让空闲租户保留 3 小时，重复进入不再冷启动。
2. **租户编译缓存**：`tenant-runtime` 为每个容器注入 `NODE_COMPILE_CACHE=<团队 home>/.node-compile-cache`，目录位于可写的租户根目录内。重建宿主包后，第一次启动会重新填充缓存。
3. **进入页**：控制台先请求 `GET /enterprise/api/harness/launch?wait=0`（返回 202 并在后台启动），再轮询 `GET /enterprise/api/harness/status`，直到 `state: ready` 后跳转到 `readyUrl`。等待期间页面显示阶段文案、已等待秒数与进度条。

验证方式：

```sh
journalctl -u deepseek-harness-web.service --since '-5 min' | grep -E 'Started|dsh web:'
du -sh /var/lib/dsh-enterprise/.node-compile-cache
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/enterprise/api/harness/status
```

`Started` 与 `dsh web:` 之间的间隔是控制台自身的启动时间，跳过 `pnpm` 后通常在 10–20 秒。`status` 未登录时应返回 401。

注意：租户启动是 CPU 密集型工作（单次约 40–80 CPU 秒）。当主机 load average 接近或超过核数时，实际等待会被拉长数倍，这是主机资源竞争而非启动路径的问题；此时应先处理主机上无关的高 CPU 进程，而不是反复重启服务。

<a id="troubleshooting"></a>
## 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| 重启后立即出现 502 | 租户容器仍在启动 | 等待 30–40 秒后刷新；不要再次重启服务 |
| 发送后智能体会话消失 | `lib/index.js` 中的宿主包是旧构建 | 重建宿主包，再确认标记计数 |
| 页面仍显示旧布局 | `apps/enterprise/dist` 是旧的，或文档被缓存 | 重建前端，硬刷新，并确认资源哈希已变化 |
| electron-builder 卡在下载 winCodeSign | 构建机没有代理 | 设置 `HTTP_PROXY` 与 `HTTPS_PROXY` 后重试 |
| 构建阻塞在 `.git/dsh-lefthook-install.lock` | 另一个仓库安装正在运行 | 直接运行 `node_modules/.bin` 下的二进制，或确认没有安装进程后再删除该锁 |

<a id="further-exploration"></a>
## 延伸阅读

- [Web 壳 README](../../apps/desktop/web-shell/README.zh.md) — 更新源、校验和验证、安装器行为与下载服务。
- [在反向代理之后发布 Web UI](../user/guide/public-deployments.zh.md) — `--public-url` 与 `--trusted-host` 公告什么、放行什么。
- [租户隔离](../../packages/experimental/enterprise-console/docs/TENANT-ISOLATION.md) — 容器挂载、所有权与租户数据边界。

<a id="dev-note"></a>
## 开发备注

无。
