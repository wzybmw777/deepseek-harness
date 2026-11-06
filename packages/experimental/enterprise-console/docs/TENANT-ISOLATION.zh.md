---
description: "企业租户隔离的威胁模型、rootless 容器合同、部署与验证说明。"
kind: "package-reference"
---

# 企业租户沙盒隔离

本文定义已登录企业用户、控制面、宿主机和其他租户之间的安全边界。它适用于可选的 `@deepseek-ai/dsh-enterprise-console` Host 插件及其生产 systemd 部署。

## 安全目标

租户用户可以执行任意命令，但不能读取其他租户的数据、读取企业认证数据、写入宿主文件系统、访问宿主本地服务、访问容器运行时套接字，或无限耗尽宿主内存和进程号。

安全边界是租户，不是浏览器标签页。同一团队的成员有意共享该团队的容器、工作区、凭据、会话历史和进程。如果需要成员之间的保密，就应按成员分配租户，而不是按团队分配。

## 非目标

- 租户容器不是硬件虚拟化边界。它共享宿主内核，依赖 rootless Podman、runc/crun、用户命名空间和内核安全更新。
- 外网出口是有意开放的，模型提供商和软件包仓库需要访问；租户可以通过用户发起的请求把数据发送到外部。
- 同一团队成员可以读取和修改彼此的工作区数据，这是产品协作模型的一部分。
- 控制台不集成在线支付服务商，也不提供远程执行集群。

## 信任边界

| 组件 | 信任级别 | 拥有 | 绝不能接触 |
|---|---|---|---|
| 浏览器 | 不可信 | 企业 Cookie、用户输入 | 租户 Harness Cookie、启动令牌 |
| 企业控制面 | 可信应用，非 root 系统用户 | 登录会话、SQLite 目录、密钥、容器监督 | 宿主 root 文件写入 |
| 租户容器 | 不可信工作负载 | 一个团队的 Home、工作区、会话、模型凭据副本 | 企业 SQLite、session key、credential key、其他租户目录、Podman 套接字 |
| 宿主内核与 Podman | 可信平台 | 命名空间、cgroup、镜像存储 | 租户可控制的运行时配置 |

控制面以专用用户 `dsh-enterprise` 运行。它可以监督该用户的 rootless 容器，但不是 root，也不会把宿主文件系统挂载进租户。

## 认证与入口

`/` 和 `/enterprise/workspace` 始终把浏览器送到 `/enterprise/api/harness/launch`。该接口要求有效的企业会话；未登录请求会跳转到 `/enterprise/login`，不会创建租户。

登录后会校验 `workspace.use`、解析用户团队、拒绝未分配或停用的团队、写入启动审计、按需启动团队容器，然后跳转到 `/t/<团队标识>/harness/`。

企业会话 Cookie 是 `dsh_enterprise_session`。不再存在访客凭据、访客租户、共享匿名工作区，也不会为未登录访客自动创建租户。

## 容器合同

每个团队运行一个 rootless Podman 容器，名称为 `dsh-tenant-<团队ID>-<nonce>`，并带有 `io.deepseek.enterprise.tenant=<团队ID>` 标签。

每次启动都应用以下控制：

| 控制 | 取值 | 目的 |
|---|---|---|
| Rootless | Podman 运行在 `dsh-enterprise` 用户会话 | 逃逸必须突破用户命名空间，而不只是一个进程 UID |
| 用户命名空间 | `--userns=keep-id` | 容器文件映射到非 root 服务用户，不使用宿主 UID 0 |
| 运行身份 | `--user <服务UID>:<服务GID>` | 租户代码永远不以 root 运行 |
| 根文件系统 | `--read-only` | 镜像和二进制不可修改 |
| Linux 能力 | `--cap-drop=ALL` | 容器内没有管理能力 |
| 提权 | `--security-opt=no-new-privileges` | setuid 二进制不能重新获得权限 |
| 进程限制 | `--pids-limit` | 防止 fork bomb 耗尽宿主 PID |
| 内存限制 | `--memory` 与 `--memory-swap` 相等 | 防止无限堆和页缓存增长 |
| 临时文件系统 | `tmpfs /tmp`，`nosuid`、`nodev`、有上限 | 临时写入不持久且不按挂载策略执行 |
| 宿主绑定 | `--publish 127.0.0.1:<宿主端口>:<宿主端口>` | 只有控制面能访问租户监听器 |
| 网络 | `slirp4netns`，关闭宿主回环 | 租户代码不能访问宿主回环监听器 |

