# Enterprise Desktop Model Gateway and Quota Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every Desktop model request through the enterprise gateway, meter exact provider usage server-side, enforce team Token quota at request start, and show the member's current allowance in the workbench.

**Architecture:** The Host exposes the enterprise model route and a same-origin cloud transport; the transport attaches the short-lived bearer token and forwards only Desktop API paths. The console gateway checks identity, team, plan, quota, model, and channel state before streaming to the upstream provider, records usage by request identity, and refuses the next request when the balance is exhausted.

**Tech Stack:** Node HTTP streaming, pi-ai adapter, TypeScript, SQLite (`node:sqlite`), Cordis, React, Vitest.

**Spec:** docs/superpowers/specs/2026-11-04-enterprise-desktop-design.md

## Global Constraints

- All Desktop model requests pass through the enterprise gateway; no Desktop path may call a provider directly.
- Channel API keys and upstream credentials never reach the Desktop client.
- Quota is enforced at team level at request start; an already-started stream is not truncated.
- Input and output tokens come from the final provider usage, not client estimates.
- Retries are deduplicated by client-generated request identity.
- The gateway preserves Chat Completions, Responses, Anthropic Messages, streaming, tool calls, reasoning fields, images, cancellation, and provider errors.
- Request ID and Session ID travel as `x-dsh-request-id` and `x-dsh-session-id`; authentication uses `Authorization: Bearer <token>`.
- Every gateway, model-catalog, and billing request re-authorizes the device, user, team, and current session version.
- The Desktop UI shows the current user's Token usage and the team's remaining allowance without exposing channel data.
- Each task runs its named tests before and after implementation; do not commit a red test.

## Review Focus

- A stream that crosses the remaining quota must complete normally, and the next request must fail with `402 quota_exhausted`; the gateway streaming test asserts both halves.
- A missing or malformed `x-dsh-request-id` must be rejected rather than silently creating a second metered attempt; the request-identity test covers absent, oversized, and reused identities.
- Gateway connection loss must surface a typed failure without falling back to a direct provider; the Host transport test drops the cloud connection and asserts that no second route is invoked.
- Client disconnect or explicit cancellation must abort upstream work and must not create a duplicate usage row; the cancellation test observes the upstream abort signal and the attempt ledger.
- A successful upstream response with missing or malformed usage must not be recorded as a free request; the usage-parser test records the attempt as `usage_missing`, reports it for reconciliation, and denies further unmetered streams when policy requires exact usage.

---

### Task 1: Add Request Identity to the LLM Call Contract

**Files:**
- Modify: `packages/llm/llm/src/brand.ts`
- Modify: `packages/llm/llm/src/types.ts`
- Modify: `packages/llm/llm/src/index.ts`
- Modify: `packages/llm/llm-pi-ai/src/types.ts`
- Modify: `packages/llm/llm-pi-ai/src/adapter.ts`
- Test: `packages/llm/llm/tests/brand.spec.ts`
- Test: `packages/llm/llm-pi-ai/tests/request-headers.spec.ts`

**Interfaces:**
- Consumes: `Branded`, `GenerateOptions`, and `PiAiRequestHeaderContext`.
- Produces:
  ```ts
  export type LlmRequestId = Branded<'LlmRequestId'>
  export function LlmRequestId(id: string): LlmRequestId

  export interface GenerateOptions<Purpose extends string = LlmRequestPurpose> {
    // existing fields unchanged
    requestId?: LlmRequestId
  }

  export interface PiAiRequestHeaderContext extends Readonly<Pick<GenerateOptions<string>,
    'provider' | 'model' | 'sessionId' | 'purpose' | 'requestId'>> {
    readonly baseURL: string
  }
  ```
- `GenerateOptions.requestId` is optional for hand-built calls and stamped by the enterprise Host model route before dispatch.

- [ ] **Step 1: Write the failing request-identity tests**

