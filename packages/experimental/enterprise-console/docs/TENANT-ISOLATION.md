---
description: "Threat model, rootless container contract, deployment, and verification for enterprise tenant isolation."
kind: "package-reference"
---

# Enterprise tenant isolation

This document defines the security boundary between an authenticated enterprise user, the enterprise control plane, the host, and every other tenant. It applies to the optional `@deepseek-ai/dsh-enterprise-console` Host plugin and to its production systemd deployment.

## Security objective

Tenant users may execute arbitrary commands inside their own workspace. They must not be able to read another tenant's files, read enterprise authentication data, write the host filesystem, reach host-local services, access the container runtime socket, or exhaust unbounded host memory or process identifiers.

The security boundary is the tenant, not the browser tab. Members of one team intentionally share that team's container, workspace, credentials, session history, and process. Separating individual members of the same team requires a separate team allocation; the enterprise console does not claim per-member isolation.

## Non-goals

- The tenant container is not a hardware virtualization boundary. It shares the host kernel and depends on rootless Podman, runc/crun, user namespaces, and kernel security updates.
- External egress is intentionally available so model providers and package registries work. Tenant data can leave through user-initiated network requests.
- Members of one team can read and modify each other's workspace data by design.
- The console does not integrate an online payment provider or a remote execution cluster.

## Trust boundaries

| Component | Trust level | Owns | Must never receive |
|---|---|---|---|
| Browser | Untrusted | Enterprise cookie, user input | Tenant Harness cookie or launch token |
| Enterprise control plane | Trusted application, unprivileged OS user | Login sessions, SQLite catalog, keys, container supervision | Root host filesystem writes |
| Tenant container | Untrusted workload | One team's Home, workspace, sessions, model-credential copy | Enterprise SQLite, session key, credential key, other tenant roots, Podman socket |
| Host kernel and Podman | Trusted platform | Namespaces, cgroups, image storage | Tenant-controlled runtime configuration |

The control plane runs as the dedicated `dsh-enterprise` user. It may supervise rootless containers owned by that user, but it is not root and does not mount the host filesystem into a tenant.

## Authentication and entry

`/` and `/enterprise/workspace` always send the browser to `/enterprise/api/harness/launch`. That endpoint requires a valid enterprise session. An unauthenticated request is redirected to `/enterprise/login`; it never creates a tenant.

After login, the launch endpoint verifies `workspace.use`, resolves the user's team, rejects unassigned and suspended teams, audits the launch, starts that team's container if necessary, and redirects to `/t/<team-slug>/harness/`.

The enterprise session cookie is `dsh_enterprise_session`. There is no guest credential, guest tenant, shared anonymous workspace, or automatic tenant creation for an unauthenticated visitor.

## Container contract

Each team runs in a rootless Podman container named `dsh-tenant-<team-id>-<nonce>` and labelled `io.deepseek.enterprise.tenant=<team-id>`.

The runtime applies these controls on every start:

| Control | Value | Purpose |
|---|---|---|
| Rootless | Podman inside the `dsh-enterprise` user session | A container escape must also escape user namespaces, not only a process UID |
| User namespace | `--userns=keep-id` | Container files map to the unprivileged service user; no host UID 0 |
| Runtime identity | `--user <service-uid>:<service-gid>` | Tenant code never runs as root |
| Root filesystem | `--read-only` | Image and binaries cannot be modified |
| Linux capabilities | `--cap-drop=ALL` | No administrative capability inside the container |
| Privilege escalation | `--security-opt=no-new-privileges` | Setuid binaries cannot regain privilege |
| Process limit | `--pids-limit` | Stops fork bombs from exhausting host PIDs |
| Memory limit | `--memory` and `--memory-swap` equal | Stops unbounded heap and page-cache growth |
| Temporary filesystem | `tmpfs /tmp`, `nosuid`, `nodev`, bounded | Temporary writes stay ephemeral and non-executable by mount policy |
| Host binding | `--publish 127.0.0.1:<host-port>:<host-port>` | Only the control plane can reach the tenant listener |
| Network | `slirp4netns` with host loopback disabled | Tenant code cannot reach host loopback listeners |

The image contains `bash`, `bubblewrap`, `ca-certificates`, `curl`, `git`, `jq`, `less`, `procps`, `python3`, `ripgrep`, and `socat`. The DSH runtime and Node binary are mounted read-only from the reviewed build, so the image does not carry a second mutable copy of the application.

The tenant application binds `127.0.0.1:3000` inside its own network namespace. A raw TCP `socat` relay listens on the published container port and forwards to that loopback listener. This keeps DSH's wildcard-bind rejection intact: the application never binds `0.0.0.0`, while the host still gets exactly one loopback-published port.

## Filesystem policy

Read-only mounts into each container:

- `/opt/node24` or the resolved Node installation root
- `<source-root>/node_modules`
- `<source-root>/packages`
- `<source-root>/apps/cli`
- `<source-root>/apps/web`
- `<source-root>/native`
- `<source-root>/vendor`
- `<source-root>/package.json`

