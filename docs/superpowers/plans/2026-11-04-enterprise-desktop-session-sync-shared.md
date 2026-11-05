# Enterprise Desktop Session Sync and Shared Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every Desktop Session append-only in the enterprise service, allow only the owner device holding a renewable lease to append, and let team members follow the same Session read-only.

**Architecture:** A cloud Session service stores ordered event batches, idempotency keys, and write leases. The owner Host wraps its local SessionPersistence, uploads accepted batches, and blocks the next model or tool call when the lease or synchronization barrier is not healthy. Team members read the cloud log and live stream behind an `enterprise-viewer` Remote Access policy that grants only read actions.

**Tech Stack:** Node HTTP/SSE, SQLite (`node:sqlite`), Cordis events and effects, Remote Access, React, Vitest.

**Spec:** docs/superpowers/specs/2026-11-04-enterprise-desktop-design.md

## Global Constraints

- The Session log is append-only; committed events are never rewritten on the server.
- Only the Session owner device with a live renewable lease may append.
- A lease loss stops the running turn before the next model or tool call.
- The owner keeps the visible local transcript when synchronization fails and retries without creating divergent cloud history.
- Team members can read live and completed transcripts but cannot prompt, cancel, approve, rename, fork, upload, or control tools.
- Local profiles are isolated by server and user; no Session replica crosses that identity boundary.
- Search and list require the Session and user to belong to the same team; visibility must be `team` for non-owner access.
- Every append includes an idempotency key and contiguous first sequence; retries return the original acknowledgement.
- The cloud is the durable authority; local files remain on the owner's computer unless a tool explicitly places content in a Session event.
- Each task runs its named tests before and after implementation; do not commit a red test.

## Review Focus

- A team viewer calling prompt, approval, cancel, queue update, or tool control must be denied by Remote Access even if a hidden UI bug exposes the action; the policy test enumerates every write endpoint.
- Losing the lease between two steps must stop the turn before the next model or tool request; the Host guard test expires the lease after one completed step and observes both hooks.
- More than the configured unacknowledged-event or byte limit must pause work before cloud history diverges; the sync client test rejects the next step while preserving the local transcript.
- Replaying the same batch after a lost HTTP response must not duplicate events or advance the sequence twice; the server test submits the same idempotency key concurrently.
- Opening a shared Session from another account or team must return not-found rather than leaking metadata; the authorization test varies user, team, and visibility.

---

### Task 1: Create the Cloud Session Log and Lease Schema

**Files:**
- Create: `packages/experimental/enterprise-console/src/desktop-sessions.ts`
- Create: `packages/experimental/enterprise-console/tests/desktop-sessions.spec.ts`
- Modify: `packages/experimental/enterprise-console/src/types.ts`
- Modify: `packages/experimental/enterprise-console/src/store.ts`
- Modify: `packages/experimental/enterprise-console/tests/store.spec.ts`

**Interfaces:**
- Consumes: Enterprise user/team records, `SessionHeader`, `SessionEvent`, and the identity plan's `EnterpriseRequestSession`.
- Produces:
  ```ts
  export type DesktopSessionVisibility = 'private' | 'team'

  export interface DesktopSessionRecord {
    readonly id: string
    readonly teamId: string
    readonly ownerId: string
    readonly visibility: DesktopSessionVisibility
    readonly formatVersion: number
    nextSeq: number
    readonly createdAt: string
    updatedAt: string
  }

  export interface DesktopSessionLease {
    readonly sessionId: string
    readonly leaseToken: string
    readonly deviceId: string
    readonly expiresAt: string
  }

  export interface DesktopSessionBatch {
    readonly sessionId: string
    readonly idempotencyKey: string
    readonly firstSeq: number
    readonly events: readonly SessionEvent[]
  }

  export class DesktopSessionStore {
    create(input: { header: SessionHeader; visibility: DesktopSessionVisibility; ownerId: string; teamId: string; deviceId: string }): Promise<DesktopSessionLease>
    acquireLease(sessionId: string, userId: string, deviceId: string): Promise<DesktopSessionLease>
    renewLease(sessionId: string, userId: string, deviceId: string, leaseToken: string): Promise<DesktopSessionLease>
    releaseLease(sessionId: string, userId: string, deviceId: string, leaseToken: string): Promise<void>
    append(userId: string, deviceId: string, leaseToken: string, batch: DesktopSessionBatch): Promise<{ readonly acknowledgedSeq: number }>
    listForTeam(teamId: string, viewerId: string): Promise<readonly DesktopSessionRecord[]>
    read(input: { sessionId: string; teamId: string; viewerId: string; offset: number; length: number }): Promise<{ readonly events: readonly SessionEvent[]; readonly nextSeq: number; readonly revision: string }>
  }
  ```
