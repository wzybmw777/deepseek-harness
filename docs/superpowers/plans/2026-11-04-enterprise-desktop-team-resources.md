# Enterprise Desktop Team Resources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Desktop task discover team files, knowledge, and skills in the cloud, fetch only the selected item, materialize it in an owner-only task directory, and delete it when the task ends.

**Architecture:** The console exposes catalog summaries and exact item reads behind the Desktop bearer identity. The Host materializes requested items into a private directory keyed by profile and Session, registers fetched skills for the current task scope, and installs cleanup for completion, cancellation, logout, Host restart, and timeout.

**Tech Stack:** Node filesystem and streams, Cordis tools/skills/effects, SQLite-backed enterprise resources, React, Vitest.

**Spec:** docs/superpowers/specs/2026-11-04-enterprise-desktop-design.md

## Global Constraints

- Team files, knowledge, and skills are never persistently cached on the user's computer.
- Catalog discovery returns summaries only; full article bodies and large files are fetched only when selected.
- Materialized resources live under one task-scoped directory with owner-only permissions.
- Resource roots are scoped by server, user, team, and Session; no path may escape that root.
- Team resources are read-only in the Desktop client; edits stay in the enterprise console.
- A failed fetch fails the requesting tool or skill; it never falls back to stale local content.
- Cleanup runs on task completion, cancellation, logout, Host restart, and a bounded timeout.
- Resource access is re-authorized on every request; the local catalog is not authority.
- Tool and skill failures contain localized, actionable diagnostics without file contents or credentials.
- Each task runs its named tests before and after implementation; do not commit a red test.

## Review Focus

- A resource fetch failing after a previous successful read must fail the current tool call rather than reuse a stale file; the materializer test replaces a cached temp file and expects `resource_unavailable`.
- Every cleanup trigger must remove the task directory exactly once; the lifecycle test covers turn end, cancel, logout, Host restart, and timeout.
- A path, skill name, or knowledge id from one team or account must not resolve through another scope; the authorization test mutates each identifier component.
- A materialized file or directory readable by another operating-system user violates the credential boundary; the permissions test checks `0700` directories and `0600` files on POSIX and DACL/owner checks on Windows.
- Listing resources must not download knowledge bodies, skill bodies, or large files; the catalog test records zero content reads before an explicit selection.

---

### Task 1: Expose Desktop Resource Catalogs and Exact Reads

**Files:**
- Create: `packages/experimental/enterprise-console/src/desktop-resources.ts`
- Create: `packages/experimental/enterprise-console/tests/desktop-resources.spec.ts`
- Modify: `packages/experimental/enterprise-console/src/api.ts`
- Modify: `packages/experimental/enterprise-console/src/team-resources.ts`

**Interfaces:**
- Consumes: `TeamResources.listFiles/readTextFile/openDownload/listSkills/readSkill/listKnowledge/readKnowledge`, bearer `EnterpriseRequestSession`, and the identity plan's fixed bearer validation.
- Produces:
  ```ts
  export type DesktopResourceKind = 'file' | 'skill' | 'knowledge'

  export interface DesktopResourceVersion {
    readonly value: string
  }

  export interface DesktopFileSummary {
    readonly kind: 'file'
    readonly name: string
    readonly path: string
    readonly entryType: 'file' | 'directory'
    readonly size: number
    readonly modifiedAt: string
    readonly version: DesktopResourceVersion
  }

  export interface DesktopSkillSummary {
    readonly kind: 'skill'
    readonly name: string
    readonly description: string
    readonly whenToUse?: string
    readonly managedBy: 'user' | 'knowledge'
    readonly version: DesktopResourceVersion
  }

  export interface DesktopKnowledgeSummary {
    readonly kind: 'knowledge'
    readonly id: string
    readonly title: string
    readonly summary: string
    readonly tags: readonly string[]
    readonly version: DesktopResourceVersion
  }

  export interface DesktopResourceCatalog {
    readonly catalogVersion: DesktopResourceVersion
    readonly fetchedAt: string
    readonly files: readonly DesktopFileSummary[]
    readonly skills: readonly DesktopSkillSummary[]
    readonly knowledge: readonly DesktopKnowledgeSummary[]
  }

  export class DesktopResources {
    catalog(session: EnterpriseRequestSession): Promise<DesktopResourceCatalog>
    readFile(session: EnterpriseRequestSession, path: string): Promise<{ readonly name: string; readonly contentType: string; readonly version: DesktopResourceVersion; readonly body: Readable }>
    readSkill(session: EnterpriseRequestSession, name: string): Promise<DesktopSkillSummary & { readonly instructions: string }>
    readKnowledge(session: EnterpriseRequestSession, id: string): Promise<DesktopKnowledgeSummary & { readonly body: string }>
  }
  ```
