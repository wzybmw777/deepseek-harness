# Enterprise Desktop Plugin Policy, Browser, and Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load only built-in and signed enterprise-approved plugins, keep Desktop browsing inside the local Electron guest, deny member plugin mutation, and present a consistent 织流 enterprise account shell.

**Architecture:** The console signs a short-lived plugin manifest with Ed25519; the Desktop build pins the verification key. The Host verifies the signature and every bundle identity, version, platform, and content hash before activation, failing closed on any mismatch. Desktop Browser continues to use the existing local Electron guest, while the Web workbench retains the server remote Chromium endpoint.

**Tech Stack:** Ed25519, canonical JSON, Cordis, Electron webview guests, React, CSS Modules, Vitest.

**Spec:** docs/superpowers/specs/2026-11-04-enterprise-desktop-design.md

## Global Constraints

- The Desktop Host loads only built-in plugins and enterprise-approved bundles.
- The enterprise service signs the approved manifest; the Desktop application pins the public key.
- Missing, expired, altered, or unsupported policy fails closed.
- A bundle identity, version, platform, or content hash mismatch prevents activation.
- Key rotation requires a signed application update.
- Members cannot add, remove, enable, or update plugin bundles; owner and authorized administrator permissions remain server-enforced.
- Desktop Browser uses the local Electron guest; Web uses the server-side remote Chromium browser when configured.
- The Desktop page receives no `__DSH_SIDEBAR_BROWSER_REMOTE__` injection.
- The administration console opens in the system browser and is never embedded in the Desktop renderer.
- Product name is `织流`; use the repository-owned icon assets rather than the fish mark.
- Product copy is concise and locale-owned; no explanatory paragraph blocks in navigation or account surfaces.
- Each task runs its named tests before and after implementation; do not commit a red test.

## Review Focus

- A modified plugin manifest signature must block every enterprise plugin while leaving built-ins usable; the verifier test flips one signature byte and expects no dynamic activation.
- A valid signature over a bundle whose name, version, platform, or content hash differs from the installed package must fail closed; the loader test mutates each field independently.
- Desktop Browser must never attach the server remote-browser endpoint even when that global is present; the carrier test supplies both and expects the Electron guest factory.
- A member invoking install, remove, enable, or update directly against the API must receive `403` rather than relying on hidden buttons; the console test calls every mutation route.
- The administration entry must call the system-browser bridge with the pinned cloud origin and must not navigate the main renderer; the account-menu test rejects any in-app navigation.

---

### Task 1: Sign the Enterprise Plugin Policy

**Files:**
- Create: `packages/experimental/enterprise-console/src/desktop-plugin-policy.ts`
- Create: `packages/experimental/enterprise-console/tests/desktop-plugin-policy.spec.ts`
- Create: `apps/desktop/resources/enterprise-plugin-public-key.pem`
- Modify: `packages/experimental/enterprise-console/src/api.ts`
- Modify: `packages/experimental/enterprise-console/src/types.ts`
- Modify: `packages/experimental/enterprise-console/src/index.ts`

**Interfaces:**
- Consumes: `PluginRecord`, `BUILTIN_PLUGINS`, bearer authentication, and Ed25519 keys from `node:crypto`.
- Produces:
  ```ts
  export type DesktopPluginPlatform = 'any' | 'win32-x64' | 'darwin-arm64' | 'darwin-x64'

  export interface DesktopApprovedPlugin {
    readonly packageName: string
    readonly scope: 'builtin' | 'enterprise'
    readonly version: string
    readonly platform: DesktopPluginPlatform
    readonly contentHash: `sha256:${string}`
    readonly enabled: boolean
  }

  export interface DesktopPluginPolicyDocument {
    readonly apiVersion: 1
    readonly teamId: string
    readonly revision: string
    readonly issuedAt: string
    readonly expiresAt: string
    readonly plugins: readonly DesktopApprovedPlugin[]
    readonly signature: {
      readonly algorithm: 'ed25519'
      readonly keyId: string
      readonly value: string
    }
  }

  export class DesktopPluginPolicySigner {
    constructor(input: { readonly privateKeyPem: string; readonly keyId: string; readonly now?: () => number })
    sign(input: { readonly teamId: string; readonly revision: string; readonly plugins: readonly DesktopApprovedPlugin[] }): DesktopPluginPolicyDocument
  }
  ```