- Lease lifetime is 60 seconds and renewable starting at 30 seconds remaining. The server stores only a hash of the lease token.
- `desktop_session_events` has `(session_id, seq)` as its primary key and immutable JSON payloads.
- `desktop_session_batches` has a unique `(session_id, idempotency_key)` constraint and stores the acknowledged sequence range.

- [ ] **Step 1: Write the failing persistence tests**

Add and assert:
```ts
it('appends contiguous events and reads the same immutable prefix', async () => {})
it('returns the original acknowledgement for a replayed idempotency key', async () => {})
it('rejects a non-contiguous first sequence without advancing nextSeq', async () => {})
it('rejects an append with a stale lease token', async () => {})
it('hides another team private session from list and read', async () => {})
```
- [ ] **Step 2: Run the persistence test to verify it fails**

Run: `pnpm exec vitest run packages/experimental/enterprise-console/tests/desktop-sessions.spec.ts`

Expected: FAIL because the Session schema and service do not exist.

- [ ] **Step 3: Add schema version 10 and the three Session tables**

Bump `SCHEMA_VERSION` from `9` to `10`. Create the Session record, event, and batch tables in one migration. Preserve prior tables and rows. Add indexes for team visibility, owner, lease expiry, and batch lookup.

- [ ] **Step 4: Implement create, acquire, renew, release, and append**

Use one store transaction per mutation. Validate team and owner equality, user/device revocation from the identity plan, format version, contiguous sequences, lease hash, and expiry. Never rewrite an existing event or batch.

- [ ] **Step 5: Implement team list and range read**

Filter by team and `visibility === 'team'` for non-owner viewers. Select event payloads in sequence order and return an opaque revision derived from the acknowledged sequence.

- [ ] **Step 6: Run the persistence and store tests to verify they pass**

Run: `pnpm exec vitest run packages/experimental/enterprise-console/tests/desktop-sessions.spec.ts packages/experimental/enterprise-console/tests/store.spec.ts`

Expected: PASS, including schema migration from version 9.

- [ ] **Step 7: Commit**

```bash
git add packages/experimental/enterprise-console/src/desktop-sessions.ts packages/experimental/enterprise-console/tests/desktop-sessions.spec.ts packages/experimental/enterprise-console/src/types.ts packages/experimental/enterprise-console/src/store.ts packages/experimental/enterprise-console/tests/store.spec.ts
git commit -m "feat(enterprise): persist desktop session logs"
```

### Task 2: Expose Session Sync and Live-Follow APIs

**Files:**
- Create: `packages/experimental/enterprise-console/src/desktop-session-api.ts`
- Create: `packages/experimental/enterprise-console/tests/desktop-session-api.spec.ts`
- Modify: `packages/experimental/enterprise-console/src/api.ts`
- Modify: `packages/experimental/enterprise-console/src/desktop-sessions.ts`

**Interfaces:**
- Consumes: Task 1 `DesktopSessionStore` and bearer authentication from the identity plan.
- Produces:
  - `POST /enterprise/api/desktop/sessions` with `{ header, visibility, deviceId }`
  - `POST /enterprise/api/desktop/sessions/{id}/lease` with `{ deviceId }` or `{ deviceId, leaseToken }` for renewal
  - `DELETE /enterprise/api/desktop/sessions/{id}/lease` with `{ deviceId, leaseToken }`
  - `POST /enterprise/api/desktop/sessions/{id}/events` with `{ deviceId, leaseToken, idempotencyKey, firstSeq, events }`
  - `GET /enterprise/api/desktop/sessions?offset=0&limit=50`
  - `GET /enterprise/api/desktop/sessions/{id}/events?offset=0&length=256`
  - `GET /enterprise/api/desktop/sessions/{id}/follow?after=<seq>` as `text/event-stream`
- Live-follow events are `{ type: 'events', events, nextSeq, revision }` and `{ type: 'lease', ownerId, expiresAt }`.
- SSE reconnects use `Last-Event-ID` as the next sequence and replay only committed events.

- [ ] **Step 1: Write the failing API tests**

Add and assert:
```ts
it('creates a session with the owner lease and no tenant preparation', async () => {})
it('renews a lease only for the current device', async () => {})
it('acknowledges concurrent duplicate batches once', async () => {})
it('streams committed events after the requested sequence', async () => {})
it('rejects an unauthenticated or expired-bearer follow request', async () => {})
```
- [ ] **Step 2: Run the API test to verify it fails**

