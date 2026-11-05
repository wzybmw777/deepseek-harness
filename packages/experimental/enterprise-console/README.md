---
description: "Enterprise SaaS shell and administration API for a DSH Web deployment."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-enterprise-console

English | [中文](README.zh.md)

## Summary

An opt-in Host plugin that serves an enterprise login page, administration console, and authenticated tenant gateway for DSH Web. `/enterprise/` owns account, team, role, plan, channel, usage, and audit administration. Every active team receives a rootless Podman container and a DSH Web process below `/t/<team-slug>/harness/`, with its own DSH home, workspace, session history, credentials, and browser-auth secret. The control plane runs as an unprivileged service user; the container contract and verification matrix live in [tenant isolation](docs/TENANT-ISOLATION.md) ([中文](docs/TENANT-ISOLATION.zh.md)).

## Table of Contents

- [Use this package](#use-this-package)
- [Authentication and Harness access](#authentication-and-harness-access)
- [Plugins](#plugins)
- [Team resources](#team-resources)
- [Remote browser](#remote-browser)
- [Billing and quota](#billing-and-quota)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Build the console frontend and mount the plugin through the repository overlay:

```sh
pnpm --filter @deepseek-ai/dsh-enterprise-web build
pnpm dsh web --patch packages/experimental/enterprise-console/cordis.patch.yml
```

Open `/` to enter the AI workbench. An unauthenticated visitor is always redirected to `/enterprise/login`; there is no guest tenant or shared anonymous workspace. An authenticated session starts the user's team container and redirects to its gateway mount. `/enterprise/` remains the direct console entry, and `/enterprise/workspace` is the launch gate. The first boot creates a private data directory, seeds the SQLite catalog at `<dataDir>/enterprise.sqlite`, and writes the initial administrator password to `<dataDir>/initial-admin-password.txt` with owner-only permissions. Delete that file after signing in and changing the password. Back up `enterprise.sqlite`, `session.key`, and `credential.key` together.

Configuration:

- `distRoot` — built enterprise frontend directory.
- `dataDir` — durable SQLite catalog, signing key, and encrypted channel credentials.
- `bootstrapAdminEmail` — first administrator address; used only during seeding.
- `brandName` — product name shown by the console.
- `tenantRoot` — private directory containing one isolated Harness home and workspace per team.
- `tenantDshEntry` — built `apps/cli/lib/bin.js` mounted read-only into each tenant container.
- `tenantSourceRoot` — repository build tree whose `apps`, `packages`, `node_modules`, `native`, `vendor`, and package metadata are mounted read-only.
- `tenantTemplateHome` — Harness home whose Web profile and model credentials seed each new tenant.
- `tenantProfile` — profile name loaded by every tenant container.
- `tenantPublicOrigin` — optional browser-facing origin; defaults to the advertised Web origin.
- `verificationWebhookUrl` / `verificationWebhookToken` — HTTPS gateway and optional bearer token for email or SMS verification delivery; code login and self-registration stay unavailable when the URL is omitted.
- `tenantContainerImage` / `tenantContainerPodman` — rootless image and Podman executable.
- `tenantContainerMemoryMb` / `tenantContainerPids` — hard per-container memory and PID ceilings.
- `tenantPortStart` / `tenantPortEnd` — loopback port range reserved for tenant containers.
- `maxTenantProcesses`, `tenantIdleTimeoutMinutes`, and `tenantStartTimeoutMs` — capacity and lifecycle limits.
- `browserChromePath` / `browserXvfbPath` — headful Chromium and Xvfb executables on the enterprise Host.
- `browserProxyUrl` / `browserProxyBypass` — optional Chromium proxy and bypass list.
- `browserMaxSessions` / `browserMaxSessionsPerUser` / `browserIdleTimeoutMinutes` — remote Browser capacity and idle cleanup.
- `browserNavigationTimeoutMs` — maximum wait for one remote document navigation.

<a id="authentication-and-harness-access"></a>
## Authentication and Harness access

The plugin issues an HttpOnly, SameSite=Lax enterprise session cookie. Accounts sign in with their email address or an administrator-bound phone number and password. When a verification webhook is configured, the same identifier can sign in with a one-time email or SMS code. Every signed-in account can change its own password from the account menu in the console or Harness; the change rotates the session and invalidates other devices. Self-registration is disabled by default; when enabled, a verified registrant joins the configured default team with the default role, subject to its seat limit. The owner role is built in and immutable. Only owners can manage roles or assign administrator and owner roles; administrators can add and manage members only. Codes expire after ten minutes, cannot be reused, allow five attempts, and are throttled by identifier and request source. Every mutating API request checks the browser origin, and every administrative route checks the signed-in role against a permission key. Audit records are appended for successful mutations.

<a id="plugins"></a>
## Plugins

Owners add and control the optional built-in plugins shared by every team and can also add enterprise-only packages. Administrators can add and manage enterprise-only packages but cannot change built-ins. Tenant workbenches hide the plugin management page and deny the agent plugin management tool; the gateway permits only plugin reads and rejects every other plugin-manager RPC.

The verification webhook receives `POST` JSON containing `identifier`, `channel`, `code`, `purpose`, `brandName`, and `expiresInSeconds`; it must return a 2xx response after handing the message to the deployment's email or SMS provider. Remote webhook URLs must use HTTPS. The control plane does not ship an email or SMS provider; without an operational gateway, the console keeps password login available and hides code login and registration.

`GET /enterprise/api/harness/launch` redirects unauthenticated requests to login, then resolves the signed-in user's team, rejects unassigned or suspended teams, starts that team's rootless container when necessary, audits the launch, and redirects to `/t/<team-slug>/harness/`. The gateway authenticates every HTTP request and WebSocket upgrade itself, verifies that the session belongs to the slug's team, and rejects cross-tenant, suspended, and unauthorized access.

The DSH launch token is exchanged inside the Host process. The tenant cookie and launch token never enter the browser, URL, or logs. The gateway injects the tenant cookie only on the loopback request, strips every upstream `Set-Cookie`, and rewrites internal redirects. The Harness page loads `/enterprise/session-guard.js`, which brands the sidebar and empty-session hero as 织流 and replaces the account launcher with the signed-in enterprise identity and avatar; its menu opens the administration console for authorized roles, password change, Harness settings, and sign-out. The guard revalidates the session on focus, visibility changes, and every 15 seconds, and returns to login when the session is revoked. Active WebSocket connections are revalidated by the gateway every 15 seconds. Enterprise logout expires the enterprise cookie and legacy Harness cookies. The DeepSeek account entry inside the Harness is a separate model-account sign-in; it is not enterprise authentication.

A reverse proxy should route both `/t/` and `/enterprise/` to the same Host listener, preserve WebSocket upgrade headers for `/t/<slug>/harness/api/remote.mux`, and stop exposing any shared `/harness/` route. The gateway performs tenant authorization, so `/t/` does not need a second `auth_request`; adding one would authenticate the same enterprise cookie twice without improving isolation.

<a id="team-resources"></a>
## Team resources

The tenant sidebar's resource group opens [team resource panels](../client-ui-enterprise-resources/README.md) inside the current Harness workbench. Selecting Files, Knowledge, or Skills keeps the URL under `/t/<team-slug>/harness/` and switches the main panel; it does not navigate to the `/enterprise/resources/*` administration pages or an external service. Every member with `workspace.use` can browse the team-shared resources. Mutations additionally require `workspace.resources.write`, which the owner role receives by default, so members see the same files, knowledge, and skills as read-only. The tenant resource panels resolve the team from the signed-in user; the `/enterprise/resources/*` administration pages show a team selector only to roles with `teams.read` and send the selected `teamId`. The API rejects requests resolved through an unassigned or inactive own team, refuses cross-team access without `teams.read`, and checks the browser origin on every mutation.

Files are rooted at `<tenantRoot>/<team-id>/documents/deepseek-harness/default-workspace`, the same default workspace used by that team's Harness process. The console supports directory navigation, folder creation, multipart-free bounded uploads, text preview and editing, rename, delete, and streamed download. Uploads are limited to 20 MiB; inline text is limited to 2 MiB and must be strict UTF-8. Hidden paths, absolute paths, `..`, symlinks, and non-regular files are rejected. On Linux, each directory traversal stays pinned to an open directory descriptor through `/proc/self/fd` with `O_NOFOLLOW`.

Skills are read from and written to `<tenantRoot>/<team-id>/home/skills`. The console creates directory skills as `<name>/SKILL.md` and also manages existing flat `<name>.md` skills. Because this is the tenant's `DSH_HOME`, the standard `skill-filesystem` provider discovers the same files without an import step or a second storage system. `team-knowledge` is reserved for the knowledge generator and cannot be edited or deleted from the skills page.

Knowledge articles are stored at `<tenantRoot>/<team-id>/resources/knowledge/articles.json` and support list, create, edit, and delete operations. Every successful change regenerates `<home>/skills/team-knowledge/SKILL.md` plus one Markdown reference per article, so the team agent can load team policies and runbooks through the normal skill catalog. An empty knowledge base removes the generated skill. The knowledge base is limited to 500 articles and 4 MiB of stored JSON; each article body is limited to 128 KiB.

Each team's files, skills, and knowledge stay in its own subtree, and the console never merges one team's catalog with another team's. This directory is bind-mounted into that team's rootless container. Resource management adds no host mount, device, credential, or Podman capability to the tenant. The control plane writes only the selected team's subtree after checking `teams.read`, and the tenant still cannot reach the enterprise SQLite database, session keys, other team roots, or the container runtime socket.

<a id="remote-browser"></a>
## Remote browser

The enterprise shell switches the Sidebar Browser from an iframe to a Host Chromium page, so sites that reject framing still render. The console starts a headful Chromium process on a private Xvfb display, validates the address, and streams JPEG frames over an authenticated same-origin event stream. Pointer, wheel, keyboard, paste, navigation, and viewport resize operations use the same enterprise session cookie and require `workspace.use`.

Sessions are keyed by team and user. A member cannot control or observe another member's Chromium page even when the opaque session id is known. The pool enforces a per-user limit, a Host-wide limit, and idle cleanup; closing a Browser tab closes its Chromium context and temporary profile.

Only public HTTP(S) addresses are accepted. URLs containing credentials, literal IP addresses, `localhost`, `.localhost`, `.local`, `.internal` names, or the enterprise origin are rejected. Chromium uses an isolated temporary profile, downloads are disabled, no debugging port is exposed, and subresource requests to the enterprise origin are blocked. The deployment installs the configured Chromium and Xvfb executables and supplies proxy egress when public sites require it. This browser runs in the enterprise control-plane process, not inside a tenant container.

<a id="billing-and-quota"></a>
## Billing and quota

Each team shares the current plan's `monthlyCredits` for the UTC calendar month. Owners with `billing.purchase` can order or renew a plan from `/enterprise/billing`; another order is blocked while one is pending, and an administrator with `orders.write` confirms or rejects it. The workbench sidebar shows the team's remaining quota, the signed-in member's usage, and a link to the same page.

The tenant browser plugin reports each completed Turn's provider-reported tokens to `POST /enterprise/api/billing/usage`; the server records `inputTokens + outputTokens` once per `sessionId` and `turn`. Reporting runs in the browser, so a turn completed while that page was closed is not metered, and a zero balance does not currently block model requests.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the existing `skill-filesystem` catalog and `skill` tool, which expose user-created skills and `team-knowledge`; knowledge references remain ordinary workspace files and the plugin adds no prompt, tool, or Session event.

#### KV Cache effect

Creating or deleting a skill, or changing its description, changes the skill catalog and can invalidate the cached prompt prefix on the next request. Changing only instructions affects the next explicit load; editing files or knowledge without a catalog change does not modify the request prefix. Regenerating `team-knowledge` keeps its catalog entry stable while replacing the content that a later load returns.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Rootless containers share the host kernel. Kernel, Podman, crun, and the tenant image remain trusted components and must stay patched.
- CPU quota is not enforced by this deployment because the host user slice delegates only memory and PID controllers; the detailed residual-risk analysis is in [tenant isolation](docs/TENANT-ISOLATION.md) ([中文](docs/TENANT-ISOLATION.zh.md)).
- Container recycling retains tenant DSH homes and workspaces. Removing enterprise team data does not currently delete the corresponding private tenant directory.
- Billing is an administrative ledger for manual receipts; it does not integrate an online payment provider.
- Turn metering is browser-reported and quota exhaustion does not block requests.
- Model-channel credentials are encrypted at rest but are administrative metadata; wiring them into model routing remains owned by the Harness provider configuration.
- Verification-code delivery depends on a deployment-operated HTTPS webhook gateway; the console does not embed an email or SMS provider.
- Remote Chromium rejects literal IP addresses and private suffixes but does not resolve third-party host names before navigation; deployment egress policy remains the network boundary.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
