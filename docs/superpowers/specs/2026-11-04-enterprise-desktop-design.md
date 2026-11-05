---
description: "Architecture, trust boundaries, and delivery stages for an enterprise desktop client that runs Harness workloads locally while sharing enterprise data and metering through the cloud service."
---

# Enterprise Desktop Client Design

English | [中文](2026-11-04-enterprise-desktop-design.zh.md)

## Summary

The Desktop client provides the enterprise workbench while moving agent execution, local tools, terminal work, file processing, and browser rendering from the server to the user's computer. The enterprise service remains authoritative for identity, team membership, permissions, shared resources, model access, billing, audit, and client policy. This is a cloud control plane with a local execution plane, not a local copy of the enterprise console.

## Intent

The desktop client exists to reduce the memory, process, and Chromium cost of keeping one server-side Harness runtime per team. Users must still sign in to the same enterprise account, work inside the same team boundary, and use the same shared files, knowledge, skills, model catalog, and Token balance as the Web workbench.

## Goals

- Authenticate with the existing enterprise email and password account system.
- Run the Harness Host, agent sessions, terminal, local tools, file processing, and browser on the user's computer.
- Keep team files, knowledge, skills, permissions, plugin policy, model selection, quota, and audit in the cloud, with team resources read only when a task asks for them.
- Send every model request through the enterprise model gateway so usage is metered and channel credentials never reach the client.
- Let team members read the same Session while only its owner keeps write access.
- Retain the existing Web workbench as the no-install path for users who cannot run the desktop application.

## Non-goals

- Offline work or conflict resolution after reconnecting.
- A local instance of the enterprise administration console or enterprise SQLite catalog.
- Server-side tenant containers for desktop users.
- Multi-team membership or team switching in the first release.
- An online payment provider or a remote execution cluster.

## Constraints

- The client requires network access for sign-in, team resources, model requests, quota refresh, and client policy.
- Team files, knowledge, and skills are never persistently cached on the user's computer; a task may materialize them only in a private temporary directory that is deleted when the task ends.
- Existing enterprise accounts and passwords remain the only required sign-in method in the first release.
- The existing enterprise model assigns one team to each user; the desktop profile follows that rule.
- Session logs are stored by the enterprise service; the Session owner is the only writer and team members subscribe read-only.
- Windows x64 is the first supported desktop platform; macOS follows after the Windows release is accepted.
- The service deployment remains able to serve the current Web workbench and remote Chromium browser.

## Architecture

### Cloud control plane

The existing enterprise console keeps users, teams, roles, plans, orders, usage, audit, model channels, runtime policy, and the canonical team resource trees. It adds desktop bootstrap, on-demand resource reads, model gateway endpoints, and a Session synchronization service. The synchronization service stores the append-only Session log, a write lease, and a read-only live stream for team members. The control plane never starts a tenant container for an authenticated desktop session.

### Desktop execution plane

Electron owns enterprise sign-in, secure token storage, cloud requests, the local DSH Host lifecycle, updates, and native capabilities. A local Host plugin connects the Harness to the cloud bootstrap, model gateway, on-demand resource reads, Session synchronization, plugin policy, quota notices, and enterprise account menu. Agent turns and task workspace files execute locally under the signed-in user's operating-system account.

### Web fallback

The current Web path remains available. Browser users still launch a team tenant and use the server-side Chromium remote browser. Both clients share enterprise identity, team resource APIs, Session synchronization, model catalog, quota, and audit records, while only their execution location differs.

## Login and session

The Desktop welcome flow gains an enterprise mode that replaces the model-API-key onboarding. Electron main performs the login request in an isolated network session, stores the long-lived credential in the operating-system credential store, and gives the local Host only a short-lived enterprise access token plus the cloud base URL. The access token expires quickly, the refresh credential is device-bound, and signing out revokes only that device.

The local Host starts after login and team resolution. Electron main refreshes expiring access through a loopback control channel, so renderer code and third-party plugins never receive the refresh credential. Logout stops the Host, clears in-memory tokens, and deletes every task-scoped team resource directory. Disabling an account or removing team access takes effect at the next authorization or refresh check.

## Model gateway

The control plane adds an authenticated pass-through model gateway keyed by the selected enterprise model and channel. A desktop request carries the enterprise access token, team, user, selected model, and a client-generated request identity. The bootstrap tells the Host which provider protocol, route, model id, context window, and capabilities apply, so the gateway preserves the existing Chat Completions, Responses, or other channel protocol instead of flattening model behavior. The gateway checks team status, plan quota, model access, and channel status before contacting the upstream provider.

The gateway forwards streaming and non-streaming responses, tool calls, reasoning fields, images, cancellation, and provider errors. It records both input and output tokens server-side from the final provider usage and deduplicates retries by request identity. Quota is enforced at team level at request start; a request already streaming is not cut off, and the next request fails closed after the balance reaches zero. It never returns channel API keys or upstream credentials.

## Shared resources

The cloud remains the only source of truth for team files, knowledge, and skills. Desktop bootstrap returns the team resource catalog, versions, and a capability to request resource content through the authenticated enterprise API. The client does not download a full tree and does not keep a reusable local cache.

When a task needs a team file, skill, skill reference, or knowledge article, the Host requests that item and materializes it in a private task-scoped directory with owner-only permissions. Knowledge summaries may be fetched during task planning, while full article bodies and large files are fetched only when selected. The generated `team-knowledge` skill is fetched as a read-only resource on demand.

Team resources are read-only in the desktop client. Edits continue through the enterprise console or another authorized administration surface. A task's materialized resources are deleted on completion, cancellation, logout, Host restart, or a bounded timeout. A failed fetch fails the requesting operation instead of falling back to stale local content.

