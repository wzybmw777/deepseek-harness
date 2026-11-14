/** One rootless container and one private Harness home per enterprise team. */

import { randomBytes } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { chmod, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createServer, request as httpRequest } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dump, load } from 'js-yaml'
import type { TeamRecord } from './types.ts'
import { applyTenantPluginPolicy, type TenantPluginPolicy } from './plugin-policy.ts'
import { tenantHarnessPath } from './tenant-paths.ts'

const CONTAINER_PORT = 3000
const CONTAINER_TMP_BYTES = '256m'
const OUTPUT_LIMIT_BYTES = 65_536
const TERMINATION_GRACE_MILLISECONDS = 5_000
const STDERR_RING_BYTES = 16_384
const TOKEN_LINE = /^dsh web:\s+(\S+)\s*$/u
const TENANT_LABEL = 'io.deepseek.enterprise.tenant'
const NODE_DESTINATION = '/opt/node24'
const NODE_BINARY = `${NODE_DESTINATION}/bin/node`
const NODE_COMPILE_CACHE_DIRECTORY = '.node-compile-cache'
const TENANT_TOOL_POLICY_ENTRY = fileURLToPath(new URL('../lib/tenant-tool-policy.js', import.meta.url))

/** Deployment settings for the tenant container pool. */
export interface TenantRuntimeConfig {
  /** Private directory containing one subdirectory per team. */
  readonly root: string
  /** Browser-facing origin used in each tenant's advertised URL. */
  readonly publicOrigin: string
  /** Public proxy prefix; omitted preserves the root mount. */
  readonly publicPathPrefix?: string
  /** Built `apps/cli/lib/bin.js` entry. */
  readonly dshEntry: string
  /** Repository build tree whose application directories are mounted read-only. */
  readonly sourceRoot: string
  /** Harness home whose profile and credential references seed a new tenant. */
  readonly templateHome: string
  /** Profile name shared by tenant containers. */
  readonly profile: string
  /** Shared read-only package root containing enterprise-added plugins. */
  readonly pluginRoot: string
  /** First loopback port considered for a tenant container. */
  readonly portStart: number
  /** Last loopback port considered for a tenant container. */
  readonly portEnd: number
  /** Maximum simultaneously running tenant containers. */
  readonly maxProcesses: number
  /** Stop a container after this many minutes without an active request or socket. */
  readonly idleTimeoutMinutes: number
  /** Maximum time per preparation command and from container start to authenticated readiness. */
  readonly startTimeoutMs: number
  /** Rootless container image. */
  readonly containerImage: string
  /** Podman executable. */
  readonly podman: string
  /** Hard memory ceiling in MiB. */
  readonly containerMemoryMb: number
  /** Hard PID ceiling. */
  readonly containerPids: number
}

/** Read-only readiness snapshot for one team container. */
export interface TenantRuntimeStatus {
  /** Whether the container is absent, starting, or serving requests. */
  readonly state: 'stopped' | 'starting' | 'ready'
  /** Milliseconds since the current start began, when one is in flight or complete. */
  readonly elapsedMs?: number
}

/** One authenticated route to a running tenant container. */
export interface TenantRuntimeLease {
  /** Host loopback port owned by this tenant container. */
  readonly port: number
  /** Internal DSH browser-auth cookie; never sent to the browser. */
  readonly cookie: string
  /**
   * Mark one HTTP request or upgraded socket active.
   * @returns an idempotent release function for the active count.
   */
  begin(): () => void
}

/** Minimal logger consumed by the tenant container pool. */
export interface TenantRuntimeLogger {
  /** Record a lifecycle transition without secrets. */
  info(message: string): void
  /** Record a redacted lifecycle failure. */
  warn(error: Error): void
}

/** Public construction settings for the tenant container pool. */
export interface TenantRuntimeManagerOptions {
  /** Deployment and container-lifecycle settings. */
  readonly config: TenantRuntimeConfig
  /** Current enterprise plugin policy applied before each tenant starts. */
  readonly pluginPolicy: () => TenantPluginPolicy
  /** Destination for lifecycle messages and redacted failures. */
  readonly logger: TenantRuntimeLogger
}

