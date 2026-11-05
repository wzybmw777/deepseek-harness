---
description: "Host-side enterprise Desktop routing for the metered model gateway and cloud control plane."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-enterprise-desktop

English | [中文](README.zh.md)

## Summary

Private Host integration for the enterprise Desktop application. It exposes one `enterprise-gateway` LLM provider, forwards model calls to the pinned cloud origin through the user's short-lived access token, and fails closed when the gateway, catalog, or team quota is unavailable. Refresh credentials never enter the Host.

## Use this package

```ts
const transport = new EnterpriseCloudTransport({ bootstrap: enterpriseBootstrapPort })
const dispose = installEnterpriseModelRoute(ctx, transport, catalog, ctx.webServer.getOrigin())
const disposeBilling = installEnterpriseBillingRoute(ctx, transport, enterpriseBootstrapPort)
```

The catalog comes from `GET /enterprise/api/desktop/models`. The local route accepts only the private `enterprise-session` placeholder; the transport replaces it with the current bearer token. A 401 triggers one access refresh through the bootstrap port, then the same request is retried once.

The package's `./client` entry adds a compact sidebar quota row. It reads `GET /enterprise/api/desktop/billing` through the local Host route, shows team remaining tokens and the member's usage, switches immediately on `quota_exhausted`, and opens the cloud billing page in the system browser. It claims that code in `shell.quota-notice`, so the failure appears in the row instead of the generic chat toast.
