# Enterprise Desktop Identity and Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an enterprise member sign in with the existing enterprise account, keep the refresh credential in the operating-system credential store, start an isolated local Host, and reach the enterprise workbench without a tenant container.

**Architecture:** Electron main owns enterprise authentication and credential persistence. It sends the local Host only a short-lived access token and cloud bootstrap through the existing child-process IPC channel. Each server and user pair gets a distinct Desktop profile, and logout stops the Host before returning to the welcome flow.

**Tech Stack:** Electron, TypeScript, Node HTTP, SQLite (`node:sqlite`), Cordis, Vitest.

**Spec:** docs/superpowers/specs/2026-11-04-enterprise-desktop-design.md

## Global Constraints

- Windows x64 is the first supported desktop platform; macOS follows after Windows acceptance.
- Existing enterprise email and password accounts are the only first-release sign-in method.
- One user belongs to one team in the first release; the Desktop profile follows that rule.
- The refresh credential never enters renderer memory, URLs, logs, plugin environments, or command-line arguments.
- The Host receives only a short-lived access token, its expiry, the cloud base URL, and the selected identity summary.
- Every server request re-authorizes the user, device, team status, and session version.
- Signing out revokes only the current device, stops the Host, and removes identity-owned local state.
- A cloud outage or expired access token never falls back to a consumer account, API key, or direct provider.
- All product text uses locale dictionaries; all new modules and public exports have concise JSDoc.
- Each task runs its named test before implementation and again after implementation; report only commands actually run.
- Commit after each task with the shown message; do not combine tasks.

## Review Focus

- A renderer or third-party plugin must never read the refresh credential; the welcome bridge contains no refresh-token field and tests serialize the complete bridge payload.
- Switching server or user must not reuse another identity's profile, Session store, or lock; profile-key tests cover normalization and collisions.
- Logout during an active turn must finish Host shutdown and cleanup before the welcome window becomes interactive; the lifecycle test keeps an in-flight stop pending and asserts ordering.
- A revoked device or changed user session version must return to enterprise login instead of refreshing forever; the refresh test advances the user session version and expects a terminal sign-out result.
- A bootstrap network failure must fail closed without starting a direct provider or consumer account; the Host startup test rejects after listeners are attached and asserts that no fallback route was registered.

---

### Task 1: Add Desktop Device Authentication and Bootstrap API

**Files:**
- Create: `packages/experimental/enterprise-console/src/desktop-auth.ts`
- Modify: `packages/experimental/enterprise-console/src/types.ts`
- Modify: `packages/experimental/enterprise-console/src/store.ts`
- Modify: `packages/experimental/enterprise-console/src/api.ts`
- Test: `packages/experimental/enterprise-console/tests/desktop-auth.spec.ts`
- Test: `packages/experimental/enterprise-console/tests/api.spec.ts`
- Test: `packages/experimental/enterprise-console/tests/store.spec.ts`

**Interfaces:**
- Consumes: `EnterpriseStore.snapshot()`, `hashPassword()`, `verifyPassword()`, `permissionsFor()`, `EnterpriseRequestSession`, and the existing user/team records.
- Produces:
  ```ts
  export interface DesktopDeviceRecord {
    readonly id: string
    readonly userId: string
    readonly refreshSecretHash: string
    readonly userSessionVersion: number
    readonly createdAt: string
    lastUsedAt: string
    revokedAt?: string
  }

  export interface DesktopBootstrap {
    readonly apiVersion: 1
    readonly cloudBaseUrl: string
    readonly profileKey: string
    readonly accessExpiresAt: string
    readonly user: { readonly id: string; readonly email: string; readonly name: string; readonly roleId: string }
    readonly team: { readonly id: string; readonly name: string; readonly slug: string }
    readonly minimumClientVersion: string
    readonly policy: {
      readonly consumerAnalytics: false
      readonly crashReports: 'enterprise-support'
      readonly supportEmail: string
    }
    readonly endpoints: {
      readonly bootstrap: '/enterprise/api/desktop/bootstrap'
      readonly models: '/enterprise/api/desktop/models'
      readonly resources: '/enterprise/api/desktop/resources'
      readonly sessions: '/enterprise/api/desktop/sessions'
      readonly plugins: '/enterprise/api/desktop/plugins'
      readonly billing: '/enterprise/api/desktop/billing'
    }
  }

  export interface DesktopAuthGrant {
    readonly accessToken: string
    readonly accessExpiresAt: string
    readonly refreshToken: string
    readonly refreshExpiresAt: string
    readonly bootstrap: DesktopBootstrap
  }

  export class DesktopAuthService {
    login(email: string, password: string, deviceName: string, cloudBaseUrl: string): Promise<DesktopAuthGrant>
    refresh(refreshToken: string): Promise<DesktopAuthGrant>
    logout(refreshToken: string): Promise<void>
    authorizeAccess(token: string): EnterpriseRequestSession
    bootstrap(session: EnterpriseRequestSession, cloudBaseUrl: string): DesktopBootstrap
  }
  ```