interface RuntimeOptions extends TenantRuntimeManagerOptions {
  readonly ports: Set<number>
  readonly releasePort: (port: number) => void
  readonly isClosed: () => boolean
  readonly uid: number
  readonly gid: number
}

interface CredentialsFile {
  readonly version?: number
  readonly records?: Record<string, unknown>
  readonly refs?: Record<string, unknown>
}

interface PodmanResult {
  readonly stdout: string
  readonly stderr: string
}

/** Inputs that determine one podman run command. */
export interface TenantContainerLaunch {
  /** Runtime deployment settings. */
  readonly config: TenantRuntimeConfig
  /** Durable team identifier used in the container label. */
  readonly teamId: string
  /** Public team slug used in the advertised URL. */
  readonly slug: string
  /** Host loopback port published for the control plane. */
  readonly port: number
  /** Unique container name. */
  readonly containerName: string
  /** Unprivileged service UID. */
  readonly uid: number
  /** Unprivileged service GID. */
  readonly gid: number
}

/** Replace process credentials and model keys before a failure reaches logs. */
export function redactTenantRuntimeText(value: string): string {
  return value
    .replace(/([?&]token=)[^&\s]+/gu, '$1<redacted>')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, 'sk-<redacted>')
    .replace(/(dsh-auth-[A-Za-z0-9_-]+=)[^;\s]+/gu, '$1<redacted>')
}

/**
 * Build the per-team Loader patch applied after the shared Web profile.
 * @param documents - private tenant documents directory exposed to the workspace controller.
 * @param toolPolicyPluginEntry - built tenant tool-policy entry.
 * @returns YAML with the workspace root and the tenant product plugins.
 */
export function tenantRuntimePatch(
  documents: string,
  toolPolicyPluginEntry = TENANT_TOOL_POLICY_ENTRY,
): string {
  return [
    '- id: ui-plugin-manager',
    '  disabled: true',
    '- id: tool-plugin-manager',
    '  disabled: true',
    '- id: workspace-controller',
    '  config:',
    `    documentsDirectory: ${JSON.stringify(documents)}`,
    '- insert:',
    '    - id: enterprise-product-chat',
    `      name: ${JSON.stringify(resolve(dirname(toolPolicyPluginEntry), 'tenant-product-chat.js'))}`,
    '    - id: enterprise-tenant-tool-policy',
    `      name: ${JSON.stringify(toolPolicyPluginEntry)}`,
    '',
  ].join('\n')
}

/** Return the rootless-mode probe arguments. */
export function podmanRootlessProbeArgs(): string[] {
  return ['info', '--format', '{{.Host.Security.Rootless}}']
}

/**
 * Build a unique, label-safe container name.
 * @param teamId - durable team identifier.
 * @param nonce - lowercase hexadecimal suffix.
 * @returns a podman container name.
 */
export function tenantContainerName(teamId: string, nonce: string): string {
  assertPrivateIdentifier(teamId, 'team id')
  if (!/^[a-f0-9]{4,32}$/u.test(nonce)) throw new Error('tenant runtime: invalid container nonce')
  return `dsh-tenant-${teamId}-${nonce}`
}

/**
 * Build the complete rootless container command.
 * @param launch - team, port, identity, and deployment settings.
 * @returns podman arguments without a shell.
 */