Run: `pnpm exec vitest run packages/experimental/enterprise-console/tests/desktop-session-api.spec.ts`

Expected: FAIL because the routes do not exist.

- [ ] **Step 3: Implement fixed bearer routes and input validation**

Cap batches at 256 events and 1 MiB encoded JSON. Validate every event through the current Session schema before entering the store. Reject malformed IDs, unknown fields that affect authorization, oversized bodies, invalid sequences, and non-monotonic ranges.

- [ ] **Step 4: Implement SSE follow with backpressure**

Use server-side polling of committed ranges or a per-process notifier. Disconnect slow clients when the socket buffer exceeds the configured limit. On reconnect, replay only from the last acknowledged sequence and never from an uncommitted local state.

- [ ] **Step 5: Add audit without transcript content**

Record create, lease acquire/loss, read/follow, and append metadata. Audit summaries include ids, ranges, and counts only; never prompts, tool output, terminal output, or file content.

- [ ] **Step 6: Run the API tests to verify they pass**

Run: `pnpm exec vitest run packages/experimental/enterprise-console/tests/desktop-session-api.spec.ts packages/experimental/enterprise-console/tests/desktop-sessions.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/experimental/enterprise-console/src/desktop-session-api.ts packages/experimental/enterprise-console/tests/desktop-session-api.spec.ts packages/experimental/enterprise-console/src/api.ts packages/experimental/enterprise-console/src/desktop-sessions.ts
git commit -m "feat(enterprise): expose desktop session synchronization"
```

### Task 3: Wrap Local Persistence with Lease-Aware Cloud Sync

**Files:**
- Create: `packages/experimental/enterprise-desktop/src/host/session-sync.ts`
- Create: `packages/experimental/enterprise-desktop/src/host/lease-guard.ts`
- Create: `packages/experimental/enterprise-desktop/tests/session-sync.spec.ts`
- Create: `packages/experimental/enterprise-desktop/tests/lease-guard.spec.ts`
- Modify: `packages/experimental/enterprise-desktop/src/host/index.ts`
- Modify: `apps/desktop-host/src/index.ts`

**Interfaces:**
- Consumes: `SessionPersistence`, `SessionHandle`, `SessionHeader`, `SessionEvent`, `ctx.effect()`, `agent/pre-step`, and `tools/pre-execute` through Task 2.
- Produces:
  ```ts
  export interface DesktopSessionSyncClient {
    create(input: { header: SessionHeader; visibility: 'private' | 'team'; deviceId: string }): Promise<{ readonly lease: DesktopSessionLease }>
    acquire(sessionId: SessionId, deviceId: string): Promise<DesktopSessionLease>
    renew(lease: DesktopSessionLease): Promise<DesktopSessionLease>
    release(lease: DesktopSessionLease): Promise<void>
    append(input: { lease: DesktopSessionLease; idempotencyKey: string; firstSeq: number; events: readonly SessionEvent[] }): Promise<{ readonly acknowledgedSeq: number }>
    read(sessionId: SessionId, offset: number, length: number): Promise<{ readonly events: readonly SessionEvent[]; readonly nextSeq: number; readonly revision: string }>
  }

  export class EnterpriseSessionPersistence extends SessionPersistence {
    constructor(local: SessionPersistence, cloud: DesktopSessionSyncClient, limits: { readonly maxEvents: number; readonly maxBytes: number })
  }

  export function installEnterpriseLeaseGuard(ctx: Context, persistence: EnterpriseSessionPersistence): () => void
  ```
- Default unacknowledged limit: 64 events or 1 MiB, whichever is reached first.
- `append()` resolves only when either the cloud acknowledges the batch or the batch remains inside the unacknowledged limit. A later ownership loss rejects the next guard barrier.
- Local Session data and cloud data use the same event sequence; cloud acknowledgement never renumbers events.

- [ ] **Step 1: Write the failing session-sync tests**

Add and assert:
```ts
it('uploads accepted local batches with one idempotency key', async () => {})
it('retries the same batch after a lost acknowledgement without renumbering', async () => {})
it('pauses before the unacknowledged-event limit is exceeded', async () => {})
it('preserves the local transcript when cloud synchronization fails', async () => {})
it('stops a turn before the next model call after mid-turn lease loss', async () => {})
it('stops a turn before the next tool call after mid-turn lease loss', async () => {})
it('restarts from the last durable checkpoint without replaying a side-effecting tool call', async () => {})
it('removes the current profile local Session replica only after logout sync acknowledgement', async () => {})
```
- [ ] **Step 2: Run the session-sync test to verify it fails**