- Route: `GET /enterprise/api/desktop/plugins`, bearer-authenticated, returns the signed document.
- Lifetime is 10 minutes. `revision` changes whenever any durable plugin row, version, enabled flag, or platform changes.
- `contentHash` is over the exact installed package file tree in sorted relative-path order, including file bytes and executable bits, with a documented separator.
- Signing key comes from `DSH_ENTERPRISE_PLUGIN_SIGNING_KEY` as base64 PKCS#8; absent or invalid key returns `503 plugin_policy_unavailable` without an unsigned fallback.

- [ ] **Step 1: Write the failing signer tests**

Add and assert:
```ts
it('signs canonical policy bytes that verify with the pinned public key', async () => {})
it('changes revision when a plugin version or enabled flag changes', async () => {})
it('returns plugin_policy_unavailable without a signing key', async () => {})
it('expires a policy after ten minutes', async () => {})
it('includes built-ins and enterprise bundles with exact platform values', async () => {})
```
- [ ] **Step 2: Run the signer test to verify it fails**

Run: `pnpm exec vitest run packages/experimental/enterprise-console/tests/desktop-plugin-policy.spec.ts`

Expected: FAIL because the signer and policy route do not exist.

- [ ] **Step 3: Implement canonical bytes and Ed25519 signing**

Canonicalize the document without `signature` using sorted keys and JSON scalar encoding, sign those bytes, and base64url-encode the signature. Reject private-key material embedded in the public file or repository.

- [ ] **Step 4: Add the bearer policy route**

Re-authorize the Desktop session and team on every request. Read current plugin records and installed package versions from the shared plugin root. Do not return filesystem paths, private keys, npm credentials, or installation output.

- [ ] **Step 5: Add the pinned public key fixture and verification helper test**

Create `enterprise-plugin-public-key.pem` from the development fixture key and add a test that the committed public key verifies only the corresponding private fixture. Do not commit a production private key.

- [ ] **Step 6: Run the signer and API tests to verify they pass**

Run: `pnpm exec vitest run packages/experimental/enterprise-console/tests/desktop-plugin-policy.spec.ts packages/experimental/enterprise-console/tests/plugin-policy.spec.ts packages/experimental/enterprise-console/tests/api.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/experimental/enterprise-console/src/desktop-plugin-policy.ts packages/experimental/enterprise-console/tests/desktop-plugin-policy.spec.ts packages/experimental/enterprise-console/src/api.ts packages/experimental/enterprise-console/src/types.ts packages/experimental/enterprise-console/src/index.ts apps/desktop/resources/enterprise-plugin-public-key.pem
git commit -m "feat(enterprise): sign desktop plugin policy"
```

### Task 2: Verify and Activate Only Approved Host Plugins

**Files:**
- Create: `packages/experimental/enterprise-desktop/src/host/plugin-policy.ts`
- Create: `packages/experimental/enterprise-desktop/src/host/plugin-content-hash.ts`
- Create: `packages/experimental/enterprise-desktop/src/host/plugin-loader.ts`
- Create: `packages/experimental/enterprise-desktop/tests/plugin-policy.spec.ts`
- Create: `packages/experimental/enterprise-desktop/tests/plugin-content-hash.spec.ts`
- Create: `packages/experimental/enterprise-desktop/tests/plugin-loader.spec.ts`
- Modify: `packages/experimental/enterprise-desktop/src/host/index.ts`
- Modify: `packages/experimental/enterprise-desktop/package.json`

**Interfaces:**
- Consumes: Task 1's signed document, the pinned public key resource, `BUILTIN_PLUGINS`, and Cordis plugin loading.
- Produces:
  ```ts
  export interface VerifiedPluginPolicy {
    readonly teamId: string
    readonly revision: string
    readonly expiresAt: string
    readonly plugins: readonly DesktopApprovedPlugin[]
  }

  export function verifyDesktopPluginPolicy(
    document: unknown,
    publicKeyPem: string,
    now: number,
    platform: DesktopPluginPlatform,
  ): VerifiedPluginPolicy

  export function hashPluginDirectory(directory: string): Promise<`sha256:${string}`>

  export class EnterprisePluginLoader {
    constructor(input: { readonly verified: VerifiedPluginPolicy; readonly runtimeRoot: string; readonly hashDirectory?: typeof hashPluginDirectory })
    activate(ctx: Context): Promise<() => Promise<void>>
  }
  ```
