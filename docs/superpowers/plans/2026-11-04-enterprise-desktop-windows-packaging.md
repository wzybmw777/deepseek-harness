# Enterprise Desktop Windows Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a separately branded, signed Windows x64 织流 application with a pinned enterprise cloud origin, an independent enterprise update channel, a minimum-version gate, and a packaged local Host.

**Architecture:** A build-time enterprise flavor selects the app id, product name, icon, protocol, artifact name, cloud origin, update origin, and channel. The installed manifest seals these values; runtime code reads them but cannot override them. The existing signed Windows pipeline remains the delivery mechanism, with a separate enterprise feed and installer identity.

**Tech Stack:** Electron Builder, Node packaging scripts, Ed25519/RSA code signing through the existing Windows signing workflow, semver, Vitest.

**Spec:** docs/superpowers/specs/2026-11-04-enterprise-desktop-design.md

## Global Constraints

- Windows x64 is the only first-release target; macOS packaging is out of scope until Windows acceptance.
- Enterprise mode is a separate branded application and update channel.
- The build pins the cloud base URL, update channel, update origin, and minimum supported version.
- A member cannot repoint the application at another server or update feed at runtime.
- The enterprise build requires both the cloud origin and update origin at build time; missing values fail the build.
- The cloud policy may require an update before bootstrap.
- Existing Windows Authenticode, updater signature, installer, and runtime-signature checks remain in force.
- Updates never replace enterprise credentials or Session data.
- The local Host starts only after enterprise identity and bootstrap are available; no tenant container starts for Desktop users.
- Package contents include the enterprise Desktop plugin and its templates in the local runtime.
- Every task runs its named tests before and after implementation; do not commit a red test.

## Review Focus

- A signed enterprise installer must never accept a `nightly` or `latest` channel override; the channel test supplies every override path and expects the sealed enterprise feed.
- A client below the cloud minimum version must stop before bootstrap works, while an equal or newer client continues; the startup test covers patch, pre-release, and exact-boundary versions.
- An enterprise artifact must not use the community app id, product name, protocol registration, output directory, or artifact prefix; the builder test asserts the complete identity tuple.
- A missing or invalid Authenticode/update signature must fail the release; the signing tests cover unsigned, wrong signer, and altered update metadata.
- Updating the enterprise application must preserve the refresh credential, profile key, local Session replica, and task cleanup behavior; the installed-update test compares pre/post state and refuses a profile-root move.

---

### Task 1: Add the Enterprise Windows Build Identity

