---
description: "Team files, knowledge, and filesystem skills as Harness workbench panels, without leaving the tenant session."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-enterprise-resources

English | [中文](README.zh.md)

## Summary

The tenant sidebar's Files, Knowledge, and Skills entries open inside the current Harness workbench. Members browse the team-shared files, knowledge, and skills under `/t/<slug>/harness/`; accounts with `workspace.resources.write`, including owners by default, also get the editing controls. Every action uses the enterprise same-origin resource API and the signed-in team. The plugin adds no team selector, shared guest workspace, or second storage layer; the existing filesystem skill provider discovers the same skills and generated `team-knowledge` content.

## Table of Contents

- [Use this package](#use-this-package)
- [Workbench market, usage, and project folders](#workbench-market-usage-and-project-folders)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The enterprise tenant runtime inserts this plugin into every tenant's generated patch. It has no configuration fields and the Host export is inert; the browser entry registers four main panels, an anchored usage summary, both project-directory flow occupants, and the sidebar bridge.

Selecting **Files** or **Knowledge** from the resource group keeps the current URL and opens the corresponding main panel. Every member can navigate, preview, download, and inspect shared content. Writers can also upload, create folders, rename, delete, edit text files, maintain knowledge articles, and manage user-authored skills; knowledge-generated skills stay read-only. Failures stay inside the active page with retry or dismiss controls.

The pages are available only when the enterprise Host plugin supplies its authenticated resource API. They are not a standalone administration site and do not accept a team id from the browser.

The same browser plugin reports each completed Turn's provider-reported token usage to `/enterprise/api/billing/usage`. The enterprise Host deduplicates the report by Session and Turn and charges the signed-in member's team.

-----

The default sidebar shows Files, Knowledge and Agents. Skill administration remains available through the existing resource surfaces. The Knowledge panel manages the internal team knowledge base shipped with this package.

Resource requests and usage reports derive the public deployment prefix from the current tenant mount, so a workbench at `/preview/t/<slug>/harness/` uses `/preview/enterprise/api/` without sending mutations or billing reports to the origin-root deployment.

<a id="workbench-market-usage-and-project-folders"></a>
## Workbench market, usage, and project folders

Marketplace choices create a fresh conversation in the first registered project, initializing the default project when eligible. They preserve other conversations' drafts; the project can be changed before submission. The chosen agent's name becomes that conversation's title, keeping an otherwise untitled chat recognizable in the project list.

Agents opens the native marketplace for discovery, categories, search, and unlock confirmation. Using an unlocked agent selects it through the existing chat @ interaction. A knowledge-base chip may already precede the agent token; the pick keeps that chip in the task material. Its durable command reference restores execution status, output, and owner-checked downloads in conversation history; there is no separate work gallery. The authenticated product API still enforces access, expiration, usage reservation, and settlement. The current agent executor accepts text materials; attachments remain in ordinary chat. The quota trigger opens a small plan-progress and available-points popover; authorized users explicitly open administration in another tab for details. The existing plan meter and the new product wallet remain separate.

The chat @ menu adds a Feilian knowledge base group that lists the bases the tenant can read after signing in from the sidebar page. A pick inserts a knowledge-base reference; on submit it serializes into a `@name [飞链知识库 id=…]` line that the message view renders back as a chip, so the model answers with the Feilian plugin's own `feilian_kb_search` and `feilian_kb_page` tools against that base. Before sign-in the group offers only Sign in to Feilian knowledge, which opens the sidebar page.

For the web preview, New project browses only the signed-in team sandbox, supports breadcrumbs and new folders, and passes a verified directory to the existing workspace owner. It does not upload computer folders. Desktop retains its native Windows folder chooser; sharing this new visual treatment with Desktop is deferred. Folder creation remains writer-only. The two directory-flow single slots are intentionally shadowed at priority -100; the usage overlay has its own list-entry id. Errors offer in-place retry.

New copy is supplied in Chinese and English; the other supported locales use English for these additions.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser plugin owns the `enterprise-files`, `enterprise-knowledge`, `enterprise-skills`, and `enterprise-market` main-slot keys. The enterprise sidebar dispatches `dsh-enterprise-resource-open`; the plugin validates the requested kind and calls `ctx.layout.selectPanel`. A `layout.panelInfo` subscription dispatches `dsh-enterprise-resource-active`, which drives the sidebar's selected row. Fiber teardown removes the slot entries, dictionaries, and both DOM subscriptions.

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
| [`src/client/feilian-mentions.ts`](src/client/feilian-mentions.ts) | `@` group that scopes a question to one Feilian knowledge base |
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

Indirectly, through the existing `skill-filesystem` catalog and `skill` tool, which discover user-authored skills and the generated `team-knowledge` skill; the file and internal knowledge pages add no prompt or tool. Agent interactions use the existing command lifecycle in the Session log. Private agent prompts and skills remain in the server executor, separate from the ordinary Harness model history.

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