- Verification order: schema and bounds, algorithm/key id, signature, expiry with 60-second clock skew, team revision, platform, built-in identity, installed version, content hash.
- Built-ins are retained only when listed by the verified document; enterprise bundles are imported only after all checks succeed.

- [ ] **Step 1: Write the failing policy-verifier tests**

Add and assert:
```ts
it('accepts a valid signed policy with an unexpired revision', () => {})
it('rejects one altered signature byte', () => {})
it('rejects an expired policy beyond the allowed clock skew', () => {})
it('rejects an unsupported key id or algorithm', () => {})
it('rejects duplicate package names and unknown scopes', () => {})
```
- [ ] **Step 2: Run the verifier test to verify it fails**

Run: `pnpm exec vitest run packages/experimental/enterprise-desktop/tests/plugin-policy.spec.ts`

Expected: FAIL because the verifier does not exist.

- [ ] **Step 3: Implement verification without trusting parsed payload order**

Verify the raw canonical payload reconstructed from the parsed object, compare signatures with `timingSafeEqual`, enforce bounded arrays and strings, and return a frozen verified policy. Any failure throws a typed localized error before import.

- [ ] **Step 4: Write the failing content-hash and loader tests**

Add and assert:
```ts
it('hashes file bytes, relative paths, and executable bits deterministically', async () => {})
it('rejects a package name, version, platform, or content hash mismatch', async () => {})
it('loads built-ins when every enterprise bundle is absent', async () => {})
it('activates no dynamic enterprise bundle after a failed verification', async () => {})
it('disposes activated bundles in reverse order', async () => {})
```
- [ ] **Step 5: Run the content-hash and loader tests to verify they fail**

Run: `pnpm exec vitest run packages/experimental/enterprise-desktop/tests/plugin-content-hash.spec.ts packages/experimental/enterprise-desktop/tests/plugin-loader.spec.ts`

Expected: FAIL because hashing and activation do not exist.

- [ ] **Step 6: Implement deterministic hashing and fail-closed loading**

Walk the package directory without following symlinks. Include sorted POSIX relative paths, byte lengths, bytes, and POSIX executable-bit state. Re-read package metadata from `package.json` and compare it with the signed record before import.

- [ ] **Step 7: Wrap activation in Cordis effects**

Use `ctx.plugin()` for each verified bundle and collect its disposer. If one bundle throws during activation, dispose every earlier bundle and leave the policy unhealthy. A later reload rebuilds from scratch; never merge a partial activation.

- [ ] **Step 8: Run the plugin-policy tests to verify they pass**

Run: `pnpm exec vitest run packages/experimental/enterprise-desktop/tests/plugin-policy.spec.ts packages/experimental/enterprise-desktop/tests/plugin-content-hash.spec.ts packages/experimental/enterprise-desktop/tests/plugin-loader.spec.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/experimental/enterprise-desktop/src/host/plugin-policy.ts packages/experimental/enterprise-desktop/src/host/plugin-content-hash.ts packages/experimental/enterprise-desktop/src/host/plugin-loader.ts packages/experimental/enterprise-desktop/tests/plugin-policy.spec.ts packages/experimental/enterprise-desktop/tests/plugin-content-hash.spec.ts packages/experimental/enterprise-desktop/tests/plugin-loader.spec.ts packages/experimental/enterprise-desktop/src/host/index.ts packages/experimental/enterprise-desktop/package.json
git commit -m "feat(desktop): verify signed plugin policy"
```

### Task 3: Enforce Owner and Administrator Plugin Permissions

**Files:**
- Modify: `packages/experimental/enterprise-console/src/api.ts`
- Modify: `packages/experimental/enterprise-console/tests/api.spec.ts`
- Modify: `packages/experimental/enterprise-console/tests/plugin-policy.spec.ts`
- Modify: `packages/experimental/client-ui-enterprise-resources/src/client/index.ts`
- Create: `packages/experimental/client-ui-enterprise-resources/tests/plugin-permissions.client.spec.tsx`

