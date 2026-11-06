---
description: "Host-side enterprise Desktop routing for the metered model gateway and cloud control plane."
kind: "package-reference"
---

# @deepseek-ai/dsh-enterprise-desktop

English | [中文](README.zh.md)

## Summary

Private Host integration for the enterprise Desktop application. It exposes one `enterprise-gateway` LLM provider, forwards model calls to the pinned cloud origin through the user's short-lived access token, and fails closed when the gateway, catalog, or team quota is unavailable. Refresh credentials never enter the Host.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

```ts
const transport = new EnterpriseCloudTransport({ bootstrap: enterpriseBootstrapPort })
const dispose = installEnterpriseModelRoute(ctx, transport, catalog, ctx.webServer.getOrigin())
const disposeBilling = installEnterpriseBillingRoute(ctx, transport, enterpriseBootstrapPort)
```

The catalog comes from `GET /enterprise/api/desktop/models`. The local route accepts only the private `enterprise-session` placeholder; the transport replaces it with the current bearer token. A 401 triggers one access refresh through the bootstrap port, then the same request is retried once.

The package's `./client` entry adds a compact sidebar quota row. It reads `GET /enterprise/api/desktop/billing` through the local Host route, shows team remaining tokens and the member's usage, switches immediately on `quota_exhausted`, and opens the cloud billing page in the system browser. It claims that code in `shell.quota-notice`, so the failure appears in the row instead of the generic chat toast.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the existing pi-ai adapter and agent loop, which assemble and stream model-visible content; the Host adds only the enterprise gateway route and cloud transport.

#### KV Cache effect

The gateway forwards request content unchanged, and the quota row adds no prompt context. Selecting another enterprise model changes the route, not the prompt prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The application requires the enterprise identity bootstrap, model gateway, and billing endpoint; it has no direct-provider fallback or offline mode.
- The gateway supports only `openai-chat`, `openai-responses`, and `anthropic-messages` channel protocols.
- The Desktop application does not embed the administration console; billing and account management open in the system browser.
- The quota row displays the latest reported allowance but does not purchase a plan; purchasing opens the cloud billing page.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