Add to `brand.spec.ts`:
```ts
it('brands a non-empty LLM request identity', () => {})
it('rejects an empty LLM request identity', () => {})
```
Add to `request-headers.spec.ts`:
```ts
it('exposes the exact request identity to header contributors', async () => {})
it('keeps header contexts isolated when request identities overlap', async () => {})
```
Assertions include `LlmRequestId('req-a')` reaching the listener unchanged and no request ID being synthesized by the adapter.

- [ ] **Step 2: Run the request-identity tests to verify they fail**

Run: `pnpm exec vitest run packages/llm/llm/tests/brand.spec.ts packages/llm/llm-pi-ai/tests/request-headers.spec.ts -t 'request identity|LLM request identity'`

Expected: FAIL because `LlmRequestId` and `requestId` do not exist.

- [ ] **Step 3: Add the branded type and propagate it through the header context**

Follow the existing `ProviderRequestId` pattern. Validate non-empty IDs at the constructor boundary. Include `requestId` only when defined so frozen context equality tests remain stable.

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `pnpm exec vitest run packages/llm/llm/tests/brand.spec.ts packages/llm/llm-pi-ai/tests/request-headers.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/llm/llm/src/brand.ts packages/llm/llm/src/types.ts packages/llm/llm/src/index.ts packages/llm/llm-pi-ai/src/types.ts packages/llm/llm-pi-ai/src/adapter.ts packages/llm/llm/tests/brand.spec.ts packages/llm/llm-pi-ai/tests/request-headers.spec.ts
git commit -m "feat(llm): add enterprise request identity"
```

### Task 2: Add Channel Protocols and the Desktop Model Catalog

**Files:**
- Create: `packages/experimental/enterprise-console/src/desktop-models.ts`
- Modify: `packages/experimental/enterprise-console/src/types.ts`
- Modify: `packages/experimental/enterprise-console/src/store.ts`
- Modify: `packages/experimental/enterprise-console/src/api.ts`
- Modify: `packages/experimental/enterprise-console/src/views.ts`
- Test: `packages/experimental/enterprise-console/tests/desktop-models.spec.ts`
- Test: `packages/experimental/enterprise-console/tests/store.spec.ts`
- Test: `packages/experimental/enterprise-console/tests/api.spec.ts`

**Interfaces:**
- Consumes: `ChannelRecord`, `ModelRecord`, `PlanRecord.monthlyCredits`, `UsageRecord`, and Task 1 from the identity plan.
- Produces:
  ```ts
  export type ChannelWireProtocol = 'openai-chat' | 'openai-responses' | 'anthropic-messages'

  export interface ChannelRecord {
    // existing fields unchanged
    wireProtocol: ChannelWireProtocol
  }

  export interface DesktopQuota {
    readonly planName: string
    readonly totalTokens: number
    readonly usedTokens: number
    readonly remainingTokens: number
    readonly userTokens: number
    readonly cycleStartsAt: string
    readonly cycleEndsAt: string
  }

  export interface DesktopModelView {
    readonly id: string
    readonly name: string
    readonly protocol: ChannelWireProtocol
    readonly gatewayBasePath: `/enterprise/api/desktop/gateway/${string}`
    readonly upstreamModelId: string
    readonly contextWindow: number
    readonly capabilities: readonly string[]
  }

  export interface DesktopModelCatalog {
    readonly quota: DesktopQuota
    readonly models: readonly DesktopModelView[]
    readonly refreshedAt: string
  }

  export class DesktopModels {
    catalog(session: EnterpriseRequestSession): DesktopModelCatalog
    resolve(session: EnterpriseRequestSession, modelId: string): {
      readonly model: ModelRecord
      readonly channel: ChannelRecord
      readonly quota: DesktopQuota
    }
  }
  ```
- `GET /enterprise/api/desktop/models` returns only active models whose channel is active and whose model is in the member's current plan.
- Existing channel create/update APIs accept and return `wireProtocol`; invalid values reject with `400 invalid_field`.