**Interfaces:**
- Consumes: `BUILTIN_PLUGIN_WRITE_PERMISSION`, `ENTERPRISE_PLUGIN_WRITE_PERMISSION`, `assertBuiltinPluginManager()`, and existing plugin CRUD handlers.
- Produces:
  - `GET /enterprise/api/plugins` remains available only to a caller with either plugin-write permission.
  - `POST /enterprise/api/plugins` requires `plugins.enterprise.write` and an owner or administrator role that holds it.
  - `POST /enterprise/api/plugins/builtin`, `PATCH /enterprise/api/plugins/{id}`, and `DELETE /enterprise/api/plugins/{id}` require the permission that owns the selected scope.
  - Members receive `403 forbidden` on every plugin mutation and on the plugin-management projection.

- [ ] **Step 1: Write the failing member-permission tests**

Add and assert:
```ts
it('denies a member every plugin mutation route', async () => {})
it('denies a member the plugin management projection', async () => {})
it('lets an authorized administrator enable an enterprise bundle without allowing built-in mutation', async () => {})
it('lets only the owner add or remove a built-in plugin', async () => {})
it('renders no plugin management entry for a member', async () => {})
```
- [ ] **Step 2: Run the permission tests to verify they fail**

Run: `pnpm exec vitest run packages/experimental/enterprise-console/tests/api.spec.ts packages/experimental/enterprise-console/tests/plugin-policy.spec.ts packages/experimental/client-ui-enterprise-resources/tests/plugin-permissions.client.spec.tsx -t 'plugin'`

Expected: FAIL where PATCH or DELETE can reach a handler without an explicit scope permission check, or where member UI still mounts the entry.

- [ ] **Step 3: Put scope-specific permission checks at the route boundary**

Resolve the target plugin record before dispatch, choose `builtin` versus `enterprise` from the record, and enforce that scope's permission before reading the body or invoking the installer. Keep owner-only built-in management.

- [ ] **Step 4: Hide the management surface from members**

Use the server-provided plugin-management projection instead of inferring permission from role names. Do not render disabled controls or explanatory text. Return no panel entry when neither permission is present.

- [ ] **Step 5: Run the permission tests to verify they pass**

Run: `pnpm exec vitest run packages/experimental/enterprise-console/tests/api.spec.ts packages/experimental/enterprise-console/tests/plugin-policy.spec.ts packages/experimental/client-ui-enterprise-resources/tests/plugin-permissions.client.spec.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/experimental/enterprise-console/src/api.ts packages/experimental/enterprise-console/tests/api.spec.ts packages/experimental/enterprise-console/tests/plugin-policy.spec.ts packages/experimental/client-ui-enterprise-resources/src/client/index.ts packages/experimental/client-ui-enterprise-resources/tests/plugin-permissions.client.spec.tsx
git commit -m "fix(enterprise): enforce plugin management permissions"
```

### Task 4: Keep Desktop Browser Local and Web Browser Remote

**Files:**
- Modify: `packages/client/ui-sidebar-browser/src/client/index.ts`
- Modify: `packages/client/ui-sidebar-browser/src/client/browser/remote/endpoint.ts`
- Modify: `packages/client/ui-sidebar-browser/tests/electron-frame.client.spec.ts`
- Modify: `packages/client/ui-sidebar-browser/tests/remote-browser.client.spec.ts`
- Modify: `packages/experimental/enterprise-console/src/session-guard.ts`
- Create: `apps/desktop-host/tests/browser-injections.spec.ts`
- Modify: `apps/desktop-host/src/index.ts`

**Interfaces:**
- Consumes: `dshDesktop.browser` carrier, `browserRemoteEndpoint()`, existing `createElectronPage()`, and Desktop Host `collectIndexInjections()`.
- Produces:
  ```ts
  export function selectBrowserCarrier(input: {
    readonly desktop: DesktopBrowserBridge | undefined
    readonly remoteEndpoint: string | undefined
  }): 'electron' | 'remote' | 'iframe'
  ```
- Selection order is `desktop -> electron`, `remoteEndpoint -> remote`, otherwise `iframe`.
- Desktop Host ready injections contain no `__DSH_SIDEBAR_BROWSER_REMOTE__` assignment. The enterprise Web tenant guard continues to assign `/enterprise/api/browser`.

- [ ] **Step 1: Write the failing carrier-selection tests**