镜像包含 `bash`、`bubblewrap`、`ca-certificates`、`curl`、`git`、`jq`、`less`、`procps`、`python3`、`ripgrep` 和 `socat`。DSH 运行时和 Node 二进制从经过审查的构建目录只读挂载，避免在镜像内维护第二份可变的应用程序。

租户应用只绑定容器网络命名空间内的 `127.0.0.1:3000`。一个原始 TCP `socat` 中继监听发布端口并转发到该回环监听器。这样保留 DSH 对 `0.0.0.0` 的拒绝，同时宿主只得到一个回环发布端口。

## 文件系统策略

只读挂载：

- `/opt/node24` 或解析后的 Node 安装根目录
- `<源码根>/node_modules`
- `<源码根>/packages`
- `<源码根>/apps/cli`
- `<源码根>/apps/web`
- `<源码根>/native`
- `<源码根>/vendor`
- `<源码根>/package.json`

读写挂载：

- `<租户根>/<团队ID>`，容器内保持相同绝对路径

租户根只包含 `home`、`documents`、`runtime.patch.yml` 和 DSH 自建状态。它的权限为 `0700`，所有者为 `dsh-enterprise`。容器不会挂载：

- `/opt/deepseek-harness/.enterprise-data`
- `/root`
- `/home`
- `/var/run/docker.sock`
- `/run/user/<uid>/podman/podman.sock`
- 整个 `/var/lib/dsh-enterprise-tenants` 父目录
- 其他团队的租户根

DSH 内部的 `workspace-write` 策略继续启用，作为纵深防御。它把 Bash 和终端的文件影响限制在租户工作区和临时 `/tmp`；由于容器本身只暴露租户根可写，它不是主要的宿主边界。

## 网络策略

Rootless Podman 为每个容器创建独立网络命名空间。运行参数使用 `slirp4netns` 并设置 `allow_host_loopback=false`，因此租户代码无法访问宿主回环监听器或 `10.0.2.2` 宿主网关。该选项不会阻断宿主的其他网卡地址：绑定到局域网或公网宿主地址的服务仍可通过用户态网络访问。应把宿主管理服务和数据服务绑定到回环地址，或单独配置防火墙；需要限制租户访问目的地时应使用出口代理。

外网出口保持开放，以便模型 API、软件包仓库和用户请求的 HTTP(S) 访问。DNS 和 TLS 使用容器自身的解析器和 CA 包。如果部署需要严格的模型 API 白名单，应在租户边界之外放置带认证的出口代理，并把租户的 `HTTPS_PROXY` 指向它；宿主上的回环代理按设计不可达。

原始 TCP 中继支持 HTTP 和 WebSocket 升级。控制面只在自身回环请求中注入内部 Harness Cookie；浏览器永远拿不到该 Cookie 或启动令牌。

## 资源策略

内存和 PID 是由 rootless Podman 强制执行的硬 cgroup 限制。默认每容器 1 GiB 内存和 512 个进程。管理器还限制同时运行的容器数量，并在空闲时间达到配置值后停止容器。

当前部署没有强制 CPU 配额，因为宿主 systemd 用户 slice 只委派了 `memory` 和 `pids` 控制器；请求 `--cpus` 会以 `the requested cgroup controller cpu is not available` 失败。控制面不会静默忽略该失败。需要硬 CPU 配额的部署必须先为服务用户的 slice 启用 CPU 委派、用 `podman info` 验证，然后才增加 `--cpus`。