- Server routes:
  - `POST /enterprise/api/desktop/auth/login` with `{ email, password, deviceName }`
  - `POST /enterprise/api/desktop/auth/refresh` with `{ refreshToken }`
  - `POST /enterprise/api/desktop/auth/logout` with `{ refreshToken }`
  - `GET /enterprise/api/desktop/bootstrap` with `Authorization: Bearer <accessToken>`
- The access token is a signed, URL-safe opaque value with claims `{ version: 1, userId, deviceId, userSessionVersion, expiresAt }` and a 15-minute lifetime.
- The refresh token is a 256-bit random secret returned once; only its SHA-256 hash is stored. Refresh rotates the secret atomically and invalidates the previous value.

- [ ] **Step 1: Write the failing device-auth tests**

Add these tests to `desktop-auth.spec.ts`:
```ts
it('stores only a refresh-token hash and issues a fifteen-minute access grant', async () => {})
it('rotates the refresh token and rejects the previous token', async () => {})
it('revokes only the named device', async () => {})
it('rejects bootstrap after the user session version changes', async () => {})
it('returns profileKey from server and user identity without exposing either secret', async () => {})
it('seals analytics off and returns the enterprise crash-report support address', async () => {})
```
Assertions: login returns no cookie, `JSON.stringify(store.snapshot())` contains no refresh secret, `refreshExpiresAt - now > 30 days`, and the second refresh with the old token returns `desktop_auth_revoked`.

- [ ] **Step 2: Run the device-auth test to verify it fails**

Run: `pnpm exec vitest run packages/experimental/enterprise-console/tests/desktop-auth.spec.ts`

Expected: FAIL because `desktop-auth.ts` and the device record do not exist.

- [ ] **Step 3: Add the durable device table and schema migration**

Bump `SCHEMA_VERSION` from `6` to `7`; add `desktop_devices` with a unique refresh hash, user id, user session version, timestamps, and nullable revocation time. Preserve the existing migration ladder and reject unsupported future versions.

- [ ] **Step 4: Implement `DesktopAuthService` with the exact interfaces above**

Use the existing password verifier for login, `node:crypto` for random tokens and signatures, constant-time hash comparison, and the store's existing atomic mutation path. Set access lifetime to exactly 15 minutes and refresh lifetime to 30 days.

- [ ] **Step 5: Route bearer bootstrap requests through the service**

Add the four routes before cookie-session dispatch. Require `Authorization: Bearer` for bootstrap, re-read the user and team on every call, reject a disabled user, suspended team, missing team, changed session version, revoked device, or expired access token, and call no `prepareTenant`. Append audit records for device login, refresh, logout, and bootstrap without recording passwords or token values.

- [ ] **Step 6: Add bootstrap authorization tests to `api.spec.ts`**

Add and assert:
```ts
it('serves desktop bootstrap with a bearer token and no tenant preparation', async () => {})
it('rejects desktop bootstrap for a suspended team', async () => {})
it('never accepts the browser session cookie as a desktop bearer token', async () => {})
it('records sign-in and bootstrap audit events without credentials', async () => {})
```

- [ ] **Step 7: Run the focused console tests to verify they pass**

Run: `pnpm exec vitest run packages/experimental/enterprise-console/tests/desktop-auth.spec.ts packages/experimental/enterprise-console/tests/api.spec.ts packages/experimental/enterprise-console/tests/store.spec.ts`

