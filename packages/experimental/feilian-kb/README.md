---
description: "Ship the Feilian enterprise knowledge base plugin as a built-in bundle for the enterprise console."
kind: "package-bundle"
---

# @deepseek-ai/dsh-feilian-kb

English | [中文](README.zh.md)

## Summary

This optional bundle vendors the Feilian Knowledge plugin, first published as the `dsh-feilian-kb` tarball, so the enterprise console offers it as a built-in entry instead of asking owners to install an address by hand. Enabling it adds the Feilian sidebar page where a member signs in with an enterprise account, browses compiled pages and sources, explores the knowledge graph, and configures office bots.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Open Plugins in the enterprise console and find 飞链知识库 in the built-in group. Adding it projects the bundle into every tenant profile from then on; the entry starts switched off because the page needs a Feilian account. Tenants restart their workspace, then sign in from the sidebar page. Removing the selection stops projecting the page, and the Host keeps the stored Feilian session until the member signs out.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer information — click to expand</summary>

`cordis.patch.yml` inserts one Host row, `feilian-kb`. The published `dsh-feilian-kb@0.2.7` bundles were adopted as `src/index.ts` and `src/client/index.ts` and rebuild into `lib/`: `lib/index.js` registers the `/api/feilian-kb/*` routes through the Host connection service and stores the read-only `kb_` credential under `feilian-kb/session` in the DSH credential store, and `lib/client.js` mounts the sidebar page. The client bundle registers itself under the package name, so the package identity has to match the row.

Local modifications to the vendored bytes, all documented here, are the package name in the patch, the `@deepseek-ai/` prefix in the client bundle's loader id, the module export that replaces the loader wrapper, and a `BUILTIN` guard that makes `checkPluginUpdate` return null because the plugin now upgrades with the application.

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Knowledge tools

#### What the model sees

The plugin registers `feilian_kb_search` and `feilian_kb_page`; both stay unavailable until the member signs in, and both read compiled pages from the knowledge bases that member can already see.

#### Token effect

Two tool schemas become visible after sign-in and stay fixed for the session. Result text is data-dependent and resent until compaction.

#### KV Cache effect

Prefix-stable while the visible tool set and schemas are unchanged. Signing in or out changes tool availability and may invalidate reuse from the first changed schema token.


<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- The vendor copy carries one upstream revision. Re-vendoring a newer `dsh-feilian-kb` means repeating the four local modifications above.
- The page depends on the Feilian service at `flylink.yituobo.com`; it renders a sign-in error rather than offline content when the service is unreachable.
- The stored Feilian session is not migrated between tenants; each tenant signs in once.