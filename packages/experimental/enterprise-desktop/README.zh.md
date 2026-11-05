---
description: "企业桌面端的 Host 路由：计量模型网关与云端控制面。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-enterprise-desktop

[English](README.md) | 中文

## 概述

企业桌面端的私有 Host 集成包。它只注册一个 `enterprise-gateway` 模型提供方，通过短期企业访问令牌把模型请求转发到固定云地址；网关、模型目录或团队额度不可用时直接失败，不回退直连。刷新凭据不会进入 Host。

## 使用本包

```ts
const transport = new EnterpriseCloudTransport({ bootstrap: enterpriseBootstrapPort })
const dispose = installEnterpriseModelRoute(ctx, transport, catalog, ctx.webServer.getOrigin())
const disposeBilling = installEnterpriseBillingRoute(ctx, transport, enterpriseBootstrapPort)
```

模型目录来自 `GET /enterprise/api/desktop/models`。本地路由只接受私有的 `enterprise-session` 占位值，传输层再替换为当前 Bearer 令牌。遇到 401 时，通过 bootstrap 端口刷新一次访问令牌，然后仅重试一次同一请求。

包的 `./client` 入口在侧栏底部加入紧凑额度条。它通过本地 Host 路由读取 `GET /enterprise/api/desktop/billing`，展示团队剩余 Token 与当前成员用量；收到 `quota_exhausted` 时立即切换为耗尽状态，并在系统浏览器打开企业套餐页面。额度条接管 `shell.quota-notice` 中的该错误码，因此提示落在额度行内，不弹出通用聊天 Toast。