export function tenantContainerRunArgs(launch: TenantContainerLaunch): string[] {
  const config = launch.config
  const tenantRoot = join(config.root, launch.teamId)
  const home = join(tenantRoot, 'home')
  const workspace = join(tenantRoot, 'documents', 'deepseek-harness', 'default-workspace')
  const runtimePatch = join(tenantRoot, 'runtime.patch.yml')
  const publicUrl = new URL(`${config.publicPathPrefix ?? ''}${tenantHarnessPath(launch.slug)}`, config.publicOrigin).href
  const nodeRoot = resolve(dirname(process.execPath), '..')
  const command = [
    `/usr/bin/socat ${shellQuote(`TCP-LISTEN:${String(launch.port)},bind=0.0.0.0,reuseaddr,fork`)} `
      + `${shellQuote(`TCP:127.0.0.1:${String(CONTAINER_PORT)}`)} >/tmp/dsh-tenant-socat.log 2>&1 &`,
    [
      'exec', NODE_BINARY, config.dshEntry,
      '--profile', config.profile,
      '--patch', runtimePatch,
      '--no-open',
      '--host', '127.0.0.1',
      '--port', String(CONTAINER_PORT),
      '--public-url', publicUrl,
    ].map(shellQuote).join(' '),
  ].join(' ')
  const args = [
    'run',
    '--rm',
    '--pull=never',
    `--name=${launch.containerName}`,
    `--label=${TENANT_LABEL}=${launch.teamId}`,
    '--userns=keep-id',
    `--user=${String(launch.uid)}:${String(launch.gid)}`,
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    `--pids-limit=${String(config.containerPids)}`,
    `--memory=${String(config.containerMemoryMb)}m`,
    `--memory-swap=${String(config.containerMemoryMb)}m`,
    `--tmpfs=/tmp:rw,nosuid,nodev,size=${CONTAINER_TMP_BYTES},mode=1777`,
    '--network=slirp4netns:allow_host_loopback=false',
    `--publish=127.0.0.1:${String(launch.port)}:${String(launch.port)}`,
    `--workdir=${workspace}`,
    bindMount(tenantRoot, tenantRoot),
    bindMount(config.pluginRoot, config.pluginRoot, true),
    bindMount(nodeRoot, NODE_DESTINATION, true),
    ...readOnlyApplicationMounts(config.sourceRoot),
    ...containerEnvironment(home).map(value => `--env=${value}`),
    config.containerImage,
    '/bin/bash',
    '-ceu',
    command,
  ]
  return args
}

function bindMount(source: string, destination: string, readOnly = false): string {
  return `--mount=type=bind,src=${source},dst=${destination}${readOnly ? ',ro' : ''}`
}

function readOnlyApplicationMounts(sourceRoot: string): string[] {
  return [
    join(sourceRoot, 'node_modules'),
    join(sourceRoot, 'packages'),
    join(sourceRoot, 'apps'),
    join(sourceRoot, 'native'),
    join(sourceRoot, 'vendor'),
    join(sourceRoot, 'package.json'),
    join(sourceRoot, 'pnpm-workspace.yaml'),
  ].map(path => bindMount(path, path, true))
}

function containerEnvironment(home: string): string[] {
  const allowed = [
    'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TERM', 'NODE_ENV', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
    'http_proxy', 'https_proxy', 'no_proxy', 'DSH_TELEMETRY_DISABLED', 'DSH_PRODUCT_ANALYTICS_OTLP_URL',
    'DSH_PERMISSION_MODE',
  ] as const
  const env: string[] = []
  for (const name of allowed) {
    const value = process.env[name]
    if (value !== undefined) env.push(`${name}=${value}`)
  }
  env.push(
    `HOME=${home}`,
    `DSH_HOME=${home}`,
    `NODE_COMPILE_CACHE=${join(home, NODE_COMPILE_CACHE_DIRECTORY)}`,
    `TMPDIR=${join(home, 'tmp')}`,
    `XDG_CONFIG_HOME=${join(home, '.config')}`,
    `XDG_DATA_HOME=${join(home, '.local', 'share')}`,
    `XDG_CACHE_HOME=${join(home, '.cache')}`,
    `XDG_STATE_HOME=${join(home, '.local', 'state')}`,
    `PATH=${NODE_DESTINATION}/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
    'USER=dsh-enterprise',
    'LOGNAME=dsh-enterprise',
    'SHELL=/bin/bash',
  )
  return env
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, '\'\\\'\'')}'`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertPrivateIdentifier(value: string, name: string): void {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error(`tenant runtime: invalid ${name}`)
}

async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  await chmod(path, 0o700)
}

async function privateFile(path: string, body: string): Promise<void> {
  await writeFile(path, body, { mode: 0o600 })
  await chmod(path, 0o600)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function freeLoopbackPort(start: number, end: number, reserved: ReadonlySet<number>): Promise<number> {
  for (let port = start; port <= end; port += 1) {
    if (reserved.has(port)) continue
    const available = await new Promise<boolean>((resolve, reject) => {
      const probe = createServer()
      probe.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') resolve(false)
        else reject(error)
      })
      probe.listen(port, '127.0.0.1', () => { probe.close(() => { resolve(true) }) })
    })
    if (available) return port
  }
  throw new Error(`tenant runtime: no free loopback port in ${String(start)}-${String(end)}`)
}