## 生命周期

1. 登录触发用户团队启动。
2. 管理器分配回环端口并准备私有租户根。
3. 管理器验证 Podman 报告 `Rootless=true`。
4. 服务重启或崩溃恢复后，管理器清理带有企业租户标签的陈旧容器。
5. 启动一个容器，从标准输出解析一次性 DSH 就绪 URL。
6. 控制面在宿主进程内部交换启动令牌，并在内存中保存内部 Cookie。
7. HTTP 请求和 WebSocket 升级增加租约活动计数。
8. 空闲超时后停止容器并释放端口。
9. 管理器关闭时停止并移除所有运行容器；租户根继续持久保留。

Podman 不可用、未报告 rootless、镜像缺失、容器在就绪前退出或令牌交换失败时，启动必须失败关闭。

## 部署前置条件

- 启用用户命名空间的 Linux，且可使用无特权 Landlock 或 bubblewrap
- Rootless Podman、`slirp4netns`、`fuse-overlayfs`、`uidmap`
- 专用 `dsh-enterprise` 系统用户，以及 subordinate UID/GID 范围
- 执行 `loginctl enable-linger dsh-enterprise`，让用户 systemd 管理器在退出登录后继续运行
- `/var/lib/dsh-enterprise` 保存服务 Home 和模板 Home
- `/var/lib/dsh-enterprise-tenants` 归 `dsh-enterprise` 所有，权限 `0700`
- `/opt/deepseek-harness/.enterprise-data` 归 `dsh-enterprise` 所有，权限 `0700`，绝不挂载进租户
- 构建好的租户镜像 `localhost/dsh-enterprise-tenant:local`，或通过 `DSH_ENTERPRISE_TENANT_IMAGE` 指定

控制面 systemd 单元以 `dsh-enterprise` 运行，并设置 `HOME`、`XDG_RUNTIME_DIR` 和 `DBUS_SESSION_BUS_ADDRESS`。它保留 `NoNewPrivileges=no` 仅因为 rootless Podman 的 subordinate-ID 辅助程序需要执行；租户容器本身始终使用 `no-new-privileges`。

## 配置

| 配置 | 环境变量 | 含义 |
|---|---|---|
| `tenantRoot` | `DSH_ENTERPRISE_TENANTS` | 私有租户数据根 |
| `tenantDshEntry` | `DSH_ENTERPRISE_TENANT_ENTRY` | 只读挂载的构建 CLI 入口 |
| `tenantSourceRoot` | `DSH_ENTERPRISE_TENANT_SOURCE_ROOT` | 只读挂载应用目录的仓库构建树 |
| `tenantTemplateHome` | `DSH_ENTERPRISE_TEMPLATE_HOME` | profile 和凭据种子 Home |
| `tenantProfile` | `DSH_ENTERPRISE_TENANT_PROFILE` | 每个租户加载的 profile |
| `tenantContainerImage` | `DSH_ENTERPRISE_TENANT_IMAGE` | Rootless 容器镜像 |
| `tenantContainerPodman` | `DSH_ENTERPRISE_PODMAN` | Podman 可执行文件 |
| `tenantContainerMemoryMb` | `DSH_ENTERPRISE_TENANT_MEMORY_MB` | 每租户内存上限 |
| `tenantContainerPids` | `DSH_ENTERPRISE_TENANT_PIDS` | 每租户进程上限 |
| `tenantPortStart` / `tenantPortEnd` | `DSH_ENTERPRISE_TENANT_PORT_START` / `END` | 宿主回环端口范围 |
| `maxTenantProcesses` | `DSH_ENTERPRISE_MAX_TENANTS` | 并发容器上限 |
| `tenantIdleTimeoutMinutes` | `DSH_ENTERPRISE_TENANT_IDLE_MINUTES` | 空闲停止时间 |
| `tenantStartTimeoutMs` | `DSH_ENTERPRISE_TENANT_START_TIMEOUT_MS` | 就绪截止时间 |