- [ ] **Step 1: Write the failing model-catalog tests**

Add and assert:
```ts
it('lists only active Desktop models with an active channel and quota', async () => {})
it('returns the current member and team usage in the catalog quota', async () => {})
it('rejects an unknown wire protocol during channel configuration', async () => {})
it('rejects a disabled model or suspended team before returning a route', async () => {})
```
- [ ] **Step 2: Run the model-catalog tests to verify they fail**

Run: `pnpm exec vitest run packages/experimental/enterprise-console/tests/desktop-models.spec.ts packages/experimental/enterprise-console/tests/api.spec.ts -t 'Desktop model|wire protocol'`

Expected: FAIL because channels have no wire protocol and the catalog route does not exist.

- [ ] **Step 3: Migrate channels to an explicit wire protocol**

Bump `SCHEMA_VERSION` from `7` to `8`; add `wire_protocol TEXT NOT NULL` with a one-time default of `openai-chat` for existing rows. Update channel persistence, projections, and admin validation.

- [ ] **Step 4: Implement the model catalog and quota projection**

Compute the current monthly team cycle from existing billing helpers. `usedTokens` is the sum of input plus output tokens recorded for the team in that cycle. Leave `monthlyCredits` as the total Token allowance. Reject a zero allowance when the member has no purchased quota.

- [ ] **Step 5: Add the bearer model-catalog route**

Require a Desktop bearer session, active team, `workspace.use`, and at least one model. Do not return channel base URLs, credentials, prices, encrypted keys, or upstream headers.

- [ ] **Step 6: Run the model-catalog and store tests to verify they pass**

Run: `pnpm exec vitest run packages/experimental/enterprise-console/tests/desktop-models.spec.ts packages/experimental/enterprise-console/tests/store.spec.ts packages/experimental/enterprise-console/tests/api.spec.ts`

Expected: PASS, including migration from schema 7.

- [ ] **Step 7: Commit**

```bash
git add packages/experimental/enterprise-console/src/desktop-models.ts packages/experimental/enterprise-console/src/types.ts packages/experimental/enterprise-console/src/store.ts packages/experimental/enterprise-console/src/api.ts packages/experimental/enterprise-console/src/views.ts packages/experimental/enterprise-console/tests/desktop-models.spec.ts packages/experimental/enterprise-console/tests/store.spec.ts packages/experimental/enterprise-console/tests/api.spec.ts
git commit -m "feat(enterprise): expose desktop model catalog"
```

### Task 3: Implement the Metered Gateway

**Files:**
- Create: `packages/experimental/enterprise-console/src/desktop-gateway.ts`
- Create: `packages/experimental/enterprise-console/tests/desktop-gateway.spec.ts`
- Modify: `packages/experimental/enterprise-console/src/types.ts`
- Modify: `packages/experimental/enterprise-console/src/store.ts`
- Modify: `packages/experimental/enterprise-console/src/api.ts`
- Modify: `packages/experimental/enterprise-console/src/usage.ts`

**Interfaces:**
- Consumes: Task 2 `DesktopModels.resolve()`, `ChannelRecord.wireProtocol`, and `EnterpriseStore`.
- Produces:
  ```ts
  export type DesktopGatewayStatus = 'started' | 'completed' | 'failed' | 'usage_missing'

  export interface DesktopGatewayAttemptRecord {
    readonly id: string
    readonly requestId: string
    readonly teamId: string
    readonly userId: string
    readonly modelId: string
    readonly channelId: string
    readonly sessionId?: string
    status: DesktopGatewayStatus
    inputTokens: number
    outputTokens: number
    readonly startedAt: string
    finishedAt?: string
  }

  export interface ParsedUsage {
    readonly inputTokens: number
    readonly outputTokens: number
  }

  export function parseProviderUsage(protocol: ChannelWireProtocol, body: string): ParsedUsage | undefined

  export class DesktopModelGateway {
    forward(input: {
      readonly request: IncomingMessage
      readonly response: ServerResponse
      readonly session: EnterpriseRequestSession
      readonly modelId: string
      readonly upstreamPath: string
      readonly requestId: string
      readonly sessionId?: string
    }): Promise<void>
  }
  ```