- Routes:
  - `GET /enterprise/api/desktop/resources`
  - `GET /enterprise/api/desktop/resources/files/content?path=<encoded-path>`
  - `GET /enterprise/api/desktop/resources/skills/{name}`
  - `GET /enterprise/api/desktop/resources/knowledge/{id}`
- Every content route requires `If-None-Match`-compatible version support through `ETag`, but the Desktop Host may omit it; a mismatched optional `version` query returns `409 resource_version_changed`.

- [ ] **Step 1: Write the failing resource API tests**

Add and assert:
```ts
it('lists summaries without reading knowledge bodies or skill bodies', async () => {})
it('reads one file stream and one text file for the authenticated team', async () => {})
it('returns resource_version_changed when the requested version is stale', async () => {})
it('rejects traversal, absolute paths, and unknown skill or knowledge ids', async () => {})
it('re-authorizes after a team suspension without serving a cached catalog', async () => {})
```
- [ ] **Step 2: Run the resource API test to verify it fails**

Run: `pnpm exec vitest run packages/experimental/enterprise-console/tests/desktop-resources.spec.ts`

Expected: FAIL because the Desktop resource routes do not exist.

- [ ] **Step 3: Add deterministic resource versions**

Use a SHA-256 over stable resource metadata and content for skills and knowledge; for files use path, size, modification time, and a content hash streamed at read time. Return quoted ETag values and never expose the underlying filesystem root.

- [ ] **Step 4: Implement the catalog and exact-read routes**

Resolve the team only from the bearer session. Call existing `TeamResources` methods with that team id; do not accept a `teamId` query or body. Stream files without buffering the whole body. Reject a symlink or non-regular file according to the existing resource guard.

- [ ] **Step 5: Audit metadata only**

Record resource kind, logical id/path, version, and byte count. Do not record file contents, skill instructions, knowledge body, or absolute local paths.

- [ ] **Step 6: Run the resource API tests to verify they pass**

Run: `pnpm exec vitest run packages/experimental/enterprise-console/tests/desktop-resources.spec.ts packages/experimental/enterprise-console/tests/team-resources.spec.ts packages/experimental/enterprise-console/tests/api.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/experimental/enterprise-console/src/desktop-resources.ts packages/experimental/enterprise-console/tests/desktop-resources.spec.ts packages/experimental/enterprise-console/src/api.ts packages/experimental/enterprise-console/src/team-resources.ts
git commit -m "feat(enterprise): expose on-demand desktop resources"
```

### Task 2: Materialize Resources in Private Task Directories

**Files:**
- Create: `packages/experimental/enterprise-desktop/src/host/resource-client.ts`
- Create: `packages/experimental/enterprise-desktop/src/host/resource-materializer.ts`
- Create: `packages/experimental/enterprise-desktop/tests/resource-client.spec.ts`
- Create: `packages/experimental/enterprise-desktop/tests/resource-materializer.spec.ts`
- Modify: `packages/experimental/enterprise-desktop/src/host/cloud-transport.ts`
- Modify: `packages/experimental/enterprise-desktop/src/host/index.ts`

**Interfaces:**
- Consumes: Task 1 routes and `EnterpriseCloudTransport`.
- Produces:
  ```ts
  export interface TaskResourceScope {
    readonly id: string
    readonly profileKey: string
    readonly teamId: string
    readonly sessionId: string
    readonly directory: string
  }

  export interface MaterializedResource {
    readonly kind: DesktopResourceKind
    readonly logicalId: string
    readonly version: string
    readonly path: string
    readonly bytes: number
  }

  export class EnterpriseResourceClient {
    catalog(): Promise<DesktopResourceCatalog>
    readFile(scope: TaskResourceScope, path: string, signal?: AbortSignal): Promise<Readable>
    readSkill(scope: TaskResourceScope, name: string): Promise<DesktopSkillSummary & { readonly instructions: string }>
    readKnowledge(scope: TaskResourceScope, id: string): Promise<DesktopKnowledgeSummary & { readonly body: string }>
  }

  export class TaskResourceMaterializer {
    constructor(input: { readonly root: string; readonly timeoutMs: number; readonly client: EnterpriseResourceClient })
    begin(input: { readonly profileKey: string; readonly teamId: string; readonly sessionId: string }): Promise<TaskResourceScope>
    materialize(scope: TaskResourceScope, request: { readonly kind: DesktopResourceKind; readonly id: string }): Promise<MaterializedResource>
    dispose(scope: TaskResourceScope, reason: 'completed' | 'cancelled' | 'logout' | 'restart' | 'timeout'): Promise<void>
    disposeAll(): Promise<void>
  }
  ```
