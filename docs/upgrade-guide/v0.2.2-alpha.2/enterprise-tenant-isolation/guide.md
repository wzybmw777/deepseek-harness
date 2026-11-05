---
kind: upgrade-guide
description: "The enterprise console removes shared guest access and requires every user to sign in before starting a rootless tenant container."
---

# Enterprise workspaces require sign-in and rootless containers

English | [中文](guide.zh.md)

## Change

The enterprise console no longer creates a guest credential, guest tenant, or shared anonymous workspace. `/enterprise/api/harness/launch`, `/enterprise/api/session/authorize`, and every `/t/<team>/harness/` route now require a signed member session. An obsolete `dsh_enterprise_guest` cookie grants nothing. Unauthenticated launches redirect to `/enterprise/login?next=%2Fenterprise%2Fworkspace`.

Each active team now runs in one rootless Podman container instead of a host subprocess. The control plane must run as an unprivileged user with a working rootless Podman runtime, the configured tenant image, and read-only access to the built application and Node runtime. The service fails closed when Podman is unavailable, reports `Rootless=false`, the image or mount is missing, or a container exits before readiness.

There is no guest fallback or trusted visitor mode. A deployment that still requires anonymous access must remain on the previous release. Team members intentionally share one container, workspace, credential set, and session history. Rootless containers share the host kernel, and host services bound to non-loopback addresses remain reachable through user-mode networking; bind management services to loopback or firewall them separately.

## Migration

1. Create or provision enterprise accounts for every user who previously used the guest workspace. Users without an assigned active team cannot enter a workspace.
2. Build the tenant image from `packages/experimental/enterprise-console/container/Containerfile` and confirm `podman info --format '{{.Host.Security.Rootless}}'` returns `true` as the service user.
3. Run the control plane as a dedicated unprivileged user. Set `DSH_ENTERPRISE_TENANT_IMAGE`, `DSH_ENTERPRISE_PODMAN`, `DSH_ENTERPRISE_TENANT_SOURCE_ROOT`, `DSH_ENTERPRISE_TENANT_ENTRY`, `DSH_ENTERPRISE_TEMPLATE_HOME`, and `DSH_ENTERPRISE_TENANTS` before restarting the service.
4. Keep `/opt/deepseek-harness/.enterprise-data` and the legacy guest tenant directories until their contents have been reviewed or backed up. The new code does not mount or read those guest workspaces.
5. Sign in with an administrator account, confirm team memberships and `/t/<team>/harness/` access, then remove `initial-admin-password.txt` after changing the bootstrap password.
