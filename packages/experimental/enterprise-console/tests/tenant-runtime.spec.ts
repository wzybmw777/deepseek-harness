import { dirname, join, resolve } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { spawn } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  podmanRootlessProbeArgs,
  redactTenantRuntimeText,
  tenantContainerName,
  tenantContainerRunArgs,
  tenantRuntimePatch,
  TenantRuntimeManager,
  type TenantRuntimeConfig,
} from '../src/tenant-runtime.ts'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

const managers = new Set<TenantRuntimeManager>()
const directories: string[] = []

afterEach(async () => {
  for (const manager of managers) await manager.close()
  managers.clear()
  for (const directory of directories) await rm(directory, { recursive: true, force: true })
  directories.length = 0
  vi.restoreAllMocks()
  vi.mocked(spawn).mockReset()
})

const config: TenantRuntimeConfig = {
  root: '/var/lib/dsh-enterprise-tenants',
  publicOrigin: 'https://dev.echoai.best',
  dshEntry: '/opt/deepseek-harness/apps/cli/lib/bin.js',
  sourceRoot: '/opt/deepseek-harness',
  templateHome: '/var/lib/dsh-enterprise/.dsh',
  profile: 'web',
  pluginRoot: '/var/lib/dsh-enterprise/.enterprise-data/plugins',
  portStart: 41_000,
  portEnd: 41_999,
  maxProcesses: 16,
  idleTimeoutMinutes: 30,
  startTimeoutMs: 90_000,
  containerImage: 'localhost/dsh-enterprise-tenant:local',
  podman: 'podman',
  containerMemoryMb: 1024,
  containerPids: 512,
}

async function startupManager(startTimeoutMs = config.startTimeoutMs) {
  vi.spyOn(process, 'getuid').mockReturnValue(1000)
  vi.spyOn(process, 'getgid').mockReturnValue(1000)
  const directory = await mkdtemp(join(tmpdir(), 'dsh-tenant-startup-'))
  directories.push(directory)
  const manager = new TenantRuntimeManager({
    config: { ...config, root: join(directory, 'tenants'), pluginRoot: join(directory, 'plugins'),
      dshEntry: join(directory, 'missing-entry'), startTimeoutMs },
    pluginPolicy: () => ({ managedBuiltins: [], enabledBuiltins: [], enterprisePlugins: [] }),
    logger: { info: vi.fn(), warn: vi.fn() },
  })
  managers.add(manager)
  return manager
}

describe.skipIf(process.getuid === undefined || process.getgid === undefined)('tenant startup preparation', () => {
  it('retries the platform check after a temporary Podman failure', async () => {
    const manager = await startupManager()
    let attempt = 0
    vi.mocked(spawn).mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true),
      })
      const current = ++attempt
      queueMicrotask(() => {
        if (current === 2) child.stdout.emit('data', 'true\n')
        child.emit('close', current === 1 ? 1 : 0, null)
      })
      return child as never
    })
    await expect(manager.ensureTenant({ id: 'team-a', slug: 'acme' } as never)).rejects.toThrow('rootless Podman probe failed')
    await expect(manager.ensureTenant({ id: 'team-a', slug: 'acme' } as never)).rejects.toThrow('required mount source is missing')
    expect(spawn).toHaveBeenCalledTimes(3)
    expect(spawn).toHaveBeenNthCalledWith(2, config.podman, podmanRootlessProbeArgs(), { stdio: ['ignore', 'pipe', 'pipe'] })
  })

  it('bounds preparation commands with the configured startup timeout', async () => {
    const manager = await startupManager(50)
    const kill = vi.fn(() => true)
    vi.mocked(spawn).mockReturnValue(Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(), kill,
    }) as never)
    await expect(manager.ensureTenant({ id: 'team-a', slug: 'acme' } as never)).rejects.toThrow('timed out after 50 ms')
    expect(kill).toHaveBeenCalledWith('SIGKILL')
  })
})