function runPodman(executable: string, args: string[], timeoutMs: number): Promise<PodmanResult> {
  return new Promise<PodmanResult>((resolveResult, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (error === undefined) resolveResult({ stdout, stderr })
      else reject(error)
    }
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      finish(new Error(`tenant runtime: podman command timed out after ${String(timeoutMs)} ms`))
    }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout = (stdout + chunk).slice(-OUTPUT_LIMIT_BYTES) })
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-OUTPUT_LIMIT_BYTES) })
    child.once('error', (error) => {
      finish(new Error(`tenant runtime: could not run podman: ${redactTenantRuntimeText(error.message)}`))
    })
    child.once('close', (code, signal) => {
      if (code === 0) {
        finish()
        return
      }
      const detail = stderr.trim() === '' ? '' : `: ${redactTenantRuntimeText(stderr.trim())}`
      finish(new Error(`tenant runtime: podman exited with ${signal ?? String(code)}${detail}`))
    })
  })
}

function missingContainer(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return message.includes('no such container') || message.includes('no container with name or id')
}

/** Owns one lazily started rootless container for a team. */
class TenantRuntimeProcess {
  private child: ChildProcess | undefined
  private containerName: string | undefined
  private port: number | undefined
  private cookie: string | undefined
  private slug: string
  private starting: Promise<void> | undefined
  private active = 0
  private lastUsed = Date.now()
  private stopping = false
  private startedAt: number | undefined
  private stderr = ''

  constructor(
    private readonly options: RuntimeOptions,
    private readonly team: TeamRecord,
  ) {
    this.slug = team.slug
  }

  get isReady(): boolean {
    return this.child !== undefined && this.cookie !== undefined && this.port !== undefined
  }

  get isIdle(): boolean {
    return this.active === 0 && Date.now() - this.lastUsed >= this.options.config.idleTimeoutMinutes * 60_000
  }

  get isStarting(): boolean {
    return this.starting !== undefined
  }

  get startedAtMs(): number | undefined {
    return this.startedAt
  }

  async ensure(slug: string): Promise<TenantRuntimeLease> {
    if (slug !== this.slug) {
      this.slug = slug
      if (this.isReady) await this.stop()
    }
    if (this.isReady) return this.lease()
    if (this.starting === undefined) {
      this.startedAt = Date.now()
      this.starting = this.start().finally(() => { this.starting = undefined })
    }
    await this.starting
    return this.lease()
  }

  private lease(): TenantRuntimeLease {
    if (this.port === undefined || this.cookie === undefined) {
      throw new Error('tenant runtime: lease requested before readiness')
    }
    const port = this.port
    const cookie = this.cookie
    return {
      port,
      cookie,
      begin: () => {
        this.active += 1
        this.lastUsed = Date.now()
        let released = false
        return () => {
          if (released) return
          released = true
          this.active = Math.max(0, this.active - 1)
          this.lastUsed = Date.now()
        }
      },
    }
  }