Run: `pnpm exec vitest run packages/experimental/enterprise-desktop/tests/session-sync.spec.ts`

Expected: FAIL because the cloud-backed persistence does not exist.

- [ ] **Step 3: Implement the cloud-backed persistence adapter**

Delegate reads and local durability to the existing JSONL backend. On create or write-open, acquire a cloud lease before returning a write handle. Buffer batches in sequence order; coalesce retries under one idempotency key; stop accepting more than the configured unacknowledged limit.

- [ ] **Step 4: Implement the pre-step and pre-tool lease barriers**

Renew at 50% of lease life. If renewal fails with `lease_lost`, `unauthorized`, or revoked device, mark the persistence unhealthy and throw a localized typed failure from both hooks. Do not replay a side-effecting tool call.

- [ ] **Step 5: Wire the adapter into Desktop Host activation**

Replace the local persistence service only for the enterprise profile. On Host restart, open the last durable local checkpoint, acquire the cloud lease, and resume without replaying a completed tool call. On shutdown or logout, drain acknowledged batches, release the lease, close local handles, remove the identity-owned local Session replica only after the cloud acknowledgement, and clear the in-memory cloud client. A failed drain keeps the error visible and prevents a clean-logout claim.

- [ ] **Step 6: Run the session-sync tests to verify they pass**

Run: `pnpm exec vitest run packages/experimental/enterprise-desktop/tests/session-sync.spec.ts packages/experimental/enterprise-desktop/tests/lease-guard.spec.ts apps/desktop-host/tests/enterprise-bootstrap.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/experimental/enterprise-desktop/src/host/session-sync.ts packages/experimental/enterprise-desktop/src/host/lease-guard.ts packages/experimental/enterprise-desktop/tests/session-sync.spec.ts packages/experimental/enterprise-desktop/tests/lease-guard.spec.ts packages/experimental/enterprise-desktop/src/host/index.ts apps/desktop-host/src/index.ts
git commit -m "feat(desktop): synchronize sessions with write leases"
```

### Task 4: Register the Read-Only Enterprise Viewer Policy

**Files:**
- Create: `packages/experimental/enterprise-desktop/src/host/viewer-principal.ts`
- Create: `packages/experimental/enterprise-desktop/src/host/viewer-policy.ts`
- Create: `packages/experimental/enterprise-desktop/tests/viewer-policy.spec.ts`
- Modify: `packages/experimental/enterprise-desktop/src/host/index.ts`

**Interfaces:**
- Consumes: `PrincipalMap`, `RemoteAccessPolicy`, `RemoteAccessRole`, `ctx.remoteAccess.registerPolicy()`, and Session team/visibility metadata.
- Produces:
  ```ts
  export interface EnterpriseViewerPrincipal {
    readonly kind: 'enterprise-viewer'
    readonly userId: string
    readonly teamId: string
    readonly sessionId: string
    readonly visibility: 'team'
  }

  export function registerEnterpriseViewerPolicy(
    ctx: Context,
    visible: (principal: EnterpriseViewerPrincipal) => boolean,
  ): () => void
  ```
- Global allowlist: `commands/list`, `llm/listConfigurableProviders`, `llm/listProviders`, `session/canOpenWorkspacePath`, `session/control`, `session/list`, `session/modelCatalog`, `session/projections`, `workspace/follow`.
- Session allowlist: `commands/list`, `goals/get`, `session/attachment`, `session/control`, `session/events`, `session/follow`, `session/observeEvent`, `session/observeProjections`, `session/observeState`, `session/page`, `session/projections`, `session/state`, `session/wait`, `skills/list`, `toolResults/watch`, `workspace/follow`, and read-only Session events.
- Explicitly absent and therefore denied: `session/prompt`, `session/cancel`, `session/fork`, `session/rename`, `session/updateQueue`, approvals, tool mutation, file upload, attachment upload, and every unlisted write.

- [ ] **Step 1: Write the failing viewer-policy tests**

Add and assert:
```ts
it('allows the complete Session read and follow surface', () => {})
it('denies prompt, cancel, fork, rename, and queue updates', () => {})
it('denies approvals and tool control endpoints', () => {})
it('denies an unlisted endpoint even when the client hides no UI', () => {})
it('denies another team or private session principal', () => {})
```
- [ ] **Step 2: Run the viewer-policy test to verify it fails**

Run: `pnpm exec vitest run packages/experimental/enterprise-desktop/tests/viewer-policy.spec.ts`

Expected: FAIL because `enterprise-viewer` is not in `PrincipalMap` and no policy is registered.