describe('tenant container launch contract', () => {
  it('advertises tenant assets under the configured public subpath', () => {
    const args = tenantContainerRunArgs({
      config: { ...config, publicPathPrefix: '/preview' },
      teamId: 'team-a', slug: 'acme', port: 41_000,
      containerName: 'dsh-tenant-team-a-0123abcd', uid: 996, gid: 995,
    })
    expect(args.at(-1)).toContain('https://dev.echoai.best/preview/t/acme/harness/')
  })

  it('uses rootless Podman with deny-by-default container controls', () => {
    expect(podmanRootlessProbeArgs()).toEqual(['info', '--format', '{{.Host.Security.Rootless}}'])

    const args = tenantContainerRunArgs({
      config,
      teamId: 'team-a',
      slug: 'acme',
      port: 41_000,
      containerName: 'dsh-tenant-team-a-0123abcd',
      uid: 996,
      gid: 995,
    })

    expect(args).toContain('--rm')
    expect(args).toContain('--pull=never')
    expect(args).toContain('--name=dsh-tenant-team-a-0123abcd')
    expect(args).toContain('--label=io.deepseek.enterprise.tenant=team-a')
    expect(args).toContain('--userns=keep-id')
    expect(args).toContain('--user=996:995')
    expect(args).toContain('--read-only')
    expect(args).toContain('--cap-drop=ALL')
    expect(args).toContain('--security-opt=no-new-privileges')
    expect(args).toContain('--pids-limit=512')
    expect(args).toContain('--memory=1024m')
    expect(args).toContain('--memory-swap=1024m')
    expect(args).toContain('--tmpfs=/tmp:rw,nosuid,nodev,size=256m,mode=1777')
    expect(args).toContain('--network=slirp4netns:allow_host_loopback=false')
    expect(args).toContain('--publish=127.0.0.1:41000:41000')
    expect(args).not.toContain('--privileged')
    expect(args.join('\n')).not.toContain('docker.sock')
    expect(args).toContain('--mount=type=bind,src=/var/lib/dsh-enterprise/.enterprise-data/plugins,dst=/var/lib/dsh-enterprise/.enterprise-data/plugins,ro')
    expect(args).not.toContain('--mount=type=bind,src=/var/lib/dsh-enterprise/.enterprise-data,dst=/var/lib/dsh-enterprise/.enterprise-data')
  })

  it('mounts only the application tree and that team root', () => {
    const args = tenantContainerRunArgs({
      config,
      teamId: 'team-a',
      slug: 'acme',
      port: 41_000,
      containerName: 'dsh-tenant-team-a-0123abcd',
      uid: 996,
      gid: 995,
    })
    const mounts = args.filter(value => value.startsWith('--mount='))

    expect(mounts).toContain('--mount=type=bind,src=/var/lib/dsh-enterprise-tenants/team-a,dst=/var/lib/dsh-enterprise-tenants/team-a')
    expect(mounts).toContain(`--mount=type=bind,src=${resolve(dirname(process.execPath), '..')},dst=/opt/node24,ro`)
    expect(mounts).toContain('--mount=type=bind,src=/opt/deepseek-harness/node_modules,dst=/opt/deepseek-harness/node_modules,ro')
    expect(mounts).toContain('--mount=type=bind,src=/opt/deepseek-harness/packages,dst=/opt/deepseek-harness/packages,ro')
    expect(mounts).toContain('--mount=type=bind,src=/opt/deepseek-harness/apps,dst=/opt/deepseek-harness/apps,ro')
    expect(mounts).toContain('--mount=type=bind,src=/opt/deepseek-harness/package.json,dst=/opt/deepseek-harness/package.json,ro')
    expect(mounts).not.toContain('--mount=type=bind,src=/opt/deepseek-harness,dst=/opt/deepseek-harness,ro')
  })

  it('starts DSH on container loopback behind the published-port relay', () => {
    const args = tenantContainerRunArgs({
      config,
      teamId: 'team-a',
      slug: 'acme',
      port: 41_000,
      containerName: 'dsh-tenant-team-a-0123abcd',
      uid: 996,
      gid: 995,
    })
    const command = args.at(-1)

    expect(args.slice(-3, -1)).toEqual(['/bin/bash', '-ceu'])
    expect(command).toContain('socat')
    expect(command).toContain('TCP-LISTEN:41000,bind=0.0.0.0,reuseaddr,fork')
    expect(command).toContain('TCP:127.0.0.1:3000')
    expect(command).toContain('--host')
    expect(command).toContain('127.0.0.1')
    expect(command).toContain('--port')
    expect(command).toContain('3000')
    expect(command).toContain('https://dev.echoai.best/t/acme/harness/')
  })
})

describe('tenant runtime helpers', () => {
  it('keeps the tenant patch to product entry points the console owns', () => {
    expect(tenantRuntimePatch(
      '/var/lib/dsh-enterprise-tenants/team-a/documents',
      '/opt/deepseek-harness/packages/experimental/enterprise-console/lib/tenant-tool-policy.js',
    )).toBe([
      '- id: ui-plugin-manager',
      '  disabled: true',
      '- id: tool-plugin-manager',
      '  disabled: true',
      '- id: workspace-controller',
      '  config:',
      '    documentsDirectory: "/var/lib/dsh-enterprise-tenants/team-a/documents"',
      '- insert:',
      '    - id: enterprise-product-chat',
      '      name: "/opt/deepseek-harness/packages/experimental/enterprise-console/lib/tenant-product-chat.js"',
      '    - id: enterprise-tenant-tool-policy',
      '      name: "/opt/deepseek-harness/packages/experimental/enterprise-console/lib/tenant-tool-policy.js"',
      '',
    ].join('\n'))
  })

  it('builds safe container names and rejects malformed suffixes', () => {
    expect(tenantContainerName('team-a', '0123abcd')).toBe('dsh-tenant-team-a-0123abcd')
    expect(() => tenantContainerName('team-a', 'not-a-nonce')).toThrow('invalid container nonce')
    expect(() => tenantContainerName('team/a', '0123abcd')).toThrow('invalid team id')
  })

  it('redacts launch tokens, model keys, and tenant cookies from failures', () => {
    const message = redactTenantRuntimeText(
      '?token=secret sk-123456789abcdef dsh-auth-internal=value',
    )
    expect(message).toBe('?token=<redacted> sk-<redacted> dsh-auth-internal=<redacted>')
  })
})