Add and assert:
```ts
it('selects the Electron guest when the Desktop bridge and remote endpoint both exist', () => {})
it('selects remote Chromium for Web when the endpoint exists', () => {})
it('selects iframe when neither carrier exists', () => {})
it('emits no remote-browser injection from the Desktop Host', async () => {})
it('keeps the remote-browser injection in the enterprise Web tenant guard', () => {})
```
- [ ] **Step 2: Run the browser tests to verify they fail**

Run: `pnpm exec vitest run packages/client/ui-sidebar-browser/tests/electron-frame.client.spec.ts packages/client/ui-sidebar-browser/tests/remote-browser.client.spec.ts apps/desktop-host/tests/browser-injections.spec.ts -t 'carrier|injection'`

Expected: FAIL because selection is inlined and the Host injection test does not exist.

- [ ] **Step 3: Extract and use the carrier selector**

Read the Desktop bridge first, regardless of a remote global. Never mutate or delete the remote global in Electron; simply do not attach it. The Web path keeps its existing endpoint parsing and validation.

- [ ] **Step 4: Test the live injected guest policy**

Keep the existing guest sandbox, context isolation, partition ownership, host blocking, address validation, and fixed popup policy. Add an enterprise smoke that opens one HTTP page through the local guest and confirms no request reaches the local Host address.

- [ ] **Step 5: Run the browser tests to verify they pass**

Run: `pnpm exec vitest run packages/client/ui-sidebar-browser/tests/electron-frame.client.spec.ts packages/client/ui-sidebar-browser/tests/remote-browser.client.spec.ts apps/desktop-host/tests/browser-injections.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/client/ui-sidebar-browser/src/client/index.ts packages/client/ui-sidebar-browser/src/client/browser/remote/endpoint.ts packages/client/ui-sidebar-browser/tests/electron-frame.client.spec.ts packages/client/ui-sidebar-browser/tests/remote-browser.client.spec.ts packages/experimental/enterprise-console/src/session-guard.ts apps/desktop-host/tests/browser-injections.spec.ts apps/desktop-host/src/index.ts
git commit -m "feat(desktop): keep enterprise browsing local"
```

### Task 5: Unify the 织流 Enterprise Chrome and Account Actions

**Files:**
- Create: `packages/experimental/enterprise-desktop/src/client/brand.tsx`
- Create: `packages/experimental/enterprise-desktop/src/client/account-menu.tsx`
- Create: `packages/experimental/enterprise-desktop/src/client/chrome.module.css`
- Create: `packages/experimental/enterprise-desktop/src/client/brand-locales.ts`
- Create: `packages/experimental/enterprise-desktop/src/client/product-policy.ts`
- Create: `packages/experimental/enterprise-desktop/tests/brand.client.spec.tsx`
- Create: `packages/experimental/enterprise-desktop/tests/account-menu.client.spec.tsx`
- Modify: `packages/experimental/enterprise-desktop/src/client/index.ts`
- Modify: `apps/desktop/src/crash-report.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/src/ipc.ts`
- Modify: `apps/desktop/src/preload-app.ts`
- Modify: `apps/desktop/src/client/WelcomePage.tsx`

**Interfaces:**
- Consumes: `sidebar.brand.mark`, `sidebar.brand.name`, the existing account slot, and a new fixed IPC `dsh-desktop:open-enterprise-admin` implemented by `shell.openExternal()`.
- Produces:
  ```ts
  export interface EnterpriseAccountMenuProps {
    readonly user: { readonly name: string; readonly email: string }
    readonly team: { readonly name: string }
    readonly planName: string
    readonly quota: DesktopQuota
    readonly onSignOut: () => Promise<void>
  }

  export interface EnterpriseChromeActions {
    openAdminConsole(): Promise<void>
    openBilling(): Promise<void>
    openEnterpriseSupport(): Promise<void>
  }

  export interface EnterpriseProductPolicy {
    readonly consumerAnalytics: false
    readonly crashReports: 'enterprise-support'
    readonly supportEmail: string
  }
  ```
- Brand name is `织流`; the mark uses the repository-owned application icon artwork, never `FishLogo`.
- The build-version text is not rendered in enterprise mode.
- Navigation uses one row style for files, knowledge, skills, shared Sessions, and plugins (when managed). The account menu contains profile, team, quota summary, billing, administration, and sign out.
- Administration and billing URLs are resolved from the pinned bootstrap origin; the renderer cannot supply an arbitrary URL.