- [ ] **Step 3: Add the principal and exact read roles**

Merge `'enterprise-viewer'` into `PrincipalMap`. Build the role action list from the exact arrays above. Keep list filtering through `allows()` so the viewer sees only Sessions whose team matches and visibility is `team`.

- [ ] **Step 4: Implement the visibility condition and explainer**

`bindings()` returns no binding when the Session is not team-visible or not in the viewer's team. `explain()` returns `enterprise-session-not-shared` for invisible Sessions and `enterprise-read-only` for known write actions.

- [ ] **Step 5: Register and dispose the policy**

Call `ctx.remoteAccess.registerPolicy('enterprise-viewer', policy)` inside `ctx.effect()`. A missing visibility source fails closed with no bindings rather than granting read access.

- [ ] **Step 6: Run the viewer-policy tests to verify they pass**

Run: `pnpm exec vitest run packages/experimental/enterprise-desktop/tests/viewer-policy.spec.ts packages/api/remote-access/tests/remote-access.host.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/experimental/enterprise-desktop/src/host/viewer-principal.ts packages/experimental/enterprise-desktop/src/host/viewer-policy.ts packages/experimental/enterprise-desktop/tests/viewer-policy.spec.ts packages/experimental/enterprise-desktop/src/host/index.ts
git commit -m "feat(desktop): add read-only enterprise session viewers"
```

### Task 5: Add the Shared Session Browser and Read-Only Transcript

**Files:**
- Create: `packages/experimental/enterprise-desktop/src/client/shared-sessions.tsx`
- Create: `packages/experimental/enterprise-desktop/src/client/shared-session-locales.ts`
- Create: `packages/experimental/enterprise-desktop/tests/shared-sessions.client.spec.tsx`
- Modify: `packages/experimental/enterprise-desktop/src/client/index.ts`
- Modify: `packages/experimental/enterprise-desktop/package.json`

**Interfaces:**
- Consumes: Task 2 list/read/follow APIs and the existing client Session rendering primitives.
- Produces:
  ```ts
  export interface SharedSessionSummary {
    readonly id: string
    readonly title: string
    readonly ownerName: string
    readonly updatedAt: string
    readonly revision: string
  }

  export interface SharedSessionViewProps {
    readonly session: SharedSessionSummary
    readonly events: readonly SessionEvent[]
    readonly complete: boolean
  }
  ```
- The panel exposes list, loading skeleton, empty state, and a read-only transcript. It has no composer, stop, approval, rename, fork, or tool controls.

- [ ] **Step 1: Write the failing shared-session UI tests**

Add and assert:
```ts
it('lists only team-visible sessions from the current team', async () => {})
it('renders the owner live transcript and completed events in order', async () => {})
it('contains no composer, stop, approval, or tool controls', async () => {})
it('shows a compact retry state when the live stream disconnects', async () => {})
it('does not reuse another identity local replica after an account switch', async () => {})
```
- [ ] **Step 2: Run the shared-session UI test to verify it fails**

Run: `pnpm exec vitest run packages/experimental/enterprise-desktop/tests/shared-sessions.client.spec.tsx`

Expected: FAIL because the shared-session browser does not exist.

- [ ] **Step 3: Implement list and transcript loading**

Fetch the same-origin Desktop Session API, poll or subscribe to SSE, deduplicate by sequence, and keep the last acknowledged cloud prefix. Do not read the owner's local files or another profile's Session store.

- [ ] **Step 4: Render a strictly read-only surface**

Reuse Session rendering primitives for messages and tool results, but mount no input or mutation controls. Hide Session management actions and show a concise `团队只读` label.

- [ ] **Step 5: Add localized copy and accessibility**

Provide all supported locale dictionaries, labels for live/complete states, keyboard-selectable list rows, and a status announcement when live events arrive. Use `t` for every product string.

- [ ] **Step 6: Run the shared-session tests to verify they pass**

Run: `pnpm exec vitest run packages/experimental/enterprise-desktop/tests/shared-sessions.client.spec.tsx packages/experimental/enterprise-desktop/tests/viewer-policy.spec.ts`

Expected: PASS.

- [ ] **Step 7: Run the focused type check**

Run: `pnpm run typecheck`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/experimental/enterprise-desktop/src/client/shared-sessions.tsx packages/experimental/enterprise-desktop/src/client/shared-session-locales.ts packages/experimental/enterprise-desktop/src/client/index.ts packages/experimental/enterprise-desktop/tests/shared-sessions.client.spec.tsx packages/experimental/enterprise-desktop/package.json
git commit -m "feat(desktop): browse team sessions read-only"
```