Expected: PASS, including the schema migration tests.

- [ ] **Step 8: Commit**

```bash
git add packages/experimental/enterprise-console/src/desktop-auth.ts packages/experimental/enterprise-console/src/types.ts packages/experimental/enterprise-console/src/store.ts packages/experimental/enterprise-console/src/api.ts packages/experimental/enterprise-console/tests/desktop-auth.spec.ts packages/experimental/enterprise-console/tests/api.spec.ts packages/experimental/enterprise-console/tests/store.spec.ts
git commit -m "feat(enterprise): add desktop device authentication"
```

### Task 2: Persist the Refresh Credential in Electron Main

**Files:**
- Create: `apps/desktop/src/enterprise-credentials.ts`
- Create: `apps/desktop/src/enterprise-auth.ts`
- Create: `apps/desktop/tests/enterprise-credentials.spec.ts`
- Create: `apps/desktop/tests/enterprise-auth.spec.ts`
- Modify: `apps/desktop/package.json`

**Interfaces:**
- Consumes: Electron `safeStorage`, `app.getPath('userData')`, and `fetch`; Task 1's desktop auth routes.
- Produces:
  ```ts
  export interface EnterpriseCredentialRecord {
    readonly cloudBaseUrl: string
    readonly userId: string
    readonly email: string
    readonly deviceId: string
    readonly profileKey: string
    readonly refreshToken: string
  }

  export interface EnterpriseAuthSession {
    readonly accessToken: string
    readonly accessExpiresAt: string
    readonly bootstrap: DesktopBootstrap
  }

  export class EnterpriseCredentialStore {
    load(cloudBaseUrl: string): Promise<EnterpriseCredentialRecord | undefined>
    save(record: EnterpriseCredentialRecord): Promise<void>
    clear(cloudBaseUrl: string): Promise<void>
  }

  export class EnterpriseAuthClient {
    login(cloudBaseUrl: string, email: string, password: string, deviceName: string): Promise<EnterpriseAuthSession>
    restore(cloudBaseUrl: string): Promise<EnterpriseAuthSession | undefined>
    refresh(): Promise<EnterpriseAuthSession>
    logout(): Promise<void>
  }
  ```
- Credential filenames use `sha256(normalized origin)` under `userData/enterprise-credentials/`; files are mode `0600` and contain only `safeStorage.encryptString()` output.
- `refresh()` is single-flight and returns a typed `EnterpriseSignOutRequired` result for revoked devices or changed session versions.

- [ ] **Step 1: Write the failing credential-store tests**

Add and assert:
```ts
it('writes only safeStorage ciphertext at mode 0600', async () => {})
it('fails closed when operating-system encryption is unavailable', async () => {})
it('removes only the selected server credential on clear', async () => {})
it('never includes a refresh token in an error message', async () => {})
```
- [ ] **Step 2: Run the credential-store test to verify it fails**

Run: `pnpm exec vitest run apps/desktop/tests/enterprise-credentials.spec.ts`

Expected: FAIL because the credential store does not exist.

- [ ] **Step 3: Implement the credential store against an injected vault**

Define a small vault interface around `encryptString/decryptString` so tests can use a fake. Production uses Electron `safeStorage`; unavailable encryption rejects with `enterprise_credentials_unavailable` and no plaintext fallback.

- [ ] **Step 4: Write the failing auth-client tests**

Add and assert:
```ts
it('coalesces concurrent refreshes into one request', async () => {})
it('requires sign-out when the server revokes the device', async () => {})
it('requires sign-out when the user session version changed', async () => {})
it('drops the stored refresh token after logout succeeds', async () => {})
it('keeps the credential when logout fails because the network is down', async () => {})
```
- [ ] **Step 5: Run the auth-client test to verify it fails**

Run: `pnpm exec vitest run apps/desktop/tests/enterprise-auth.spec.ts`

Expected: FAIL because the auth client does not exist.

- [ ] **Step 6: Implement the auth client and refresh state machine**

