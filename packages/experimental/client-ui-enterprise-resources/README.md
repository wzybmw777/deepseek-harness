---
description: "Team files, knowledge, and filesystem skills as Harness workbench panels, without leaving the tenant session."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-enterprise-resources

English | [中文](README.zh.md)

## Summary

The tenant sidebar's Files, Knowledge, and Skills entries open inside the current Harness workbench. Members browse the team-shared files, knowledge, and skills under `/t/<slug>/harness/`; accounts with `workspace.resources.write`, including owners by default, also get the editing controls. Every action uses the enterprise same-origin resource API and the signed-in team. The plugin adds no team selector, shared guest workspace, or second storage layer; the existing filesystem skill provider discovers the same skills and generated `team-knowledge` content.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The enterprise tenant runtime inserts this plugin into every tenant's generated patch. It has no configuration fields and the Host export is inert; the browser entry registers three main panels and the sidebar bridge.

Selecting **Files**, **Knowledge**, or **Skills** from the resource group keeps the current URL and opens the corresponding main panel. Every member can navigate, preview, download, and inspect shared content. Writers can also upload, create folders, rename, delete, edit text files, maintain knowledge articles, and manage user-authored skills; knowledge-generated skills stay read-only. Failures stay inside the active page with retry or dismiss controls.

The pages are available only when the enterprise Host plugin supplies its authenticated resource API. They are not a standalone administration site and do not accept a team id from the browser.

The same browser plugin reports each completed Turn's provider-reported token usage to `/enterprise/api/billing/usage`. The enterprise Host deduplicates the report by Session and Turn and charges the signed-in member's team.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser plugin owns the `enterprise-files`, `enterprise-knowledge`, and `enterprise-skills` main-slot keys. The enterprise sidebar dispatches `dsh-enterprise-resource-open`; the plugin validates the requested kind and calls `ctx.layout.selectPanel`. A `layout.panelInfo` subscription dispatches `dsh-enterprise-resource-active`, which drives the sidebar's selected row. Fiber teardown removes the slot entries, dictionaries, and both DOM subscriptions.

The page code calls the same-origin `/enterprise/api/resources/*` routes for listings and mutations. The server resolves the team from the signed-in session, so no page sends a team identifier. File uploads stream the selected `File` as the request body, and the pages treat a 204 mutation response as success. A 401 response emits `enterprise:unauthorized` for the surrounding enterprise guard.

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Main-panel registration and sidebar event bridge |
| [`src/client/FilesPanel.tsx`](src/client/FilesPanel.tsx) | Workspace file manager |
| [`src/client/KnowledgePanel.tsx`](src/client/KnowledgePanel.tsx) | Knowledge catalog and editor |
| [`src/client/SkillsPanel.tsx`](src/client/SkillsPanel.tsx) | Filesystem skill catalog and editor |
| [`src/client/common.tsx`](src/client/common.tsx) | Shared page shell, dialogs, notices, and error presentation |
| [`src/client/api.ts`](src/client/api.ts) | Same-origin resource API client and response failures |
| [`src/client/usage-reporter.ts`](src/client/usage-reporter.ts) | Completed-Turn token reporting |
| [`tests/`](tests/) | Panel registration, navigation bridge, API, and page-flow tests |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Enterprise console](../enterprise-console/README.md) — authentication, tenant isolation, and the resource API behind these pages.
- [Layout](../../client/ui-layout/README.md) — main-panel selection and the shared `panelInfo` store.
- [Slots](../../client/ui-slots/README.md) — main-slot registration and localized component props.
- [Experimental packages](../README.md) — incubation status and publication policy.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the existing `skill-filesystem` catalog and `skill` tool, which discover user-authored skills and the generated `team-knowledge` skill; the browser pages add no prompt, tool, or Session event.

#### KV Cache effect

Creating or deleting a skill, or changing its description, changes the skill catalog and can invalidate the cached prompt prefix on the next request. Editing only skill instructions affects the next explicit load. File or knowledge edits that do not change the catalog leave the request prefix unchanged, while regenerated `team-knowledge` content appears when an Agent loads that skill.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One workspace per team** — every member and Agent in a team uses the same isolated sandbox; the UI has no personal or cross-team file view.
- **Enterprise-only surface** — the panels require the enterprise resource API and intentionally do not fall back to the public Harness workspace file API.
- **No sharing or quota controls** — the pages do not expose public links, guest access, per-user quotas, a skill marketplace, or recommendation content.
- **Server-owned bounds** — upload, text-edit, article, and storage limits are enforced by the [enterprise console](../enterprise-console/README.md); the UI only reports the resulting validation failures.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