- Root: `os.tmpdir()/dsh-enterprise-<hash(profileKey)>-<random>` with `0700`; each scope directory is `0700`; files are written with `0600` and `'wx'` inside a validated scope.
- The materializer refuses symlinks, hard-link targets outside the scope, `..`, absolute user ids, and any path whose resolved parent is outside the scope.
- Default timeout: 30 minutes of task inactivity, refreshed only by resource access or Session events for that task.

- [ ] **Step 1: Write the failing materializer tests**

Add and assert:
```ts
it('creates owner-only scope directories and files', async () => {})
it('materializes the same resource once per session version', async () => {})
it('refuses a path that escapes the scope through a symlink', async () => {})
it('deletes a task directory on completed, cancelled, logout, restart, and timeout', async () => {})
it('fails the current read instead of serving a stale local file', async () => {})
```
- [ ] **Step 2: Run the materializer test to verify it fails**

Run: `pnpm exec vitest run packages/experimental/enterprise-desktop/tests/resource-client.spec.ts packages/experimental/enterprise-desktop/tests/resource-materializer.spec.ts`

Expected: FAIL because the resource client and materializer do not exist.

- [ ] **Step 3: Implement fetch-before-write behavior**

For every explicit materialization request, call the cloud route first. Write to a new temporary file inside the scope, `fsync`, chmod to `0600`, and rename into place. A failed fetch removes the temporary file and rejects; it never returns an older materialized file.

- [ ] **Step 4: Implement startup residue cleanup**

On Host start, remove only directories owned by the current profile key whose owner marker matches this operating-system account and whose manifest says they belong to a previous run. Never sweep another profile key.

- [ ] **Step 5: Add the simulation clock for timeout tests**

Inject `now()` and `setTimer()` into the materializer. The default timeout is 30 minutes; tests advance time deterministically and assert exactly one disposal.

- [ ] **Step 6: Run the materializer tests to verify they pass**

Run: `pnpm exec vitest run packages/experimental/enterprise-desktop/tests/resource-client.spec.ts packages/experimental/enterprise-desktop/tests/resource-materializer.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/experimental/enterprise-desktop/src/host/resource-client.ts packages/experimental/enterprise-desktop/src/host/resource-materializer.ts packages/experimental/enterprise-desktop/tests/resource-client.spec.ts packages/experimental/enterprise-desktop/tests/resource-materializer.spec.ts packages/experimental/enterprise-desktop/src/host/cloud-transport.ts packages/experimental/enterprise-desktop/src/host/index.ts
git commit -m "feat(desktop): materialize team resources per task"
```

### Task 3: Add On-Demand Resource and Skill Tools

**Files:**
- Create: `packages/experimental/enterprise-desktop/src/host/resource-tools.ts`
- Create: `packages/experimental/enterprise-desktop/src/host/runtime-skills.ts`
- Create: `packages/experimental/enterprise-desktop/tests/resource-tools.spec.ts`
- Create: `packages/experimental/enterprise-desktop/tests/runtime-skills.spec.ts`
- Modify: `packages/experimental/enterprise-desktop/src/host/index.ts`
- Modify: `packages/experimental/enterprise-desktop/package.json`

**Interfaces:**
- Consumes: `defineTool()` from `@deepseek-ai/dsh-tools`, `ctx.skills.register()`, `TaskResourceMaterializer`, and current Session/Agent scope identity.
- Produces:
  ```ts
  export const TEAM_RESOURCE_TOOL = 'team_resource_read'

  export interface TeamResourceToolInput {
    readonly kind: DesktopResourceKind
    readonly id: string
  }

  export function installTeamResourceTool(ctx: Context, materializer: TaskResourceMaterializer): () => void

  export interface RuntimeSkillSource {
    list(): Promise<readonly DesktopSkillSummary[]>
    load(name: string): Promise<DesktopSkillSummary & { readonly instructions: string }>
  }

  export function installRuntimeSkillSource(ctx: Context, materializer: TaskResourceMaterializer, source: RuntimeSkillSource): () => void
  ```