  private async start(): Promise<void> {
    await this.prepareHome()
    if (this.options.isClosed()) throw new Error('tenant runtime: manager is closed')
    const port = await freeLoopbackPort(this.options.config.portStart, this.options.config.portEnd, this.options.ports)
    this.options.ports.add(port)
    this.port = port
    this.containerName = tenantContainerName(this.team.id, randomBytes(6).toString('hex'))
    this.options.logger.info(`enterprise tenant ${this.team.id}: starting rootless container ${this.containerName}`)
    try {
      const token = await this.startUntilToken(port)
      this.cookie = await this.exchangeCookie(port, token)
      this.lastUsed = Date.now()
      this.options.logger.info(`enterprise tenant ${this.team.id}: rootless container ready on loopback`)
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  private async prepareHome(): Promise<void> {
    assertPrivateIdentifier(this.team.id, 'team id')
    const tenantRoot = join(this.options.config.root, this.team.id)
    const home = join(tenantRoot, 'home')
    const documents = join(tenantRoot, 'documents')
    const workspace = join(documents, 'deepseek-harness', 'default-workspace')
    const profile = join(home, 'profiles', this.options.config.profile)
    for (const path of [tenantRoot, home, documents, workspace, join(home, 'tmp'), profile,
      join(home, NODE_COMPILE_CACHE_DIRECTORY), join(home, '.config'), join(home, '.local', 'share'),
      join(home, '.cache'), join(home, '.local', 'state')]) {
      await privateDirectory(path)
    }
    await this.seedProfile(profile)
    await applyTenantPluginPolicy(profile, this.options.pluginPolicy())
    await this.seedCredentials(home)
    await this.seedHomePatch(home)
    const runtimePatch = join(tenantRoot, 'runtime.patch.yml')
    await privateFile(runtimePatch, tenantRuntimePatch(documents))
  }

  private async seedProfile(profile: string): Promise<void> {
    const source = join(this.options.config.templateHome, 'profiles', this.options.config.profile)
    for (const file of ['cordis.yml', 'package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml']) {
      const target = join(profile, file)
      if (await pathExists(target)) continue
      const from = join(source, file)
      if (!await pathExists(from)) {
        if (file === 'pnpm-workspace.yaml') continue
        throw new Error(`tenant runtime: template profile file is missing: ${file}`)
      }
      await copyFile(from, target)
      await chmod(target, 0o600)
    }
  }

  private async seedCredentials(home: string): Promise<void> {
    const target = join(home, '.credentials.yaml')
    if (await pathExists(target)) return
    const source = join(this.options.config.templateHome, '.credentials.yaml')
    if (!await pathExists(source)) throw new Error('tenant runtime: template credentials file is missing')
    let parsed: unknown
    try {
      parsed = load(await readFile(source, 'utf8'))
    } catch (error) {
      throw new Error(`tenant runtime: template credentials file is invalid: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!isRecord(parsed)) throw new Error('tenant runtime: template credentials file is not an object')
    const records = isRecord(parsed.records) ? { ...parsed.records } : {}
    delete records['client-connection/browser-session']
    const refs = isRecord(parsed.refs) ? parsed.refs : {}
    const credentials: CredentialsFile = {
      version: typeof parsed.version === 'number' ? parsed.version : 1,
      ...(Object.keys(records).length === 0 ? {} : { records }),
      ...(Object.keys(refs).length === 0 ? {} : { refs }),
    }
    await privateFile(target, dump(credentials, { noRefs: true }))
  }

  private async seedHomePatch(home: string): Promise<void> {
    const target = join(home, 'cordis.patch.yml')
    if (await pathExists(target)) return
    const source = join(this.options.config.templateHome, 'cordis.patch.yml')
    if (await pathExists(source)) {
      await copyFile(source, target)
      await chmod(target, 0o600)
    }
  }

  private startUntilToken(port: number): Promise<string> {
    const containerName = this.containerName
    if (containerName === undefined) throw new Error('tenant runtime: container name is not allocated')
    const child = spawn(this.options.config.podman, tenantContainerRunArgs({
      config: this.options.config,
      teamId: this.team.id,
      slug: this.slug,
      port,
      containerName,
      uid: this.options.uid,
      gid: this.options.gid,
    }), {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.child = child
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-STDERR_RING_BYTES)
    })

    return new Promise<string>((resolveToken, reject) => {
      let settled = false
      let buffer = ''
      const finish = (error?: Error, token?: string): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (error !== undefined) reject(error)
        else resolveToken(token as string)
      }
      const timeout = setTimeout(() => {
        finish(new Error(`tenant runtime: container did not become ready within ${String(this.options.config.startTimeoutMs)} ms`))
      }, this.options.config.startTimeoutMs)
      child.stdout.on('data', (chunk: string) => {
        if (settled) return
        buffer += chunk
        let newline = buffer.indexOf('\n')
        while (newline !== -1) {
          const line = buffer.slice(0, newline).replace(/\r$/u, '')
          buffer = buffer.slice(newline + 1)
          const match = TOKEN_LINE.exec(line)
          if (match !== null) {
            try {
              const token = new URL(match[1] as string).searchParams.get('token')
              if (token === null || token === '') finish(new Error('tenant runtime: readiness line carried no token'))
              else finish(undefined, token)
            } catch {
              finish(new Error('tenant runtime: readiness line carried an invalid URL'))
            }
          }
          newline = buffer.indexOf('\n')
        }
      })
      child.once('error', (error) => {
        finish(new Error(`tenant runtime: could not start container: ${redactTenantRuntimeText(error.message)}`))
      })
      child.once('exit', (code, signal) => {
        this.child = undefined
        this.cookie = undefined
        const activePort = this.port
        this.port = undefined
        if (activePort !== undefined) this.options.releasePort(activePort)
        if (!settled) {
          const detail = this.stderr.trim()
          finish(new Error(`tenant runtime: container exited before readiness (${signal ?? String(code)})${detail === '' ? '' : `: ${redactTenantRuntimeText(detail)}`}`))
          return
        }
        if (this.stopping) return
        this.options.logger.warn(new Error(`enterprise tenant ${this.team.id}: container exited (${signal ?? String(code)})`))
      })
    })
  }

  private exchangeCookie(port: number, token: string): Promise<string> {
    return new Promise<string>((resolveCookie, reject) => {
      const query = new URLSearchParams({ token }).toString()
      const request = httpRequest({
        host: '127.0.0.1',
        port,
        method: 'GET',
        path: `/?${query}`,
        headers: { host: `127.0.0.1:${String(port)}` },
        agent: false,
      }, (response) => {
        response.resume()
        const values = response.headers['set-cookie']
        const cookie = (values ?? [])
          .map(value => value.split(';', 1)[0]?.trim())
          .find(value => value !== undefined && value.startsWith('dsh-auth-'))
        if (response.statusCode !== 303 || cookie === undefined) {
          reject(new Error(`tenant runtime: launch-token exchange failed with HTTP ${String(response.statusCode)}`))
          return
        }
        resolveCookie(cookie)
      })
      request.once('error', (error) => {
        reject(new Error(`tenant runtime: launch-token exchange failed: ${redactTenantRuntimeText(error.message)}`))
      })
      request.end()
    })
  }

  async stop(): Promise<void> {
    if (this.stopping) return
    this.stopping = true
    const child = this.child
    const containerName = this.containerName
    this.child = undefined
    this.containerName = undefined
    this.cookie = undefined
    this.startedAt = undefined
    const port = this.port
    this.port = undefined
    if (port !== undefined) this.options.releasePort(port)
    try {
      if (containerName !== undefined) await this.stopContainer(containerName)
      if (child !== undefined && child.exitCode === null && child.signalCode === null) {
        const exited = new Promise<void>((resolveExit) => { child.once('exit', () => { resolveExit() }) })
        const terminated = await Promise.race([
          exited.then(() => true),
          new Promise<false>((resolveTimeout) => {
            setTimeout(() => { resolveTimeout(false) }, TERMINATION_GRACE_MILLISECONDS).unref()
          }),
        ])
        if (!terminated) {
          if (containerName !== undefined) await this.forceRemove(containerName)
          child.kill('SIGKILL')
          await Promise.race([
            exited,
            new Promise<void>((resolveTimeout) => { setTimeout(resolveTimeout, 1_000).unref() }),
          ])
        }
      }
    } finally {
      this.stopping = false
    }
  }

  private async stopContainer(containerName: string): Promise<void> {
    try {
      await runPodman(this.options.config.podman, ['stop', '--time', '5', containerName], 12_000)
    } catch (error) {
      if (!missingContainer(error)) {
        this.options.logger.warn(new Error(`enterprise tenant ${this.team.id}: could not stop container: ${redactTenantRuntimeText(error instanceof Error ? error.message : String(error))}`))
      }
    }
  }

  private async forceRemove(containerName: string): Promise<void> {
    try {
      await runPodman(this.options.config.podman, ['rm', '--force', containerName], 12_000)
    } catch (error) {
      if (!missingContainer(error)) {
        this.options.logger.warn(new Error(`enterprise tenant ${this.team.id}: could not remove container: ${redactTenantRuntimeText(error instanceof Error ? error.message : String(error))}`))
      }
    }
  }
}

/** Lazily starts, tracks, and stops rootless tenant containers. */
export class TenantRuntimeManager {
  private readonly runtimes = new Map<string, TenantRuntimeProcess>()
  private readonly ports = new Set<number>()
  private readonly idleTimer: NodeJS.Timeout
  private rootPreparation: Promise<void> | undefined
  private platformPreparation: Promise<void> | undefined
  private creationQueue: Promise<void> = Promise.resolve()
  private closed = false
  private readonly uid: number
  private readonly gid: number

  /**
   * Create a manager over one private tenant directory.
   * @param options - container, profile, port, capacity, and timeout settings.
   */
  constructor(private readonly options: TenantRuntimeManagerOptions) {
    const config = options.config
    if (!(config.portStart > 0 && config.portStart <= config.portEnd && config.portEnd <= 65_535)) {
      throw new Error('tenant runtime: invalid tenant port range')
    }
    if (config.maxProcesses < 1) throw new Error('tenant runtime: maxProcesses must be positive')
    if (config.containerMemoryMb < 1) throw new Error('tenant runtime: container memory limit must be positive')
    if (config.containerPids < 1) throw new Error('tenant runtime: container PID limit must be positive')
    const uid = process.getuid?.()
    const gid = process.getgid?.()
    if (uid === undefined || gid === undefined || uid === 0 || gid === 0) {
      throw new Error('tenant runtime: rootless tenant containers require an unprivileged service identity')
    }
    this.uid = uid
    this.gid = gid
    this.idleTimer = setInterval(() => {
      void this.reapIdle()
    }, 60_000)
    this.idleTimer.unref()
  }

  /**
   * Report a team's container state without starting it.
   * @param team - team whose runtime should be inspected.
   * @returns the readiness snapshot rendered by the launch progress screen.
   */
  status(team: TeamRecord): TenantRuntimeStatus {
    const runtime = this.runtimes.get(team.id)
    if (runtime === undefined) return { state: 'stopped' }
    if (runtime.isReady) return this.snapshot('ready', runtime)
    if (runtime.isStarting) return this.snapshot('starting', runtime)
    return { state: 'stopped' }
  }

  private snapshot(state: 'starting' | 'ready', runtime: TenantRuntimeProcess): TenantRuntimeStatus {
    const startedAt = runtime.startedAtMs
    return startedAt === undefined ? { state } : { state, elapsedMs: Math.max(0, Date.now() - startedAt) }
  }

  /**
   * Return the authenticated lease for a team, starting its container when needed.
   * @param team - current active team record.
   * @returns a ready container lease.
   */
  async ensureTenant(team: TeamRecord): Promise<TenantRuntimeLease> {
    if (this.closed) throw new Error('tenant runtime: manager is closed')
    await this.prepareRoot()
    await this.preparePlatform()
    const runtime = await this.runtimeFor(team)
    try {
      return await runtime.ensure(team.slug)
    } catch (error) {
      await runtime.stop()
      this.runtimes.delete(team.id)
      throw error
    }
  }

  private runtimeFor(team: TeamRecord): Promise<TenantRuntimeProcess> {
    return this.withCreationLock(async () => {
      if (this.closed) throw new Error('tenant runtime: manager is closed')
      const existing = this.runtimes.get(team.id)
      if (existing !== undefined) return existing
      if (this.runtimes.size >= this.options.config.maxProcesses) await this.evictIdle()
      if (this.runtimes.size >= this.options.config.maxProcesses) {
        throw new Error('tenant runtime: tenant container capacity is exhausted')
      }
      const runtime = new TenantRuntimeProcess({
        config: this.options.config,
        pluginPolicy: this.options.pluginPolicy,
        logger: this.options.logger,
        ports: this.ports,
        releasePort: (port) => { this.ports.delete(port) },
        isClosed: () => this.closed,
        uid: this.uid,
        gid: this.gid,
      }, team)
      this.runtimes.set(team.id, runtime)
      return runtime
    })
  }

  /** Stop every tenant container and disable future starts. */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    clearInterval(this.idleTimer)
    await Promise.all([...this.runtimes.values()].map(runtime => runtime.stop()))
    this.runtimes.clear()
  }

  /** Stop running tenants so the next request reloads the current plugin policy. */
  async refresh(): Promise<void> {
    await this.withCreationLock(async () => {
      const runtimes = [...this.runtimes.values()]
      this.runtimes.clear()
      await Promise.all(runtimes.map(runtime => runtime.stop()))
    })
  }

  private async evictIdle(): Promise<void> {
    for (const [id, runtime] of this.runtimes) {
      if (!runtime.isIdle) continue
      await runtime.stop()
      this.runtimes.delete(id)
      if (this.runtimes.size < this.options.config.maxProcesses) return
    }
  }

  private prepareRoot(): Promise<void> {
    this.rootPreparation ??= (async () => {
      await privateDirectory(this.options.config.root)
      await privateDirectory(this.options.config.pluginRoot)
    })()
    return this.rootPreparation
  }

  private preparePlatform(): Promise<void> {
    this.platformPreparation ??= this.verifyPlatform().catch((error: unknown) => {
      this.platformPreparation = undefined
      throw error
    })
    return this.platformPreparation
  }

  private async verifyPlatform(): Promise<void> {
    let rootless: PodmanResult
    try {
      rootless = await runPodman(this.options.config.podman, podmanRootlessProbeArgs(), this.options.config.startTimeoutMs)
    } catch (error) {
      throw new Error(`tenant runtime: rootless Podman probe failed: ${redactTenantRuntimeText(error instanceof Error ? error.message : String(error))}`)
    }
    if (rootless.stdout.trim() !== 'true') {
      throw new Error('tenant runtime: Podman must report Rootless=true')
    }
    try {
      await runPodman(this.options.config.podman, ['image', 'exists', this.options.config.containerImage], this.options.config.startTimeoutMs)
    } catch (error) {
      throw new Error(`tenant runtime: tenant image is unavailable: ${redactTenantRuntimeText(error instanceof Error ? error.message : String(error))}`)
    }
    await this.assertApplicationMounts()
    await this.cleanupStaleContainers()
  }

  private async assertApplicationMounts(): Promise<void> {
    const sourceRoot = this.options.config.sourceRoot
    const paths = [
      this.options.config.dshEntry,
      join(sourceRoot, 'node_modules'),
      join(sourceRoot, 'packages'),
      join(sourceRoot, 'apps'),
      join(sourceRoot, 'native'),
      join(sourceRoot, 'vendor'),
      join(sourceRoot, 'package.json'),
      join(sourceRoot, 'pnpm-workspace.yaml'),
      resolve(dirname(process.execPath), '..'),
      this.options.config.pluginRoot,
    ]
    for (const path of paths) {
      if (!await pathExists(path)) throw new Error(`tenant runtime: required mount source is missing: ${path}`)
    }
  }

  private async cleanupStaleContainers(): Promise<void> {
    const result = await runPodman(this.options.config.podman, [
      'ps', '--all', '--quiet', '--filter', `label=${TENANT_LABEL}`,
    ], this.options.config.startTimeoutMs)
    const ids = result.stdout.split(/\s+/u).filter(value => value !== '')
    if (ids.length === 0) return
    await runPodman(this.options.config.podman, ['rm', '--force', ...ids], this.options.config.startTimeoutMs)
    this.options.logger.info(`enterprise tenant containers: removed ${String(ids.length)} stale container(s)`)
  }

  private async withCreationLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.creationQueue
    let release!: () => void
    this.creationQueue = new Promise<void>((resolveQueue) => { release = resolveQueue })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }

  private async reapIdle(): Promise<void> {
    if (this.closed) return
    for (const [id, runtime] of this.runtimes) {
      if (!runtime.isIdle) continue
      await runtime.stop()
      this.runtimes.delete(id)
    }
  }
}