Read-write mounts:

- `<tenant-root>/<team-id>` mounted at the same absolute path

The tenant root contains only `home`, `documents`, `runtime.patch.yml`, and DSH-created state. It is mode `0700` and owned by `dsh-enterprise`. The container does not mount:

- `/opt/deepseek-harness/.enterprise-data`
- `/root`
- `/home`
- `/var/run/docker.sock`
- `/run/user/<uid>/podman/podman.sock`
- `/var/lib/dsh-enterprise-tenants` as a parent directory
- another team's root

DSH's inner `workspace-write` policy remains enabled as defense in depth. It confines Bash and terminal file effects to the tenant workspace and ephemeral `/tmp`; it is not the primary host boundary because the container itself already exposes only the tenant root for writes.

## Network policy

Rootless Podman creates a separate network namespace per container. The runtime sets `slirp4netns` with `allow_host_loopback=false`, so tenant code cannot reach the host's loopback listeners or the `10.0.2.2` host gateway. This option does not block the host's other interface addresses: services bound to a LAN or public host address remain reachable through user-mode networking. Bind host management and data services to loopback, or firewall them separately; use an egress proxy when tenant destinations need an allowlist.

External egress remains enabled for model APIs, package registries, and user-requested HTTP(S) access. DNS and TLS use the container's own resolver and CA bundle. A deployment that requires a strict model-only allowlist must place an authenticated egress proxy outside the tenant boundary and point the tenant's `HTTPS_PROXY` at that proxy; a loopback proxy on the host is intentionally unreachable.

The raw TCP relay supports HTTP and WebSocket upgrades. The control plane injects the internal Harness cookie only on its loopback request; the browser never receives that cookie or the launch token.

## Resource policy

Memory and PID limits are hard cgroup limits enforced by rootless Podman. The default deployment limit is 1 GiB and 512 processes per container. The manager also caps the number of running containers and stops idle containers after the configured interval.

CPU quota is not currently enforced by this deployment because the host's systemd user slice delegates only the `memory` and `pids` controllers; requesting `--cpus` fails closed with `the requested cgroup controller cpu is not available`. The control plane does not silently drop that failure. A deployment that needs a hard CPU quota must first enable CPU delegation for the service user's slice, verify it with `podman info`, and only then add `--cpus`.

## Lifecycle

1. A login launches the user's team.
2. The manager allocates a loopback port and prepares the private tenant root.
3. The manager verifies that Podman reports `Rootless=true`.
4. Stale containers carrying the enterprise tenant label are removed after a crash or restart.
5. The manager starts one container and parses the one-time DSH readiness URL from its stdout.
6. The manager exchanges the launch token inside the host process and stores the internal cookie in memory.
7. HTTP requests and WebSocket upgrades increment the lease's active count.
8. Idle containers are stopped after the configured timeout and their ports are released.
9. On manager shutdown, every running container is stopped and removed; the tenant root remains durable.

Startup fails closed when Podman is unavailable, when rootless mode is not reported, when the image is missing, when the container exits before readiness, or when the token exchange fails.

## Deployment prerequisites

- Linux with user namespaces enabled and unprivileged Landlock or bubblewrap available
- Rootless Podman, `slirp4netns`, `fuse-overlayfs`, and `uidmap`
- A dedicated `dsh-enterprise` system user with subordinate UID/GID ranges
- `loginctl enable-linger dsh-enterprise` so the user systemd manager survives logout
- `/var/lib/dsh-enterprise` for the service Home and template Home
- `/var/lib/dsh-enterprise-tenants` owned by `dsh-enterprise`, mode `0700`
- `/opt/deepseek-harness/.enterprise-data` owned by `dsh-enterprise`, mode `0700`, never mounted into a tenant
- A built tenant image tagged `localhost/dsh-enterprise-tenant:local` or configured through `DSH_ENTERPRISE_TENANT_IMAGE`

The control-plane systemd unit runs as `dsh-enterprise`, sets `HOME`, `XDG_RUNTIME_DIR`, and `DBUS_SESSION_BUS_ADDRESS`, and keeps `NoNewPrivileges=no` only because the rootless Podman subordinate-ID helper must execute. The tenant container itself always uses `no-new-privileges`.

## Configuration