- The model-facing tool name is `team_resource_read`; its result contains a safe materialized path, kind, logical id, version, and byte count. File contents use existing file tools after materialization.
- The plan-facing skill catalog exposes only summaries. Loading `team-knowledge` or another selected team skill fetches the body and registers it in the current Agent scope.

- [ ] **Step 1: Write the failing resource-tool tests**

Add and assert:
```ts
it('materializes a selected file and returns its owner-only path', async () => {})
it('fails the tool when the cloud fetch fails and does not return stale content', async () => {})
it('rejects a team or session that does not match the active scope', async () => {})
it('does not download a knowledge body before the model selects it', async () => {})
it('loads team-knowledge as read-only instructions for the active agent', async () => {})
```
- [ ] **Step 2: Run the resource-tool test to verify it fails**

Run: `pnpm exec vitest run packages/experimental/enterprise-desktop/tests/resource-tools.spec.ts packages/experimental/enterprise-desktop/tests/runtime-skills.spec.ts`

Expected: FAIL because the tools and runtime skill source do not exist.

- [ ] **Step 3: Register the tool with a typed schema and cancellation**

Define strict arguments for `{ kind, id }`, cap id/path length, pass the tool signal through to the cloud request, and return a structured failure that identifies the unreachable resource without exposing local paths outside the scope.

- [ ] **Step 4: Register fetched skills in the active scope**

Use `ctx.skills.register({ name, description, whenToUse, content: instructions, provider: 'enterprise-team', resourceBase: { kind: 'directory', path: scope.directory } })`. Return and invoke the disposer from `ctx.effect()`; dispose the skill registration and task directory together.

- [ ] **Step 5: Prevent duplicate registrations and stale versions**

Keep one registration per `(sessionId, skillName, version)`. Replacing a version disposes the old registration before registering the new one. A failed replacement leaves no skill registered.

- [ ] **Step 6: Run the resource-tool tests to verify they pass**

Run: `pnpm exec vitest run packages/experimental/enterprise-desktop/tests/resource-tools.spec.ts packages/experimental/enterprise-desktop/tests/runtime-skills.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/experimental/enterprise-desktop/src/host/resource-tools.ts packages/experimental/enterprise-desktop/src/host/runtime-skills.ts packages/experimental/enterprise-desktop/tests/resource-tools.spec.ts packages/experimental/enterprise-desktop/tests/runtime-skills.spec.ts packages/experimental/enterprise-desktop/src/host/index.ts packages/experimental/enterprise-desktop/package.json
git commit -m "feat(desktop): load team resources on demand"
```

### Task 4: Tie Resource Cleanup to Every Task Exit

**Files:**
- Create: `packages/experimental/enterprise-desktop/src/host/resource-cleanup.ts`
- Create: `packages/experimental/enterprise-desktop/tests/resource-cleanup.spec.ts`
- Modify: `packages/experimental/enterprise-desktop/src/host/index.ts`
- Modify: `packages/experimental/enterprise-desktop/src/host/resource-materializer.ts`
- Modify: `apps/desktop/src/enterprise-lifecycle.ts`

**Interfaces:**
- Consumes: `TaskResourceMaterializer`, `turn/end`, Session disposal events, Agent cancellation, `EnterpriseLifecycle.register()`, and Host shutdown.
- Produces:
  ```ts
  export interface TaskResourceOwner {
    readonly sessionId: SessionId
    readonly agentId: string
  }

  export function installTaskResourceCleanup(
    ctx: Context,
    materializer: TaskResourceMaterializer,
    registerLogoutCleanup: (cleanup: { stop(): Promise<void> }) => () => void,
  ): () => void
  ```
- Completion cleanup runs after the turn-end event is durable and before the task is reported idle.
- Cancellation, Session disposal, logout, and Host shutdown run the same idempotent disposal path.
- Startup cleanup removes residue from prior runs for the current profile only.

- [ ] **Step 1: Write the failing cleanup tests**

Add and assert:
```ts
it('removes the task directory after a durable turn end', async () => {})
it('removes the task directory after cancellation before the next turn', async () => {})
it('removes all current-profile task directories on logout', async () => {})
it('removes current-profile residue on Host restart', async () => {})
it('removes an idle task directory after the bounded timeout', async () => {})
it('never removes another profile or team directory', async () => {})
```
- [ ] **Step 2: Run the cleanup test to verify it fails**

Run: `pnpm exec vitest run packages/experimental/enterprise-desktop/tests/resource-cleanup.spec.ts`

Expected: FAIL because task cleanup is not wired.

- [ ] **Step 3: Implement one idempotent disposal path**

