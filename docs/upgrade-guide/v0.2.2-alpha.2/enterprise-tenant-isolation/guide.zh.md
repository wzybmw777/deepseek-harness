---
kind: upgrade-guide
description: "企业控制台移除共享访客访问，所有用户必须登录后才能启动 rootless 租户容器。"
---

# 企业工作台要求登录并使用 rootless 容器

[English](guide.md) | 中文

## 变更

企业控制台不再提供访客凭据、访客租户或共享匿名工作区。`/enterprise/api/harness/launch`、`/enterprise/api/session/authorize` 以及所有 `/t/<团队>/harness/` 路由都要求已签名的成员会话。旧 `dsh_enterprise_guest` Cookie 不授予任何权限。未登录启动会跳转到 `/enterprise/login?next=%2Fenterprise%2Fworkspace`。

每个启用中的团队现在运行在一个 rootless Podman 容器中，不再使用宿主子进程。控制面必须以非特权用户运行，并具备可用的 rootless Podman、配置的租户镜像，以及对构建产物和 Node 运行时的只读访问。Podman 不可用、报告 `Rootless=false`、镜像或挂载缺失，或容器在就绪前退出时，服务会失败关闭。

不存在访客回退或可信访客模式。仍需要匿名访问的部署必须继续使用旧版本。团队成员有意共享一个容器、工作区、凭据集合和会话历史。Rootless 容器共享宿主内核，绑定在非回环宿主地址上的服务仍可通过用户态网络访问；应把管理服务绑定到回环地址或单独配置防火墙。

## 迁移

1. 为所有曾使用访客工作区的用户创建或配置企业账号。未分配启用团队的账号无法进入工作台。
2. 使用 `packages/experimental/enterprise-console/container/Containerfile` 构建租户镜像，并以服务用户确认 `podman info --format '{{.Host.Security.Rootless}}'` 返回 `true`。
3. 以专用非特权用户运行控制面。重启服务前设置 `DSH_ENTERPRISE_TENANT_IMAGE`、`DSH_ENTERPRISE_PODMAN`、`DSH_ENTERPRISE_TENANT_SOURCE_ROOT`、`DSH_ENTERPRISE_TENANT_ENTRY`、`DSH_ENTERPRISE_TEMPLATE_HOME` 和 `DSH_ENTERPRISE_TENANTS`。
4. 在审查或备份内容之前，保留 `/opt/deepseek-harness/.enterprise-data` 和旧访客租户目录。新代码不会挂载或读取这些访客工作区。
5. 使用管理员账号登录，确认团队成员关系和 `/t/<团队>/harness/` 访问，修改初始管理员密码后删除 `initial-admin-password.txt`。