## Sessions and workspace

The enterprise service is the durable owner of every Session log. The owner's desktop Host executes the turn, writes the local append-only log, and synchronizes each acknowledged batch to the cloud before the Session can continue beyond the configured unacknowledged-event limit. Checkpoints, task workspace files, terminal processes, and local tool output remain on the owner's computer unless a tool explicitly returns content or an attachment in a Session event. Arbitrary local workspace files are not shared through the Session.

The client uses a distinct local profile for each enterprise server and user so changing account or server cannot reuse another identity's Session store. The profile records the single team currently assigned by the enterprise service. On a new device, the owner downloads the complete Session log and obtains the write lease before continuing.

## Shared sessions

Each Session records its team, owner, visibility, format version, and current write lease. Only the owner can append events. The desktop acquires a renewable lease before a turn starts; losing the lease stops the running turn before another model or tool call. Another device owned by the same user may read while the lease is held elsewhere and can take over after the previous lease expires.

Team members open shared Sessions through a read-only Session API. They receive the complete replay-able log and a live event stream for turns in progress. The client renders the same transcript and tool cards but disables message input, queuing, approvals, and write actions. Reading a Session never acquires the write lease. A team member who needs to continue the work starts a new Session instead of appending to the shared one.

Shared Sessions are visible to every active member of the owning team. Session logs remain in the enterprise service until the owner or an authorized administrator deletes them; the first release does not expire them automatically. A read-only viewer sees a local-only artifact as unavailable unless the owner uploaded it through an enterprise resource or attachment path.

## Browser

Desktop continues to use the existing Electron browser guest for the Sidebar Browser. It must not inject the enterprise remote-browser endpoint into the local workbench, because rendering the Browser from the client removes the server Chromium cost. Web users keep the remote Chromium path. Both paths retain their current address validation and session isolation.

## Plugin policy

The desktop Host loads only built-in plugins and enterprise-approved bundles returned by the cloud policy. Administrators continue to control built-ins and enterprise bundles; members cannot add local plugins that bypass the policy. The enterprise service signs the approved manifest, the desktop build pins the service public key, and key rotation requires a signed application update. The client verifies the manifest signature and rejects a bundle whose identity, version, platform, or content hash differs from the approved record.

## Security and privacy

The client stores refresh credentials in Windows Credential Manager or DPAPI and keeps them out of the renderer, URL, logs, and plugin environment. Materialized team resources live only in task-scoped directories with owner-only permissions and are deleted automatically. The server authorizes every bootstrap, resource, and model request again; local policy is an additional check, not the authority.

Enterprise plugins and local tools can access local files only through the Host's normal tool permissions. The cloud policy can restrict the plugin allowlist, workspace scope, approval mode, and network egress; a missing or invalid policy fails closed. Sign-out and account or server switching delete every task-scoped resource directory and local Session replica after the cloud confirms synchronization. Server audit records include desktop sign-in, bootstrap, model usage, resource reads, Session access, and plugin-policy changes without recording prompts, terminal output, or file contents. Enterprise mode disables consumer analytics and redirects crash-report prompts to the enterprise support policy.

## Failure behavior

- A cloud outage prevents new sign-in, bootstrap, model calls, and shared-resource writes; the client keeps local state visible but refuses new work.
- An expired access token pauses model and resource requests until Electron main refreshes it; a revoked session tears down the Host and returns to enterprise login.
- A failed resource fetch fails the requesting tool or skill instead of running with stale or partial content.
- A Session synchronization failure pauses new model and tool work before the unacknowledged-event limit is exceeded; the owner keeps the visible local transcript and retries without creating a divergent cloud history.
- A model-gateway rejection preserves the local Session and shows the typed quota, permission, or channel failure without retrying indefinitely.
- A Host crash restarts the local runtime without replaying a side-effecting tool call; the user is returned to the last durable Session checkpoint.

## Distribution and updates

The existing signed Windows packaging and auto-update channel remain the distribution mechanism. Enterprise mode ships as a separately branded Windows application and update channel. The enterprise build pins the cloud base URL, update channel, and minimum supported version; members cannot repoint the application at another server. The cloud policy can require an update before bootstrap, but desktop updates never replace enterprise data or credentials. TLS-inspecting proxies and custom enterprise certificate authorities are outside the first release.

## Rollout

The first milestone delivers enterprise login, local Host startup, token refresh, Session synchronization with owner-only writes, and quota-aware model routing. The second milestone delivers read-only shared Sessions, on-demand resource reads with task cleanup, enterprise account chrome, browser verification, and plugin policy. The third milestone hardens failure recovery, temporary-resource cleanup, Windows signing, and Windows acceptance. The Web tenant and remote browser remain available throughout. Enterprise administrators open the cloud console in the system browser; the desktop application does not embed the administration console.

## Acceptance criteria

- An enterprise member signs in with email and password and reaches a locally hosted workbench without a server tenant container.
- Every model request passes through the enterprise gateway, consumes team quota, appears in usage and audit, and fails closed when quota is exhausted.
- Team files, knowledge, and skills are fetched only for a requesting task, disappear when that task ends, and never cross team or account boundaries.
- A team member opens the same Session and sees the owner's live and completed transcript without being able to append, approve, or control tools.
- Desktop Browser renders through the local Electron guest, while a Web user still receives the server Chromium browser.
- Sign-out stops the local Host, removes task-scoped team resources, and leaves no reusable refresh credential in the renderer or plugin environment.
- Network loss blocks new bootstrap, resource writes, and model calls with an actionable state instead of silently falling back to direct providers.

## Open decisions

None.