Login stores the credential before returning the short-lived session. Restore refreshes immediately. Access expiry schedules one refresh; consecutive transport failures back off with a bounded timer, while `401`, `403`, revoked-device, or session-version errors terminate the session instead of retrying.

- [ ] **Step 7: Run the Electron-main tests to verify they pass**

Run: `pnpm exec vitest run apps/desktop/tests/enterprise-credentials.spec.ts apps/desktop/tests/enterprise-auth.spec.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/enterprise-credentials.ts apps/desktop/src/enterprise-auth.ts apps/desktop/tests/enterprise-credentials.spec.ts apps/desktop/tests/enterprise-auth.spec.ts apps/desktop/package.json
git commit -m "feat(desktop): store enterprise refresh credentials securely"
```

### Task 3: Add Enterprise Mode to the Native Welcome Flow

**Files:**
- Modify: `apps/desktop/src/welcome-api.ts`
- Modify: `apps/desktop/src/preload-welcome.ts`
- Modify: `apps/desktop/src/welcome-window.ts`
- Modify: `apps/desktop/src/welcome-backend.ts`
- Modify: `apps/desktop/src/client/WelcomePage.tsx`
- Modify: `apps/desktop/src/client/welcome.tsx`
- Test: `apps/desktop/tests/welcome-api.spec.ts`
- Test: `apps/desktop/tests/welcome-host.spec.ts`

**Interfaces:**
- Consumes: `EnterpriseAuthClient` from Task 2 and the existing allowlisted welcome IPC pattern.
- Produces:
  ```ts
  export interface EnterpriseWelcomeState {
    readonly serverUrl: string
    readonly email?: string
    readonly teamName?: string
    readonly signedIn: boolean
  }

  export interface EnterpriseWelcomeApi {
    state(): Promise<EnterpriseWelcomeState>
    signIn(input: { readonly email: string; readonly password: string }): Promise<
      { readonly ok: true } | { readonly ok: false; readonly code: 'invalid_credentials' | 'network' | 'server' }>
    signOut(): Promise<void>
  }
  ```
- `preload-welcome.ts` exposes only this interface; it has no refresh token, access token, `ipcRenderer`, or generic invoke method.

- [ ] **Step 1: Write the failing bridge tests**

Add and assert:
```ts
it('exposes no refresh or access token through the welcome bridge', async () => {})
it('passes passwords only as an ephemeral sign-in argument', async () => {})
it('maps invalid credentials to a stable failure code without server text', async () => {})
it('renders enterprise mode instead of API-key onboarding', async () => {})
```
- [ ] **Step 2: Run the welcome tests to verify they fail**

Run: `pnpm exec vitest run apps/desktop/tests/welcome-api.spec.ts apps/desktop/tests/welcome-host.spec.ts`

Expected: FAIL because enterprise welcome operations do not exist.

- [ ] **Step 3: Add the enterprise welcome IPC surface**

Register fixed IPC channel names in `welcome-api.ts`, validate sender origin with the existing helper, cap email at 320 bytes and password at 256 bytes, and never log request bodies.

- [ ] **Step 4: Render the enterprise sign-in state**

Replace provider-key controls in enterprise mode with email/password fields, team name after login, and a loading state reading `正在进入工作台`. Keep the API-key path only for non-enterprise builds; enterprise builds never mount it.

- [ ] **Step 5: Connect the welcome backend to `EnterpriseAuthClient`**

On success, store the session in memory and notify main to start the Host. On failure, return only the typed code. On sign-out, await Electron main's full lifecycle cleanup.

- [ ] **Step 6: Run the welcome tests to verify they pass**

Run: `pnpm exec vitest run apps/desktop/tests/welcome-api.spec.ts apps/desktop/tests/welcome-host.spec.ts`