- Route: `POST /enterprise/api/desktop/gateway/{modelId}/{upstreamPath}`; the upstream path is appended to the channel base URL after allowlisted path validation.
- Required headers: `Authorization: Bearer <accessToken>` and `x-dsh-request-id` (1-128 printable ASCII characters). Optional `x-dsh-session-id` is capped at 200 bytes.
- Quota rejection: HTTP `402` with `{ error: { code: 'quota_exhausted', message: '本月团队 Token 额度已用完' } }`.
- Duplicate request identity: HTTP `409` with `{ error: { code: 'request_replayed' } }` when a terminal attempt already exists; no second upstream request is sent.

- [ ] **Step 1: Write the failing gateway tests**

Add and assert:
```ts
it('forwards a streaming response without changing provider chunks', async () => {})
it('completes a stream that crosses the remaining quota and rejects the next request', async () => {})
it('forwards tool calls, reasoning fields, and images unchanged', async () => {})
it('aborts the upstream request when the client disconnects', async () => {})
it('deduplicates a repeated request identity before upstream dispatch', async () => {})
it('records usage_missing instead of charging zero for malformed usage', async () => {})
it('preserves provider error status and body', async () => {})
```
- [ ] **Step 2: Run the gateway test to verify it fails**

Run: `pnpm exec vitest run packages/experimental/enterprise-console/tests/desktop-gateway.spec.ts`

Expected: FAIL because the gateway does not exist.

- [ ] **Step 3: Add the attempt ledger**

Bump `SCHEMA_VERSION` from `8` to `9`; create `desktop_gateway_attempts` with a unique `request_id` per team, foreign identifiers, status, token counts, and timestamps. Add an atomic `beginAttempt()` that either returns the new row or the existing terminal row.

- [ ] **Step 4: Implement request validation and quota admission**

Reject missing or malformed IDs, unknown models, stale sessions, suspended teams, disabled channels, disabled models, unsupported paths, and non-POST methods before opening the upstream connection. Check `remainingTokens > 0` at request start.

- [ ] **Step 5: Implement streaming forwarding and usage parsing**

Send bytes unchanged while teeing the minimum necessary body or stream events for `parseProviderUsage`. Handle `openai-chat`, `openai-responses`, and `anthropic-messages`. On client abort, abort upstream and finish the attempt as `failed`.

- [ ] **Step 6: Persist usage and audit atomically**

After the provider finishes, write one usage record keyed by the request identity, update the attempt status, and append an audit record with request/model/token counts but no prompt, response, terminal output, or file content.

- [ ] **Step 7: Route the gateway through the console API**

Mount the bearer gateway path before browser-session dispatch. Never call `prepareTenant`, never accept cookie authentication, and never follow upstream redirects.

- [ ] **Step 8: Run the gateway tests to verify they pass**

Run: `pnpm exec vitest run packages/experimental/enterprise-console/tests/desktop-gateway.spec.ts packages/experimental/enterprise-console/tests/api.spec.ts packages/experimental/enterprise-console/tests/store.spec.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/experimental/enterprise-console/src/desktop-gateway.ts packages/experimental/enterprise-console/tests/desktop-gateway.spec.ts packages/experimental/enterprise-console/src/types.ts packages/experimental/enterprise-console/src/store.ts packages/experimental/enterprise-console/src/api.ts packages/experimental/enterprise-console/src/usage.ts
git commit -m "feat(enterprise): meter desktop model gateway"
```

### Task 4: Register the Host Model Route and Fail Closed