`dispose()` marks the scope closing, aborts in-flight reads, closes file handles, removes the directory recursively without following symlinks, and records completion. Repeated triggers return the same promise.

- [ ] **Step 4: Wire durable turn end and cancellation**

Clean only after `turn/end` is acknowledged by Session persistence. A cancellation removes the directory even when no turn-end event follows; it does not wait for the agent to become reusable.

- [ ] **Step 5: Register logout and Host shutdown cleanup**

Add the materializer cleanup to `EnterpriseLifecycle.register()`. On Host shutdown, dispose every open scope before releasing the Session lease and before the desktop process reports shutdown complete.

- [ ] **Step 6: Run the cleanup tests to verify they pass**

Run: `pnpm exec vitest run packages/experimental/enterprise-desktop/tests/resource-cleanup.spec.ts apps/desktop/tests/enterprise-lifecycle.spec.ts apps/desktop-host/tests/enterprise-bootstrap.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/experimental/enterprise-desktop/src/host/resource-cleanup.ts packages/experimental/enterprise-desktop/tests/resource-cleanup.spec.ts packages/experimental/enterprise-desktop/src/host/index.ts packages/experimental/enterprise-desktop/src/host/resource-materializer.ts apps/desktop/src/enterprise-lifecycle.ts
git commit -m "feat(desktop): clean team resources on task exit"
```

### Task 5: Add Read-Only Team Resource Panels

**Files:**
- Create: `packages/experimental/enterprise-desktop/src/client/resources.tsx`
- Create: `packages/experimental/enterprise-desktop/src/client/resource-locales.ts`
- Create: `packages/experimental/enterprise-desktop/tests/resources.client.spec.tsx`
- Modify: `packages/experimental/enterprise-desktop/src/client/index.ts`
- Modify: `packages/experimental/enterprise-desktop/package.json`

**Interfaces:**
- Consumes: Task 1 catalog/read routes through the same-origin cloud transport, existing layout slots, locale dictionaries, and file/knowledge/skill presentation primitives where they are read-only.
- Produces:
  ```ts
  export const ENTERPRISE_RESOURCE_PANELS = {
    files: 'enterprise-files',
    knowledge: 'enterprise-knowledge',
    skills: 'enterprise-skills',
  } as const

  export function registerEnterpriseResourcePanels(ctx: Context): () => void
  ```
- Panels list summaries, filter locally, and show a selected item preview. They contain no create, edit, delete, upload, move, or rename controls.
- Loading uses skeletons; empty and error states are concise. A body is fetched only after selection.

- [ ] **Step 1: Write the failing resource-panel tests**

Add and assert:
```ts
it('registers files, knowledge, and skills panels with one consistent toolbar', () => {})
it('lists summaries without fetching any body', async () => {})
it('fetches one knowledge body only after selection', async () => {})
it('renders no write controls for a member with no resource permission', async () => {})
it('shows a retry action without stale content after a failed fetch', async () => {})
```
- [ ] **Step 2: Run the resource-panel test to verify it fails**

Run: `pnpm exec vitest run packages/experimental/enterprise-desktop/tests/resources.client.spec.tsx`

Expected: FAIL because the panels are not registered.

- [ ] **Step 3: Implement the shared catalog shell**

Use one toolbar, search field, loading skeleton, and empty/error primitive across all three panels. Keep panel-specific row content minimal. Do not render instructional paragraphs.

- [ ] **Step 4: Implement file, knowledge, and skill previews**

Files show name, size, modification time, and a text or download preview. Knowledge shows title, summary, tags, and body after selection. Skills show description, when-to-use, and instructions after selection.

- [ ] **Step 5: Add localized copy and dispose subscriptions**

Register every locale dictionary with the existing locale service. Dispose fetch controllers and slot registrations with `ctx.effect()`; ignore late responses after panel disposal.

- [ ] **Step 6: Run the resource-panel tests to verify they pass**

Run: `pnpm exec vitest run packages/experimental/enterprise-desktop/tests/resources.client.spec.tsx`

Expected: PASS.

- [ ] **Step 7: Run the focused type check**

Run: `pnpm run typecheck`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/experimental/enterprise-desktop/src/client/resources.tsx packages/experimental/enterprise-desktop/src/client/resource-locales.ts packages/experimental/enterprise-desktop/tests/resources.client.spec.tsx packages/experimental/enterprise-desktop/src/client/index.ts packages/experimental/enterprise-desktop/package.json
git commit -m "feat(desktop): browse team resources read-only"
```