**Files:**
- Modify: `apps/desktop/scripts/electron-builder-config.mjs`
- Modify: `apps/desktop/scripts/desktop-build-paths.mjs`
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/resources/icon-windows.svg`
- Modify: `apps/desktop/resources/icon-windows.png`
- Create: `apps/desktop/tests/enterprise-build-config.spec.ts`
- Modify: `apps/desktop/tests/desktop-package-selection.spec.ts`

**Interfaces:**
- Consumes: existing `resolveDesktopBuildTarget()`, `electron-builder-config.mjs`, icon resources, and `DSH_DESKTOP_BUILD_FLAVOR`.
- Produces:
  ```ts
  export type DesktopBuildFlavor = 'community' | 'enterprise'

  export interface EnterpriseBuildIdentity {
    readonly flavor: 'enterprise'
    readonly appId: 'ai.zhiliu.desktop'
    readonly productName: '织流'
    readonly protocols: readonly { readonly name: '织流'; readonly schemes: readonly ['zhiliu', 'dsh'] }[]
    readonly artifactPrefix: 'zhiliu-enterprise'
    readonly outputDirectorySuffix: 'enterprise'
    readonly cloudOrigin: string
    readonly updateOrigin: string
  }

  export function resolveEnterpriseBuildIdentity(env: NodeJS.ProcessEnv): EnterpriseBuildIdentity
  ```
- `DSH_DESKTOP_BUILD_FLAVOR` accepts only `community` (default) or `enterprise`.
- Enterprise requires `DSH_ENTERPRISE_CLOUD_ORIGIN` and `DSH_ENTERPRISE_UPDATE_ORIGIN`; both must be absolute HTTPS origins without credentials, query, or hash.
- Artifact name: `zhiliu-enterprise-${version}-win-x64${suffix}.exe`.
- Enterprise output lives in a separate `enterprise/` directory and never reuses community release records.

- [ ] **Step 1: Write the failing enterprise-identity tests**

Add and assert:
```ts
it('uses the enterprise app id, 织流 product name, protocol, artifact prefix, and output directory', () => {})
it('requires HTTPS cloud and update origins for an enterprise build', () => {})
it('rejects a build flavor other than community or enterprise', () => {})
it('keeps the community identity unchanged when flavor is omitted', () => {})
it('uses the repository-owned 织流 Windows icon at every packaged size', () => {})
```
- [ ] **Step 2: Run the identity test to verify it fails**

Run: `pnpm exec vitest run apps/desktop/tests/enterprise-build-config.spec.ts apps/desktop/tests/desktop-package-selection.spec.ts -t 'enterprise identity|build flavor'`

Expected: FAIL because build configuration is hardcoded to the community product.

- [ ] **Step 3: Implement the build identity resolver**

Move the identity tuple into one exported resolver consumed by Electron Builder and package scripts. Preserve existing community values exactly. Validate URLs with `new URL()` and reject any path other than `/` for origins.

- [ ] **Step 4: Apply the identity to Electron Builder metadata**

Set `appId`, `productName`, protocols, artifact name, executable name, output directory, icon files, installer locale strings, and protocol registration from the resolver. Do not add a second generic `dsh` consumer protocol entry under the enterprise identity.

- [ ] **Step 5: Update the installer and tray resources**

Use the existing repository-owned 织流 artwork. Regenerate `icon-windows.png` and tray ICO from the established SVG source at packaging time; do not introduce the fish mark or a new remote asset.

- [ ] **Step 6: Run the build identity tests to verify they pass**

Run: `pnpm exec vitest run apps/desktop/tests/enterprise-build-config.spec.ts apps/desktop/tests/desktop-package-selection.spec.ts apps/desktop/tests/installer-packaging.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/scripts/electron-builder-config.mjs apps/desktop/scripts/desktop-build-paths.mjs apps/desktop/package.json apps/desktop/resources/icon-windows.svg apps/desktop/resources/icon-windows.png apps/desktop/tests/enterprise-build-config.spec.ts apps/desktop/tests/desktop-package-selection.spec.ts
git commit -m "build(desktop): add enterprise windows identity"
```

### Task 2: Seal the Cloud Origin, Update Origin, and Enterprise Channel

**Files:**
- Create: `apps/desktop/src/enterprise-release.ts`
- Create: `apps/desktop/tests/enterprise-release.spec.ts`
- Modify: `apps/desktop/src/update-channel.ts`
- Modify: `apps/desktop/tests/desktop-auto-update-environment.spec.ts`
- Modify: `apps/desktop/scripts/desktop-auto-update-environment.mjs`
- Modify: `apps/desktop/scripts/installed-update-distribution.ts`
- Modify: `apps/desktop/scripts/installed-update-publication.ts`
- Modify: `apps/desktop/scripts/installed-update-identity.mjs`
- Modify: `apps/desktop/src/main.ts`

**Interfaces:**
- Consumes: Task 1 identity and the installed application manifest.
- Produces:
  ```ts
  export interface DesktopEnterpriseRelease {
    readonly cloudOrigin: string
    readonly updateOrigin: string
    readonly updateChannel: 'enterprise'
    readonly minimumSupportedVersion: string
  }

  export function desktopEnterpriseRelease(manifest: unknown): DesktopEnterpriseRelease | undefined
  export type DesktopUpdateChannel = 'nightly' | 'latest' | 'enterprise'
  ```
- Manifest fields: `dshDesktopBuildFlavor: 'enterprise'`, `dshEnterpriseCloudOrigin`, `dshEnterpriseUpdateOrigin`, `dshDesktopUpdateChannel: 'enterprise'`, and `dshEnterpriseMinimumVersion` (embedded from the signed policy build input; runtime updates may raise it through bootstrap).
- Enterprise feed: `${updateOrigin}/desktop/enterprise`, with target directory `win-x64`.
- Environment overrides for feed origin are ignored in packaged enterprise builds. Test/development may substitute a loopback feed only when `app.isPackaged === false` and the manifest flavor is `community`, not `enterprise`.

- [ ] **Step 1: Write the failing release-config tests**

Add and assert:
```ts
it('reads and freezes the sealed enterprise cloud and update origins', () => {})
it('accepts the enterprise channel only with the enterprise build flavor', () => {})
it('rejects enterprise plus nightly or latest', () => {})
it('ignores a packaged environment override that points at another feed', () => {})
it('allows the enterprise channel with a pre-release version only inside the enterprise flavor', () => {})
```
- [ ] **Step 2: Run the release-config test to verify it fails**

Run: `pnpm exec vitest run apps/desktop/tests/enterprise-release.spec.ts apps/desktop/tests/desktop-auto-update-environment.spec.ts -t 'enterprise channel|sealed enterprise'`

Expected: FAIL because the update channel only accepts `nightly` and `latest`.

- [ ] **Step 3: Extend the channel parser with the enterprise invariant**

Parse the flavor before the channel. `enterprise` requires the enterprise flavor and sealed origins; community flavors reject `enterprise`. Invalid explicit values reject rather than defaulting.

- [ ] **Step 4: Wire the enterprise feed into updater resolution and publication**

Use the sealed origin and separate enterprise directory for checks, downloads, publication, retention, rollback, and release metadata. Community feeds cannot read or overwrite enterprise records.

- [ ] **Step 5: Add a manifest tamper test**

Alter cloud origin, update origin, channel, and minimum version one field at a time in a test manifest. Each invalid combination rejects before updater or bootstrap work starts.

- [ ] **Step 6: Run the release-config tests to verify they pass**

Run: `pnpm exec vitest run apps/desktop/tests/enterprise-release.spec.ts apps/desktop/tests/desktop-auto-update-environment.spec.ts apps/desktop/tests/installed-update-distribution.spec.ts apps/desktop/tests/installed-update-publication.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/enterprise-release.ts apps/desktop/tests/enterprise-release.spec.ts apps/desktop/src/update-channel.ts apps/desktop/tests/desktop-auto-update-environment.spec.ts apps/desktop/scripts/desktop-auto-update-environment.mjs apps/desktop/scripts/installed-update-distribution.ts apps/desktop/scripts/installed-update-publication.ts apps/desktop/scripts/installed-update-identity.mjs apps/desktop/src/main.ts
git commit -m "feat(desktop): seal enterprise release settings"
```

### Task 3: Block Bootstrap Below the Minimum Supported Version

**Files:**
- Create: `apps/desktop/src/enterprise-version-gate.ts`
- Create: `apps/desktop/tests/enterprise-version-gate.spec.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/src/enterprise-lifecycle.ts`
- Modify: `apps/desktop/src/client/WelcomePage.tsx`
- Modify: `apps/desktop/src/client/welcome.tsx`
- Modify: `packages/experimental/enterprise-desktop/src/host/index.ts`

**Interfaces:**
- Consumes: `desktopEnterpriseRelease()`, `semver`, cloud bootstrap's `minimumClientVersion`, and the existing mandatory-update presentation.
- Produces:
  ```ts
  export interface EnterpriseVersionGateResult {
    readonly allowed: boolean
    readonly requiredVersion?: string
    readonly currentVersion: string
    readonly reason?: 'below-minimum' | 'invalid-required-version' | 'invalid-current-version'
  }

  export function evaluateEnterpriseVersionGate(input: {
    readonly currentVersion: string
    readonly sealedMinimumVersion: string
    readonly cloudMinimumVersion?: string
  }): EnterpriseVersionGateResult
  ```
- The effective minimum is the greater of the sealed and cloud values using `semver.gte`.
- Invalid versions fail closed with an actionable mandatory-update state.

- [ ] **Step 1: Write the failing version-gate tests**

Add and assert:
```ts
it('blocks a patch version below the effective minimum', () => {})
it('allows the exact minimum and every newer stable or pre-release version', () => {})
it('uses the cloud minimum when it is newer than the sealed minimum', () => {})
it('fails closed when either minimum or the client version is invalid', () => {})
it('never starts the Host before the gate allows the current version', async () => {})
```
- [ ] **Step 2: Run the version-gate test to verify it fails**

Run: `pnpm exec vitest run apps/desktop/tests/enterprise-version-gate.spec.ts`

Expected: FAIL because no minimum-version gate exists.

- [ ] **Step 3: Implement semver comparison and failure states**

Use semver prerelease ordering exactly. Return structured reasons; map only those reasons to localized update copy. Do not compare versions lexically.

- [ ] **Step 4: Enforce the gate before Host construction**

Fetch bootstrap, evaluate the gate, and only then start the Host. A rejected version disposes the bootstrap transport, shows the mandatory-update surface, and never registers model or resource consumers.

- [ ] **Step 5: Keep the update action fixed to the enterprise feed**

The update button opens the existing update coordinator, which reads the sealed enterprise channel. It cannot open a manually supplied URL.

- [ ] **Step 6: Run the version-gate tests to verify they pass**

Run: `pnpm exec vitest run apps/desktop/tests/enterprise-version-gate.spec.ts apps/desktop/tests/mandatory-update-policy.spec.ts apps/desktop/tests/host-process.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/enterprise-version-gate.ts apps/desktop/tests/enterprise-version-gate.spec.ts apps/desktop/src/main.ts apps/desktop/src/enterprise-lifecycle.ts apps/desktop/src/client/WelcomePage.tsx apps/desktop/src/client/welcome.tsx packages/experimental/enterprise-desktop/src/host/index.ts
git commit -m "feat(desktop): enforce enterprise minimum version"
```

### Task 4: Package the Enterprise Host Plugin and Profile

**Files:**
- Modify: `apps/desktop/scripts/prepare-package-set.ts`
- Modify: `apps/desktop/src/core-package-set.ts`
- Modify: `apps/desktop/tests/desktop-package-selection.spec.ts`
- Modify: `apps/desktop/tests/core-package-set.spec.ts`
- Modify: `packages/util/official-bundles/src/bundles.ts`
- Create: `packages/util/official-bundles/src/enterprise-desktop.ts`
- Create: `packages/util/official-bundles/tests/enterprise-desktop.spec.ts`
- Modify: `packages/experimental/enterprise-desktop/package.json`

**Interfaces:**
- Consumes: `@deepseek-ai/dsh-enterprise-desktop`, `DESKTOP_HOST_PACKAGE`, the local package closure, and the Desktop profile template mechanism.
- Produces:
  ```ts
  export const ENTERPRISE_DESKTOP_PACKAGE = '@deepseek-ai/dsh-enterprise-desktop'

  export interface EnterpriseDesktopBundle {
    readonly packageName: typeof ENTERPRISE_DESKTOP_PACKAGE
    readonly hostEntry: '@deepseek-ai/dsh-enterprise-desktop/host'
    readonly clientEntry: '@deepseek-ai/dsh-enterprise-desktop/client'
    readonly profile: 'desktop'
  }

  export const ENTERPRISE_DESKTOP_BUNDLE: EnterpriseDesktopBundle
  ```
- The enterprise profile contains the enterprise Host/client plugin and no model-settings or built-in-plugin management entries.
- The package closure includes every `dependencies` and `peerDependencies` package needed by the Host and client entries.

- [ ] **Step 1: Write the failing package-closure tests**

Add and assert:
```ts
it('selects the enterprise desktop package and every required local dependency', () => {})
it('rejects an enterprise package set that omits a workspace dependency', () => {})
it('adds the enterprise plugin to the desktop profile exactly once', () => {})
it('keeps community package selection unchanged for a community build', () => {})
it('rejects a profile that contains model-settings or plugin-management entries', () => {})
```
- [ ] **Step 2: Run the package-closure test to verify it fails**

Run: `pnpm exec vitest run apps/desktop/tests/desktop-package-selection.spec.ts apps/desktop/tests/core-package-set.spec.ts packages/util/official-bundles/tests/enterprise-desktop.spec.ts`

Expected: FAIL because the enterprise desktop package is not selected or templated.

- [ ] **Step 3: Add the enterprise bundle descriptor**

Export the exact plugin package and host/client entry names. Keep the community desktop composition unchanged.

- [ ] **Step 4: Select the enterprise closure conditionally on build flavor**

Pass the flavor into package preparation. Enterprise builds resolve the enterprise bundle; community builds do not. Missing local dependencies fail the package set rather than falling back to registry resolution.

- [ ] **Step 5: Generate the enterprise profile template**

Add only the enterprise bundle plus the prerequisite runtime bundles for chat, models via the gateway, resources, sessions, browser, settings, and account UI. Remove consumer model settings and built-in plugin management from this template.

- [ ] **Step 6: Run the package-closure tests to verify they pass**

Run: `pnpm exec vitest run apps/desktop/tests/desktop-package-selection.spec.ts apps/desktop/tests/core-package-set.spec.ts packages/util/official-bundles/tests/enterprise-desktop.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/scripts/prepare-package-set.ts apps/desktop/src/core-package-set.ts apps/desktop/tests/desktop-package-selection.spec.ts apps/desktop/tests/core-package-set.spec.ts packages/util/official-bundles/src/bundles.ts packages/util/official-bundles/src/enterprise-desktop.ts packages/util/official-bundles/tests/enterprise-desktop.spec.ts packages/experimental/enterprise-desktop/package.json
git commit -m "build(desktop): package enterprise runtime plugin"
```

### Task 5: Sign, Publish, and Accept the Windows Release

**Files:**
- Modify: `apps/desktop/scripts/windows-sign.mjs`
- Modify: `apps/desktop/scripts/windows-signing-preflight.ts`
- Modify: `apps/desktop/scripts/installed-update-signature.mjs`
- Modify: `apps/desktop/scripts/installed-update-qualification.ts`
- Modify: `apps/desktop/scripts/preflight-desktop-publish.mjs`
- Modify: `apps/desktop/scripts/preflight-desktop-publish-local.mjs`
- Modify: `apps/desktop/scripts/test-windows-installer.mjs`
- Modify: `apps/desktop/windows-signing/README.md`
- Create: `apps/desktop/tests/enterprise-windows-release.spec.ts`
- Create: `docs/upgrade-guide/v0.2.2-alpha.2/enterprise-desktop-windows/guide.md`

**Interfaces:**
- Consumes: Task 1 identity, Task 2 channel, Task 3 gate, Task 4 package closure, and the existing Authenticode/update-signature workflow.
- Produces a signed `zhiliu-enterprise-<version>-win-x64.exe` plus enterprise update metadata. Publication requires all of:
  - valid Authenticode signature from the approved certificate,
  - valid update metadata signature,
  - enterprise app id and artifact prefix,
  - enterprise channel and update origin,
  - minimum-version metadata,
  - packaged `@deepseek-ai/dsh-enterprise-desktop` closure,
  - no community release record overwrite.

- [ ] **Step 1: Write the failing release-qualification tests**

Add and assert:
```ts
it('rejects an unsigned enterprise installer', async () => {})
it('rejects a signer outside the approved enterprise certificate set', async () => {})
it('rejects altered update metadata after signing', async () => {})
it('rejects a community app id, artifact prefix, channel, or update origin', async () => {})
it('rejects publication when the enterprise plugin closure is missing', async () => {})
it('preserves credential and Session state across an enterprise installed update', async () => {})
```
- [ ] **Step 2: Run the release-qualification test to verify it fails**

Run: `pnpm exec vitest run apps/desktop/tests/enterprise-windows-release.spec.ts`

Expected: FAIL because release qualification does not distinguish the enterprise identity and feed.

- [ ] **Step 3: Add enterprise signing and qualification checks**

Require the expected certificate subject/thumbprint policy and a valid timestamp. Verify installer, uninstaller, runtime executables, and update metadata. An unsigned build remains local-only and cannot enter the enterprise publication path.

- [ ] **Step 4: Add the installed-update compatibility test**

Build a previous enterprise fixture, install it in a temporary Windows test root, create an encrypted enterprise credential and local Session replica, apply the new package, and assert the same profile key, credential, Session transcript, and empty task-resource root remain readable. The updater must not move or replace the profile root.

- [ ] **Step 5: Document the Windows release procedure**

Update the signing README with enterprise certificate preflight, required build environment variables, enterprise artifact naming, separate feed publication, rollback, and the acceptance checklist. Add an upgrade guide because the branded install identity and channel are externally perceptible changes.

- [ ] **Step 6: Run the Windows packaging and signing checks**

Run: `pnpm run package:desktop:win:x64`

Expected: a signed enterprise installer and update metadata in the enterprise output directory; the command fails on unsigned or misidentified artifacts.

Run: `pnpm exec vitest run apps/desktop/tests/enterprise-windows-release.spec.ts apps/desktop/tests/test-windows-installer.spec.ts apps/desktop/tests/installed-update-signature.spec.ts apps/desktop/tests/desktop-publication-preflight.spec.ts`

Expected: PASS.

- [ ] **Step 7: Run the Windows acceptance smoke**

On a clean Windows x64 user account: install, sign in with the existing enterprise account, confirm no tenant container starts, start a task, verify gateway usage and quota, open a team resource and confirm its task directory disappears, open the local Browser, open the administration console in the system browser, sign out, confirm the Host stops and the refresh credential is gone, then update from the previous enterprise fixture and confirm the credential and local Session transcript survive.

Expected: every acceptance criterion in the specification passes with no manual registry or environment edits.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/scripts/windows-sign.mjs apps/desktop/scripts/windows-signing-preflight.ts apps/desktop/scripts/installed-update-signature.mjs apps/desktop/scripts/installed-update-qualification.ts apps/desktop/scripts/preflight-desktop-publish.mjs apps/desktop/scripts/preflight-desktop-publish-local.mjs apps/desktop/scripts/test-windows-installer.mjs apps/desktop/windows-signing/README.md apps/desktop/tests/enterprise-windows-release.spec.ts docs/upgrade-guide/v0.2.2-alpha.2/enterprise-desktop-windows/guide.md
git commit -m "build(desktop): qualify enterprise windows release"
```