- [ ] **Step 1: Write the failing brand tests**

Add and assert:
```ts
it('renders 织流 with the repository-owned mark instead of FishLogo', () => {})
it('hides the local build title and version in enterprise mode', () => {})
it('renders one consistent row-token set for every enterprise navigation entry', () => {})
it('uses concise localized labels without paragraph descriptions', () => {})
it('disables consumer analytics and never reports an enterprise product event', async () => {})
it('routes crash-report prompts to the configured enterprise support address', async () => {})
```
- [ ] **Step 2: Run the brand tests to verify they fail**

Run: `pnpm exec vitest run packages/experimental/enterprise-desktop/tests/brand.client.spec.tsx`

Expected: FAIL because the enterprise brand slots are not registered.

- [ ] **Step 3: Register the brand mark and name slots**

Use the SVG artwork derived from `apps/desktop/resources/icon-windows.svg`. Render at the established `24px` mark and `20px` name sizes, preserve the existing logo-row drag behavior, and remove version text entirely in enterprise mode.

- [ ] **Step 4: Write the failing account-menu tests**

Add and assert:
```ts
it('shows user, team, plan, remaining tokens, and sign out', async () => {})
it('opens administration in the system browser at the pinned cloud origin', async () => {})
it('never navigates the main renderer to the administration console', async () => {})
it('rejects an arbitrary administration URL supplied by the page', async () => {})
it('disables repeated sign-out clicks while logout is running', async () => {})
it('shows the enterprise support action without opening the consumer crash-report form', async () => {})
```
- [ ] **Step 5: Run the account-menu tests to verify they fail**

Run: `pnpm exec vitest run packages/experimental/enterprise-desktop/tests/account-menu.client.spec.tsx apps/desktop/tests/main-startup.spec.ts -t 'enterprise admin|account menu'`

Expected: FAIL because the IPC and menu do not exist.

- [ ] **Step 6: Implement the fixed administration IPC**

Register a no-argument IPC operation that reconstructs `/enterprise` from the active bootstrap cloud origin, requires `https:` outside loopback development, and calls `shell.openExternal()`. The preload exposes only the operation name, not generic URL opening.

- [ ] **Step 7: Implement the unified account and navigation chrome**

Build a single row primitive for navigation and account actions. Use shared CSS tokens for height, radius, hover, focus ring, icon gap, and truncation. The account menu opens as a standard menu, not a floating custom panel, and closes on Escape or blur.

- [ ] **Step 8: Implement enterprise product-policy routing**

Read `policy.consumerAnalytics`, `policy.crashReports`, and `policy.supportEmail` from the sealed bootstrap. Disable the analytics reporter and consumer crash-report uploads before the workspace document loads. Replace the crash-report prompt with a localized support action that targets the configured enterprise support address through the fixed system-browser bridge. Never accept a support URL from renderer input.

- [ ] **Step 9: Run the brand, account-menu, and product-policy tests to verify they pass**

Run: `pnpm exec vitest run packages/experimental/enterprise-desktop/tests/brand.client.spec.tsx packages/experimental/enterprise-desktop/tests/account-menu.client.spec.tsx apps/desktop/tests/main-startup.spec.ts apps/desktop/tests/crash-report.spec.ts`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/experimental/enterprise-desktop/src/client/brand.tsx packages/experimental/enterprise-desktop/src/client/account-menu.tsx packages/experimental/enterprise-desktop/src/client/chrome.module.css packages/experimental/enterprise-desktop/src/client/brand-locales.ts packages/experimental/enterprise-desktop/src/client/product-policy.ts packages/experimental/enterprise-desktop/tests/brand.client.spec.tsx packages/experimental/enterprise-desktop/tests/account-menu.client.spec.tsx packages/experimental/enterprise-desktop/src/client/index.ts apps/desktop/src/main.ts apps/desktop/src/ipc.ts apps/desktop/src/preload-app.ts apps/desktop/src/client/WelcomePage.tsx apps/desktop/src/crash-report.ts
git commit -m "feat(desktop): unify zhiliu enterprise chrome"
```