| Config | Environment | Meaning |
|---|---|---|
| `tenantRoot` | `DSH_ENTERPRISE_TENANTS` | Private per-team data root |
| `tenantDshEntry` | `DSH_ENTERPRISE_TENANT_ENTRY` | Built CLI entry mounted read-only |
| `tenantSourceRoot` | `DSH_ENTERPRISE_TENANT_SOURCE_ROOT` | Repository build tree whose application directories are mounted read-only |
| `tenantTemplateHome` | `DSH_ENTERPRISE_TEMPLATE_HOME` | Profile and credential seed Home |
| `tenantProfile` | `DSH_ENTERPRISE_TENANT_PROFILE` | Profile loaded by each tenant |
| `tenantContainerImage` | `DSH_ENTERPRISE_TENANT_IMAGE` | Rootless container image |
| `tenantContainerPodman` | `DSH_ENTERPRISE_PODMAN` | Podman executable |
| `tenantContainerMemoryMb` | `DSH_ENTERPRISE_TENANT_MEMORY_MB` | Per-tenant memory ceiling |
| `tenantContainerPids` | `DSH_ENTERPRISE_TENANT_PIDS` | Per-tenant process ceiling |
| `tenantPortStart` / `tenantPortEnd` | `DSH_ENTERPRISE_TENANT_PORT_START` / `END` | Host loopback port range |
| `maxTenantProcesses` | `DSH_ENTERPRISE_MAX_TENANTS` | Concurrent container cap |
| `tenantIdleTimeoutMinutes` | `DSH_ENTERPRISE_TENANT_IDLE_MINUTES` | Idle stop interval |
| `tenantStartTimeoutMs` | `DSH_ENTERPRISE_TENANT_START_TIMEOUT_MS` | Readiness deadline |

## Image build and upgrade

Build the image from the repository root:

```sh
podman build \
  -t localhost/dsh-enterprise-tenant:local \
  -f packages/experimental/enterprise-console/container/Containerfile \
  packages/experimental/enterprise-console/container
```

Build it as `dsh-enterprise` so it lands in that user's rootless image store:

```sh
su -s /bin/bash dsh-enterprise -c \
  'XDG_RUNTIME_DIR=/run/user/996 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/996/bus podman build -t localhost/dsh-enterprise-tenant:local -f /opt/deepseek-harness/packages/experimental/enterprise-console/container/Containerfile /opt/deepseek-harness/packages/experimental/enterprise-console/container'
```

After changing the image, run the verification matrix below and restart the control plane. Running containers are not upgraded in place; each tenant receives the new image on its next start.

## Verification matrix

Run these checks from the host after deployment:

```sh
# The tenant process must be rootless and must not be host root.
sudo -u dsh-enterprise env XDG_RUNTIME_DIR=/run/user/996 \
  podman info --format '{{.Host.Security.Rootless}}'

# Replace the container name with the live tenant name from podman ps.
sudo -u dsh-enterprise env XDG_RUNTIME_DIR=/run/user/996 \
  podman exec <tenant-container> /opt/node24/bin/node -e '
    const net = require("node:net");
    const probe = (host, port) => new Promise(resolve => {
      const socket = net.connect({ host, port, timeout: 2000 });
      socket.on("connect", () => { socket.destroy(); resolve("CONNECTED"); });
      socket.on("timeout", () => { socket.destroy(); resolve("TIMEOUT"); });
      socket.on("error", error => resolve(error.code));
    });
    console.log(await probe("10.0.2.2", 3080));
  '
```

Expected evidence:

- `Rootless=true`
- `10.0.2.2:3080` returns `ENETUNREACH`, `ECONNREFUSED`, or `ETIMEDOUT`
- `/opt/deepseek-harness/.enterprise-data` does not exist in the container
- `/var/run/docker.sock` does not exist in the container
- `/var/lib/dsh-enterprise-tenants/<another-team>` does not exist in the container
- Writing outside the tenant root fails with a read-only filesystem
- Writing inside the tenant root succeeds
- A missing, suspended, or unauthenticated team receives no tenant redirect
- A cross-team URL receives `403 tenant_forbidden`
- A guest cookie no longer grants a workspace
- The tenant's memory and PID cgroup files contain the configured limits

## Operational notes

- Run `podman ps --filter label=io.deepseek.enterprise.tenant` to inspect live tenants.
- Run `journalctl -u deepseek-harness-web` for control-plane lifecycle messages; tenant logs are forwarded through the container's stdout/stderr ring.
- On a crash, stale labelled containers are removed on the next manager start. Data directories are never removed automatically.
- Back up `.enterprise-data`, tenant roots, `session.key`, and `credential.key` together. The template Home contains model credentials and must be backed up separately with owner-only permissions.

## Residual risks

- A container escape or kernel privilege-escalation bug remains a host compromise; keep the kernel, Podman, crun, and container image patched.
- External egress allows data exfiltration by a tenant user. Apply an egress proxy when the deployment must restrict destinations.
- `slirp4netns` blocks host loopback, not host services bound to non-loopback addresses. Bind administrative and data services to loopback or enforce a host firewall outside the tenant container.
- The host currently delegates only memory and PID cgroups to the rootless user manager. CPU denial of service is mitigated by process and container caps but is not a hard per-container CPU quota.
- Team members intentionally share a sandbox. If the product requires per-member confidentiality, allocate one tenant per member instead of one tenant per team.
- Build-time dependencies in the image and the mounted application tree are trusted code. Tenant code is not trusted.