**Files:**
- Create: `packages/experimental/enterprise-desktop/src/host/model-route.ts`
- Create: `packages/experimental/enterprise-desktop/src/host/cloud-transport.ts`
- Create: `packages/experimental/enterprise-desktop/tests/model-route.spec.ts`
- Create: `packages/experimental/enterprise-desktop/tests/cloud-transport.spec.ts`
- Modify: `packages/experimental/enterprise-desktop/src/host/index.ts`
- Modify: `packages/experimental/enterprise-desktop/package.json`

**Interfaces:**
- Consumes: Task 1's request identity, Task 2's catalog, Task 3's gateway route, `PiAiAdapter`, `ctx.llm.registerAdapter()`, and `EnterpriseBootstrapPort`.
- Produces:
  ```ts
  export interface EnterpriseModelRoute {
    readonly provider: 'enterprise-gateway'
    readonly models: readonly DesktopModelView[]
    readonly quota: DesktopQuota
  }

  export class EnterpriseCloudTransport {
    request(input: {
      readonly path: string
      readonly method: 'GET' | 'POST'
      readonly headers: Readonly<Record<string, string>>
      readonly body?: Uint8Array
      readonly signal?: AbortSignal
    }): Promise<Response>
  }

  export function installEnterpriseModelRoute(
    ctx: Context,
    transport: EnterpriseCloudTransport,
    catalog: DesktopModelCatalog,
    localGatewayOrigin: string,
  ): () => void
  ```
- Only paths beginning `/enterprise/api/desktop/` are accepted; absolute URLs, redirects, cookies, and other origins are rejected.
- The model route registers only `enterprise-gateway`; no consumer provider route is registered by enterprise startup.

- [ ] **Step 1: Write the failing cloud-transport tests**

Add and assert:
```ts
it('attaches the current access token and request identity', async () => {})
it('replaces an expired token through the bootstrap port before retrying', async () => {})
it('rejects paths outside the Desktop API prefix', async () => {})
it('does not follow upstream redirects', async () => {})
it('surfaces gateway network failure without invoking a direct provider', async () => {})
```
- [ ] **Step 2: Run the cloud-transport test to verify it fails**

Run: `pnpm exec vitest run packages/experimental/enterprise-desktop/tests/cloud-transport.spec.ts`

Expected: FAIL because the transport does not exist.

- [ ] **Step 3: Implement the same-origin cloud transport**

Resolve the cloud base from the bootstrap on every call, attach the current access token, preserve only allowlisted request headers, use `redirect: 'error'`, cap response size where the endpoint is not streaming, and return the original response status and body for typed failures.

- [ ] **Step 4: Write the failing model-route tests**

Add and assert:
```ts
it('registers only the enterprise gateway provider from the catalog', async () => {})
it('stamps the same request identity into headers and the gateway path', async () => {})
it('rejects a catalog with an unsupported protocol', async () => {})
it('returns quota_exhausted without a direct-provider retry', async () => {})
```
- [ ] **Step 5: Run the model-route test to verify it fails**

Run: `pnpm exec vitest run packages/experimental/enterprise-desktop/tests/model-route.spec.ts`

Expected: FAIL because the enterprise model route does not exist.

- [ ] **Step 6: Implement the enterprise pi-ai route**

Build `PiAiProviderProfile`s with each model's protocol, gateway base path, context window, capabilities, and no upstream credential. Use a model-local header contributor that sends `Authorization: enterprise-session`, `x-dsh-request-id`, and `x-dsh-session-id`; the local transport replaces the bearer value with the short-lived enterprise token.

- [ ] **Step 7: Register and dispose the adapter through Cordis effects**

Use `ctx.llm.registerAdapter(['enterprise-gateway'], adapter)` and return its disposer from `ctx.effect()`. A catalog or protocol failure must reject activation before any request is admitted.

- [ ] **Step 8: Run the Host model tests to verify they pass**

