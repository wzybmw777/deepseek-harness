# Agent Note: Enterprise tenants require authentication and rootless containers

Status: implemented

English | [中文](2026-10-31-enterprise-rootless-tenant-isolation.zh.md)

## Problem

The enterprise console allowed unauthenticated visitors into a shared guest workspace. That made anonymous sessions indistinguishable at the data boundary and let untrusted tenant commands run beside the control plane on the host.

## Decision

The enterprise console has no guest credential, guest tenant, anonymous workspace, or automatic unauthenticated tenant creation. Workspace launch, session authorization, and every tenant HTTP or WebSocket route require a signed enterprise member session. A user without a team, a suspended team, a cross-team URL, and an obsolete guest cookie are rejected before a tenant starts.

Each team receives one rootless Podman container, started lazily by an unprivileged service identity. The container reports `Rootless=true` before use and runs with `--readonly`, `--cap-drop=ALL`, `no-new-privileges`, memory and PID limits, a bounded `/tmp`, a read-only image and application tree, and only that team's durable root writable. Its published port binds host loopback; `slirp4netns` disables host loopback access. The control plane proxies authenticated requests and keeps the internal Harness cookie out of the browser.

Team members intentionally share their team's container, workspace, credentials, session history, and process state. Isolation is between teams, not between members.

## Alternatives considered

**Keep the shared guest workspace for onboarding.** Rejected because an anonymous user would share durable state and tenant authority with every other visitor.

**Run one host subprocess per team as the service user.** Rejected because it provides no filesystem, network, capability, or process-boundary isolation from the control plane.

**Mount the Podman or Docker socket into the tenant.** Rejected because control of the container runtime is equivalent to host control.

**Allocate one container per member.** Deferred because the product currently shares team workspaces and credentials; a member-level confidentiality requirement would need a different storage and collaboration model.

**Use a microVM per tenant.** This would add a hardware-virtualization boundary, but it imposes a larger image, boot, operations, and host-capacity commitment than the current single-machine deployment accepts.

## Consequences

Every enterprise user must authenticate before entering a workspace, and the initial administrator must provision accounts. Rootless containers share the host kernel, so kernel, Podman, crun, and image updates remain security-critical. Host services bound to non-loopback addresses remain reachable through user-mode networking; they must bind to loopback or be firewalled separately, and destination allowlists require an egress proxy. The deployment has hard memory and PID limits but no per-container CPU quota. Legacy guest or probe data directories are not removed automatically, and deleting them requires an explicit backup decision.
