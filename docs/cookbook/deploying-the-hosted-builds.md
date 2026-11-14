---
description: "Deploy the hosted enterprise web app, its tenant runtimes, and the Windows desktop update feed."
---

# Cookbook: deploy the hosted builds

English | [中文](deploying-the-hosted-builds.zh.md)

## Summary

Use this runbook after `master` reaches the deployment. It orders the rebuilds, the service restart, tenant cold start, desktop packaging, update-feed publication, and the checks that prove a change reached the running process. Its central rule is that the enterprise frontend, the client bundles in `lib/client.js`, and the host bundles in `lib/index.js` deploy as one set; shipping one while another is stale is how this deployment has silently changed data behavior.

Commands name the operator's SSH aliases: `server-162` is the application host, and the edge host is the machine behind the public address that fronts `dev.echoai.best`.

## Table of Contents

- [1. Map the deployment](#map)
- [2. Rebuild in dependency order](#rebuild)
- [3. Restart and wait for tenant boot](#restart)
- [4. Package and publish the desktop build](#desktop)
- [5. Verify the deployment](#verify)
- [6. Startup cost and the enter experience](#startup)
- [Troubleshooting](#troubleshooting)
- [Further Exploration](#further-exploration)

<a id="map"></a>
## 1. Map the deployment

Two hosts share one public address, and browsers never reach the application host directly:

| Hop | Role | SSH target |
|---|---|---|
| Edge host | Terminates TLS for `dev.echoai.best`, serves `/enterprise/`, `/t/`, and the desktop update feed | `ssh -p 22 root@<public-ip>` |
| Application host | Builds host and client bundles, serves the enterprise app, runs tenant containers | `ssh server-162` (port 2222) |

- The request path is browser → edge nginx → frp port `<public-ip>:25203` → `127.0.0.1:3080` on the application host.
- `deepseek-harness-web.service` runs `dsh --profile web` as `dsh-enterprise`, reads the console from `DSH_ENTERPRISE_DIST=/opt/deepseek-harness/apps/enterprise/dist`, and keeps tenant state under `/var/lib/dsh-enterprise-tenants`.
- Each team gets one rootless podman container named `dsh-tenant-<team>-<nonce>`, started on its first authenticated request.

<a id="rebuild"></a>
## 2. Rebuild in dependency order

Each artifact consumes the one before it, so rebuild in the order listed:

| Artifact | Command from `/opt/deepseek-harness` | Output |
|---|---|---|
| Host packages | `node_modules/.bin/tsx scripts/compile-referenced-projects.ts host-libraries` | `packages/*/*/lib/index.js` |
| Client packages | `node_modules/.bin/tsc -b tsconfig.client.json`, then `node_modules/.bin/tsdown --config-loader native --env.DSH_BUILD_FACE client` | `packages/*/*/lib/client.js` |
| Enterprise frontend | `cd apps/enterprise && ../../node_modules/.bin/vite build` | `apps/enterprise/dist` |

Prefix every command with `PATH=/opt/node24/bin:$PATH`. When only one client package changed, its package-local `tsdown` rebuilds just that bundle:

```sh
cd /opt/deepseek-harness/packages/experimental/client-ui-enterprise-resources
PATH=/opt/node24/bin:$PATH /opt/deepseek-harness/node_modules/.bin/tsdown
```

That shortcut covers the client bundle only. Host packages have no package-local entry point, because the root `tsdown` run maps each `lib/types/index.js` to `lib/index.js`.

The failure this order prevents is silent. A deployed frontend and client bundle once ran on host bundles from an earlier build: `command/run` events arrived without `conversation: true`, `session/list` kept every agent conversation `blank: true`, and the sidebar dropped the conversation after the first message. The page looked current because the markup was current; only the host-side data behavior was old.

<a id="restart"></a>
## 3. Restart and wait for tenant boot

The console reads `apps/enterprise/dist` from disk on each request, so a frontend-only change needs no restart. Host and client bundle changes do:

```sh
ssh server-162
systemctl restart deepseek-harness-web.service
systemctl is-active deepseek-harness-web.service
```

After a restart, the gateway answers 502 for the first authenticated request to a team until that tenant container finishes booting, which takes 30–40 seconds. Reload the page instead of restarting again; a second restart discards the container that was already booting. The console now renders the enter screen and polls the launch status, so the browser no longer waits on a single 303 with no feedback.

<a id="desktop"></a>
## 4. Package and publish the desktop build

Desktop releases are built on Windows and published to the edge host. The [web shell README](../../apps/desktop/web-shell/README.md) owns the artifact contract and update behavior.

1. Increment `version` in `apps/desktop/web-shell/package.json`; never reuse a published version.
2. Set `HTTP_PROXY` and `HTTPS_PROXY` to the build machine's proxy when it needs one, because electron-builder downloads the winCodeSign toolchain and otherwise waits out a 600-second timeout.
3. From `apps/desktop/web-shell`, run `node_modules\.bin\electron-builder.cmd --config electron-builder.cjs --win nsis --x64 --publish never`.
4. Copy `Zhiliu-Setup-<version>-x64.exe` and its `.blockmap` to `/var/www/zhiliu-desktop-updates/windows/x64/` on the edge host.
5. Back up `latest.yml`, upload the new manifest as `latest.yml.next`, then rename it to `latest.yml`, so no client reads a manifest before its installer exists.

<a id="verify"></a>
## 5. Verify the deployment

Check the running deployment, not the working tree:

- Both host bundles carry the conversation marker: `grep -c 'conversation === true' packages/api/session-controller/lib/index.js` and the same command for `packages/interaction/commands/lib/index.js` print `2`.
- A sent message survives a reload: send one message to an agent, reload the page, and confirm the conversation remains in the sidebar.
- The console serves the new frontend: `ls -l apps/enterprise/dist/assets` shows fresh hashed assets, and a hard reload shows the new layout.
- The feed advertises the new build: `curl -s https://dev.echoai.best/desktop-updates/windows/x64/latest.yml` names the new version, and `openssl dgst -sha512 -binary Zhiliu-Setup-<version>-x64.exe | base64 -w0` matches its `sha512` field.

<a id="startup"></a>
## 6. Startup cost and the enter experience

Almost all of the wait is tenant container cold start; the console only has to move the browser to `/t/<slug>/harness/`. Three settings keep that wait short on this deployment:

1. **systemd drop-in** `/etc/systemd/system/deepseek-harness-web.service.d/10-startup.conf`: start `node apps/cli/lib/bin.js` directly to skip the `pnpm` wrapper, which re-runs a dependency install check on every boot; enable `NODE_COMPILE_CACHE`; and set `DSH_ENTERPRISE_TENANT_IDLE_MINUTES=180` so an idle tenant survives three hours and repeat visits never cold start.
2. **Tenant compile cache**: `tenant-runtime` injects `NODE_COMPILE_CACHE=<team home>/.node-compile-cache` into every container. The directory lives inside the writable tenant root, so rebuilding the host bundles refills it on the next start.
3. **Enter screen**: the console requests `GET /enterprise/api/harness/launch?wait=0` (202, start continues in the background), then polls `GET /enterprise/api/harness/status` until `state: ready` and navigates to `readyUrl`. Meanwhile the page shows the current stage, the elapsed seconds, and a progress bar.

Verify with:

```sh
journalctl -u deepseek-harness-web.service --since '-5 min' | grep -E 'Started|dsh web:'
du -sh /var/lib/dsh-enterprise/.node-compile-cache
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/enterprise/api/harness/status
```

The gap between `Started` and `dsh web:` is the console's own startup, now usually 10–20 seconds without `pnpm`. Unauthenticated `status` must answer 401.

Note that a tenant boot is CPU-bound, roughly 40–80 CPU seconds per start. When host load average approaches or exceeds the core count, the observed wait multiplies; that is host contention rather than a slow launch path, so clear unrelated high-CPU processes before restarting the service again.

<a id="troubleshooting"></a>
## Troubleshooting

| Symptom | Cause | Action |
|---|---|---|
| 502 immediately after a restart | The tenant container is still booting | Wait 30–40 seconds and reload; do not restart the service again |
| An agent conversation disappears after sending | A stale host bundle in `lib/index.js` | Rebuild the host packages, then confirm the marker count |
| The page still shows the old layout | A stale `apps/enterprise/dist` or a cached document | Rebuild the frontend, hard-reload, and confirm the asset hash changed |
| electron-builder stalls while downloading winCodeSign | The build machine has no proxy | Set `HTTP_PROXY` and `HTTPS_PROXY`, then rerun |
| A build blocks on `.git/dsh-lefthook-install.lock` | Another repository install is running | Run the binary under `node_modules/.bin` directly, or remove the lock only after confirming no install process is alive |

<a id="further-exploration"></a>
## Further Exploration

- [Web shell README](../../apps/desktop/web-shell/README.md) — update feed, checksum verification, installer behavior, and the download service.
- [Publish the Web UI behind a reverse proxy](../user/guide/public-deployments.md) — what `--public-url` and `--trusted-host` advertise and admit.
- [Tenant isolation](../../packages/experimental/enterprise-console/docs/TENANT-ISOLATION.md) — container mounts, ownership, and tenant data boundaries.

<a id="dev-note"></a>
## Dev Note

None.