Expected: PASS, including serialization of the complete preload surface.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/welcome-api.ts apps/desktop/src/preload-welcome.ts apps/desktop/src/welcome-window.ts apps/desktop/src/welcome-backend.ts apps/desktop/src/client/WelcomePage.tsx apps/desktop/src/client/welcome.tsx apps/desktop/tests/welcome-api.spec.ts apps/desktop/tests/welcome-host.spec.ts
git commit -m "feat(desktop): add enterprise welcome flow"
```

### Task 4: Isolate Profiles and Deliver Host Bootstrap over IPC

**Files:**
- Create: `packages/experimental/enterprise-desktop/package.json`
- Create: `packages/experimental/enterprise-desktop/README.md`
- Create: `packages/experimental/enterprise-desktop/src/host/index.ts`
- Create: `packages/experimental/enterprise-desktop/src/host/bootstrap.ts`
- Create: `packages/experimental/enterprise-desktop/tests/bootstrap.spec.ts`
- Create: `apps/desktop-host/src/enterprise-bootstrap.ts`
- Create: `apps/desktop-host/tests/enterprise-bootstrap.spec.ts`
- Modify: `apps/desktop/src/paths.ts`
- Create: `apps/desktop/tests/paths.spec.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/src/host-process.ts`
- Modify: `apps/desktop-host/src/index.ts`
- Modify: `apps/desktop-host/package.json`

**Interfaces:**
- Consumes: Task 1 `DesktopBootstrap`, Task 2 `EnterpriseAuthSession`, and the existing Host child-process IPC channel.
- Produces:
  ```ts
  export interface DesktopProfileIdentity {
    readonly cloudBaseUrl: string
    readonly userId: string
  }

  export interface DesktopPaths {
    profile(identity: DesktopProfileIdentity): string
    lock(identity: DesktopProfileIdentity): string
  }

  export function desktopProfileKey(identity: DesktopProfileIdentity): string

  export interface EnterpriseHostBootstrap {
    readonly cloudBaseUrl: string
    readonly accessToken: string
    readonly accessExpiresAt: string
    readonly profileKey: string
    readonly user: DesktopBootstrap['user']
    readonly team: DesktopBootstrap['team']
  }

  export interface EnterpriseBootstrapPort {
    current(): EnterpriseHostBootstrap
    replace(value: EnterpriseHostBootstrap): void
    clear(): void
  }
  ```
- IPC message: `{ type: 'enterprise-bootstrap', value: EnterpriseHostBootstrap }` and `{ type: 'enterprise-session-cleared' }`.
- `desktopProfileKey` is `sha256(new URL(cloudBaseUrl).origin + '\n' + userId)` encoded as lowercase hex.
- The Host never receives `refreshToken`, `password`, browser cookies, or a consumer account token.

- [ ] **Step 1: Write the failing profile-path tests**

Add and assert:
```ts
it('uses different profiles for different users on one server', () => {})
it('treats trailing slashes and default ports as one server origin', () => {})
it('never places credentials or email in a path', () => {})
```
- [ ] **Step 2: Run the profile-path test to verify it fails**

Run: `pnpm exec vitest run apps/desktop/tests/paths.spec.ts`

Expected: FAIL because `DesktopPaths.profile` is still a string.

- [ ] **Step 3: Replace the shared Desktop profile with server and user keys**

Update every `resolveDesktopPaths()` caller to pass the authenticated identity. Preserve the existing lock semantics inside each keyed profile directory.

- [ ] **Step 4: Write the failing Host bootstrap tests**

Add and assert:
```ts
it('accepts one validated bootstrap message and rejects the refresh token field', async () => {})
it('replaces an expiring access token without restarting the Host', async () => {})
it('clears the bootstrap before shutdown', async () => {})
it('fails closed when bootstrap is unavailable instead of using a direct provider', async () => {})
```
- [ ] **Step 5: Run the Host bootstrap test to verify it fails**

Run: `pnpm exec vitest run apps/desktop-host/tests/enterprise-bootstrap.spec.ts packages/experimental/enterprise-desktop/tests/bootstrap.spec.ts`

Expected: FAIL because the bootstrap port and message do not exist.

- [ ] **Step 6: Implement the Desktop Host bootstrap port and IPC validation**

Validate URL protocol `https:` except loopback in development, token/expiry types, maximum lengths, and exact user/team fields. Publish changes only after validation. The enterprise Host plugin waits for the first bootstrap before activating its cloud consumers and disposes them on clear.

- [ ] **Step 7: Start the Host only after team resolution**

Send the bootstrap immediately after the `starting` handshake and before the browser loads the authenticated URL. If bootstrap delivery or plugin activation fails, terminate the child, show the enterprise bootstrap error, and do not create a fallback provider.

- [ ] **Step 8: Run the Host and profile tests to verify they pass**

Run: `pnpm exec vitest run apps/desktop/tests/paths.spec.ts apps/desktop/tests/host-process.spec.ts apps/desktop-host/tests/enterprise-bootstrap.spec.ts packages/experimental/enterprise-desktop/tests/bootstrap.spec.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/experimental/enterprise-desktop apps/desktop-host/src/enterprise-bootstrap.ts apps/desktop-host/tests/enterprise-bootstrap.spec.ts apps/desktop-host/src/index.ts apps/desktop-host/package.json apps/desktop/src/paths.ts apps/desktop/tests/paths.spec.ts apps/desktop/src/main.ts apps/desktop/src/host-process.ts
git commit -m "feat(desktop): bootstrap isolated enterprise hosts"
```

### Task 5: Make Logout, Expiry, and Account Switching Terminate Safely

**Files:**
- Create: `apps/desktop/src/enterprise-lifecycle.ts`
- Create: `apps/desktop/tests/enterprise-lifecycle.spec.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/src/backend-controller.ts`
- Modify: `apps/desktop/src/enterprise-auth.ts`
- Modify: `apps/desktop/src/welcome-backend.ts`

**Interfaces:**
- Consumes: `EnterpriseAuthClient`, `DesktopPaths`, Host process controls, and cleanup registrations added by later plans.
- Produces:
  ```ts
  export interface EnterpriseCleanupRegistration {
    stop(): Promise<void>
  }

  export class EnterpriseLifecycle {
    register(cleanup: EnterpriseCleanupRegistration): () => void
    logout(): Promise<void>
    handleAuthFailure(error: EnterpriseSignOutRequired): Promise<void>
    dispose(): Promise<void>
  }
  ```
- Cleanups run LIFO. `logout()` is single-flight, first stops new work, then awaits every cleanup, then clears credentials, then opens the welcome window.
- `handleAuthFailure()` performs the same local cleanup but does not retry the server logout.

- [ ] **Step 1: Write the failing lifecycle tests**

Add and assert:
```ts
it('stops the Host before making welcome interactive', async () => {})
it('waits for an in-flight turn cleanup during logout', async () => {})
it('runs every registered cleanup once in reverse order', async () => {})
it('clears local credentials after a revoked refresh token', async () => {})
it('keeps credentials when remote logout fails before local teardown starts', async () => {})
```
- [ ] **Step 2: Run the lifecycle test to verify it fails**

Run: `pnpm exec vitest run apps/desktop/tests/enterprise-lifecycle.spec.ts`

Expected: FAIL because the lifecycle owner does not exist.

- [ ] **Step 3: Implement the single-flight lifecycle**

Reject new turns before Host stop, abort refresh timers, await Host shutdown, release browser guests, run registered cleanups, clear the bootstrap port, delete the credential, and resolve only after the welcome window can accept input.

- [ ] **Step 4: Wire authentication failures and account switching**

Route `EnterpriseSignOutRequired` to `handleAuthFailure()`. On a new sign-in, select the new profile before constructing Host arguments. Never delete another identity's profile during logout.

- [ ] **Step 5: Run the lifecycle and auth tests to verify they pass**

Run: `pnpm exec vitest run apps/desktop/tests/enterprise-lifecycle.spec.ts apps/desktop/tests/enterprise-auth.spec.ts apps/desktop/tests/host-process.spec.ts`

Expected: PASS.

- [ ] **Step 6: Update the Desktop README and JSDoc contracts**

Document enterprise sign-in, credential storage, profile isolation, bootstrap IPC, terminal auth failures, and the fact that the administration console opens in the system browser. Keep each fact in one home.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/enterprise-lifecycle.ts apps/desktop/tests/enterprise-lifecycle.spec.ts apps/desktop/src/main.ts apps/desktop/src/backend-controller.ts apps/desktop/src/enterprise-auth.ts apps/desktop/src/welcome-backend.ts apps/desktop/README.md
git commit -m "feat(desktop): harden enterprise sign-out lifecycle"
```