Run: `pnpm exec vitest run packages/experimental/enterprise-desktop/tests/cloud-transport.spec.ts packages/experimental/enterprise-desktop/tests/model-route.spec.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/experimental/enterprise-desktop/src/host/model-route.ts packages/experimental/enterprise-desktop/src/host/cloud-transport.ts packages/experimental/enterprise-desktop/src/host/index.ts packages/experimental/enterprise-desktop/package.json packages/experimental/enterprise-desktop/tests/model-route.spec.ts packages/experimental/enterprise-desktop/tests/cloud-transport.spec.ts
git commit -m "feat(desktop): route models through enterprise gateway"
```

### Task 5: Show the Current Quota and Surface Typed Exhaustion

**Files:**
- Create: `packages/experimental/enterprise-desktop/src/client/quota.ts`
- Create: `packages/experimental/enterprise-desktop/src/client/quota-locales.ts`
- Create: `packages/experimental/enterprise-desktop/tests/quota.client.spec.ts`
- Create: `packages/experimental/enterprise-desktop/src/client/index.ts`
- Modify: `packages/experimental/enterprise-desktop/package.json`
- Modify: `packages/experimental/enterprise-desktop/tsdown.config.ts`

**Interfaces:**
- Consumes: `GET /enterprise/api/desktop/billing` through the local cloud transport and the existing client locale/slot services.
- Produces:
  ```ts
  export interface DesktopQuotaState {
    readonly quota: DesktopQuota
    readonly planName: string
    readonly updatedAt: string
  }

  export class DesktopQuotaStore {
    readonly state: { getSnapshot(): DesktopQuotaState | undefined; subscribe(listener: () => void): () => void }
    refresh(): Promise<void>
    noteGatewayError(error: { readonly code?: string }): void
  }
  ```
- Billing endpoint: `GET /enterprise/api/desktop/billing`, bearer-authenticated, returning `{ quota, planName, updatedAt }`.
- UI states: loading (skeleton, no text), available (`本月剩余 12,340 Tokens`), exhausted (`额度已用完` with a purchase link that opens the system browser), unavailable (compact retry action).

- [ ] **Step 1: Write the failing quota-client tests**

Add and assert:
```ts
it('shows the signed-in member usage and team remaining tokens', async () => {})
it('renders a skeleton instead of a textual loading notice', async () => {})
it('turns quota_exhausted into the exhausted state', async () => {})
it('refreshes once after one coalesced gateway error', async () => {})
it('opens the purchase surface through the desktop external-browser bridge', async () => {})
```
- [ ] **Step 2: Run the quota-client test to verify it fails**

Run: `pnpm exec vitest run packages/experimental/enterprise-desktop/tests/quota.client.spec.ts`

Expected: FAIL because the quota store and UI do not exist.

- [ ] **Step 3: Add the bearer billing projection**

Return `DesktopQuota`, plan name, and refresh time from the same usage aggregation used by the Web billing page. Do not return orders or channel prices in this endpoint.

- [ ] **Step 4: Implement the quota store and compact status surface**

Coalesce refreshes, retain the last successful snapshot only for display, and never allow stale data to authorize requests. Subscribe to the gateway's typed error stream; `quota_exhausted` updates the visible state immediately.

- [ ] **Step 5: Add localized copy and register the client plugin**

Add every supported locale through typed dictionaries; use `t` for labels and accessible names. Register the surface through the existing slot/locale services and dispose subscriptions with `ctx.effect()`.

- [ ] **Step 6: Run the quota-client tests to verify they pass**

Run: `pnpm exec vitest run packages/experimental/enterprise-desktop/tests/quota.client.spec.ts`

Expected: PASS.

- [ ] **Step 7: Run the focused type and build checks**

Run: `pnpm run typecheck`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/experimental/enterprise-desktop/src/client/quota.ts packages/experimental/enterprise-desktop/src/client/quota-locales.ts packages/experimental/enterprise-desktop/src/client/index.ts packages/experimental/enterprise-desktop/tests/quota.client.spec.ts packages/experimental/enterprise-desktop/package.json packages/experimental/enterprise-desktop/tsdown.config.ts
git commit -m "feat(desktop): show enterprise token quota"
```
