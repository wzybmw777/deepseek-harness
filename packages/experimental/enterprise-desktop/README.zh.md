---
description: "企业桌面端的 Host 路由：计量模型网关与云端控制面。"
kind: "package-reference"
---

# @deepseek-ai/dsh-enterprise-desktop

[English](README.md) | 中文

## 概述

企业桌面端的私有 Host 集成包。它只注册一个 `enterprise-gateway` 模型提供方，通过短期企业访问令牌把模型请求转发到固定云地址；网关、模型目录或团队额度不可用时直接失败，不回退直连。刷新凭据不会进入 Host。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延迟工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

```ts
const transport = new EnterpriseCloudTransport({ bootstrap: enterpriseBootstrapPort })
const dispose = installEnterpriseModelRoute(ctx, transport, catalog, ctx.webServer.getOrigin())
const disposeBilling = installEnterpriseBillingRoute(ctx, transport, enterpriseBootstrapPort)
```

模型目录来自 `GET /enterprise/api/desktop/models`。本地路由只接受私有的 `enterprise-session` 占位值，传输层再替换为当前 Bearer 令牌。遇到 401 时，通过 bootstrap 端口刷新一次访问令牌，然后仅重试一次同一请求。

包的 `./client` 入口在侧栏底部加入紧凑额度条。它通过本地 Host 路由读取 `GET /enterprise/api/desktop/billing`，展示团队剩余 Token 与当前成员用量；收到 `quota_exhausted` 时立即切换为耗尽状态，并在系统浏览器打开企业套餐页面。额度条接管 `shell.quota-notice` 中的该错误码，因此提示落在额度行内，不弹出通用聊天 Toast。

<a id="model-experience"></a>
## 模型体验

通过现有的 pi-ai 适配器和 Agent 循环间接实现，由它们组装并流式传输模型可见内容；Host 只增加企业网关路由和云端传输。

#### KV Cache effect

网关原样转发请求内容，额度行不增加提示上下文。切换企业模型只改变路由，不改变提示前缀。

## 已知限制与延迟工作

<a id="known-limitations-and-deferred-work"></a>

- 应用依赖企业身份引导、模型网关和计费接口；不提供直连提供方或离线模式。
- 网关只支持 `openai-chat`、`openai-responses` 和 `anthropic-messages` 渠道协议。
- 桌面应用不内嵌后台管理；计费与账号管理在系统浏览器中打开。
- 额度行只展示最近一次上报的余额，不直接购买套餐；购买会打开云端计费页。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 — 点击展开</summary>

暂无。

</details>