## 镜像构建与升级

从仓库根构建：

```sh
podman build \
  -t localhost/dsh-enterprise-tenant:local \
  -f packages/experimental/enterprise-console/container/Containerfile \
  packages/experimental/enterprise-console/container
```

以 `dsh-enterprise` 用户构建，让镜像进入该用户的 rootless 镜像存储：

```sh
su -s /bin/bash dsh-enterprise -c \
  'XDG_RUNTIME_DIR=/run/user/996 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/996/bus podman build -t localhost/dsh-enterprise-tenant:local -f /opt/deepseek-harness/packages/experimental/enterprise-console/container/Containerfile /opt/deepseek-harness/packages/experimental/enterprise-console/container'
```

修改镜像后，运行下方验证矩阵并重启控制面。运行中的容器不会原地升级；每个租户在下次启动时获得新镜像。

## 验证矩阵

部署后从宿主执行：

```sh
# 租户进程必须是 rootless，不能是宿主 root。
sudo -u dsh-enterprise env XDG_RUNTIME_DIR=/run/user/996 \
  podman info --format '{{.Host.Security.Rootless}}'

# 把容器名换成 podman ps 中的实际租户容器名。
sudo -u dsh-enterprise env XDG_RUNTIME_DIR=/run/user/996 \
  podman exec <tenant-container> /opt/node24/bin/node -e '
    const net = require("node:net");
    const probe = (host, port) => new Promise(resolve => {
      const socket = net.connect({ host, port, timeout: 2000 });
      socket.on("connect", () => { socket.destroy(); resolve("CONNECTED"); });
      socket.on("timeout", () => { socket.destroy(); resolve("TIMEOUT"); });
      socket.on("error", error => resolve(error.code));
    });
    console.log(await probe("10.0.2.2", 3080));
  '
```

期望证据：

- `Rootless=true`
- `10.0.2.2:3080` 返回 `ENETUNREACH`、`ECONNREFUSED` 或 `ETIMEDOUT`
- 容器内不存在 `/opt/deepseek-harness/.enterprise-data`
- 容器内不存在 `/var/run/docker.sock`
- 容器内不存在 `/var/lib/dsh-enterprise-tenants/<其他团队>`
- 在租户根之外写入失败并报告只读文件系统
- 在租户根内写入成功
- 未登录、未分配或停用的团队不会被跳转到租户
- 跨团队 URL 返回 `403 tenant_forbidden`
- 旧访客 Cookie 不再授予工作区
- 租户的 memory 和 pids cgroup 文件包含配置的限制

## 运维说明

- 使用 `podman ps --filter label=io.deepseek.enterprise.tenant` 查看运行中的租户。
- 使用 `journalctl -u deepseek-harness-web` 查看控制面生命周期日志；租户日志通过容器标准输出/错误进入环形缓冲。
- 崩溃后，管理器在下次启动时清理带有标签的陈旧容器。数据目录不会自动删除。
- 备份 `.enterprise-data`、租户根、`session.key` 和 `credential.key`。模板 Home 含模型凭据，必须单独以仅所有者可读权限备份。

## 残余风险

- 容器逃逸或内核提权漏洞仍然会危及宿主；必须持续更新内核、Podman、crun 和容器镜像。
- 外网出口允许租户用户主动外传数据。需要限制目的地时应部署出口代理。
- `slirp4netns` 只阻断宿主回环，不阻断绑定在非回环地址上的宿主服务。应把管理服务和数据服务绑定到回环地址，或在租户容器之外配置宿主防火墙。
- 宿主目前只向 rootless 用户管理器委派内存和 PID cgroup。CPU 拒绝服务由进程和容器数量上限缓解，但不是每容器硬 CPU 配额。
- 团队成员有意共享沙盒。如果产品要求成员间保密，应按成员分配租户，而不是按团队分配。
- 镜像构建依赖和只读挂载的应用树是可信代码；租户代码不可信。
