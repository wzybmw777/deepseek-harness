/** Shared enterprise plugin installation used by every tenant profile. */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const OUTPUT_LIMIT_BYTES = 65_536
const INSTALL_TIMEOUT_MS = 10 * 60_000
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u
const VERSION = /^[A-Za-z0-9._^~*<>=|+-]+$/u

/** Registry package requested by an enterprise administrator. */
export interface EnterprisePluginSpec {
  readonly name: string
  readonly spec: string
}

/** Installed enterprise bundle metadata returned to the administration UI. */
export interface InstalledEnterprisePlugin {
  readonly packageName: string
  readonly spec: string
  readonly version?: string
  readonly description: string
}

/** Package operations the enterprise plugin API needs. */
export interface EnterprisePluginInstaller {
  install(spec: string): Promise<InstalledEnterprisePlugin>
  remove(packageName: string): Promise<void>
}

interface InstalledManifest {
  name?: unknown
  version?: unknown
  description?: unknown
  dsh?: { bundle?: unknown }
}

/**
 * Parse a registry package name with an optional exact version or tag.
 * @param value - administrator-entered package specification.
 * @returns the package name and the normalized pnpm argument.
 */
export function parseEnterprisePluginSpec(value: string): EnterprisePluginSpec {
  const spec = value.trim()
  if (spec === '' || spec.length > 300 || spec.startsWith('-') || /\s/u.test(spec)) {
    throw new Error('请输入 npm 包名或包名@版本')
  }
  const separator = spec.startsWith('@') ? spec.indexOf('@', 1) : spec.indexOf('@')
  const name = separator === -1 ? spec : spec.slice(0, separator)
  const version = separator === -1 ? '' : spec.slice(separator + 1)
  if (!PACKAGE_NAME.test(name) || (separator !== -1 && !VERSION.test(version))) {
    throw new Error('请输入 npm 包名或包名@版本')
  }
  return { name, spec }
}

function pnpmInvocation(sourceRoot: string, args: readonly string[]): { command: string; args: string[] } {
  const entry = process.env.npm_execpath
  if (entry !== undefined && /\.(?:c?js|mjs)$/u.test(entry) && existsSync(entry)) {
    return { command: process.execPath, args: [entry, ...args] }
  }
  const bundled = join(sourceRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
  if (existsSync(bundled)) return { command: process.execPath, args: [bundled, ...args] }
  return { command: 'pnpm', args: [...args] }
}

function run(command: string, args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (error === undefined) resolve(output)
      else reject(error)
    }
    const append = (chunk: string): void => { output = (output + chunk).slice(-OUTPUT_LIMIT_BYTES) }
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      finish(new Error('插件安装超时，请稍后重试'))
    }, INSTALL_TIMEOUT_MS)
    child.once('error', (error) => { finish(new Error(`无法运行 pnpm：${error.message}`)) })
    child.once('close', (code, signal) => {
      if (code === 0) {
        finish()
        return
      }
      const detail = output.trim()
      finish(new Error(`插件安装失败（${signal ?? String(code)}）${detail === '' ? '' : `：${detail}`}`))
    })
  })
}

/** Install one shared package tree that tenant profiles link into read-only mounts. */
export class SharedEnterprisePluginInstaller implements EnterprisePluginInstaller {
  private queue: Promise<void> = Promise.resolve()

  /**
   * @param root - private directory containing the shared package project.
   * @param sourceRoot - checkout holding the bundled pnpm executable.
   */
  constructor(
    private readonly root: string,
    private readonly sourceRoot: string,
  ) {}

  install(value: string): Promise<InstalledEnterprisePlugin> {
    return this.serialized(async () => {
      const parsed = parseEnterprisePluginSpec(value)
      await this.ensureRoot()
      const invocation = pnpmInvocation(this.sourceRoot, ['add', parsed.spec, '--save-exact'])
      await run(invocation.command, invocation.args, this.root)
      let manifest: InstalledManifest
      try {
        manifest = JSON.parse(await readFile(join(this.root, 'node_modules', parsed.name, 'package.json'), 'utf8')) as InstalledManifest
      } catch (error) {
        throw new Error(`已安装 ${parsed.name}，但无法读取其 package.json：${error instanceof Error ? error.message : String(error)}`)
      }
      if (manifest.dsh?.bundle === undefined) {
        await this.removeNow(parsed.name)
        throw new Error('该 npm 包不是 DSH 插件包（缺少 dsh.bundle）')
      }
      return {
        packageName: parsed.name,
        spec: parsed.spec,
        ...(typeof manifest.version === 'string' ? { version: manifest.version } : {}),
        description: typeof manifest.description === 'string' ? manifest.description : '',
      }
    })
  }

  remove(packageName: string): Promise<void> {
    return this.serialized(async () => { await this.removeNow(packageName) })
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const manifest = join(this.root, 'package.json')
    if (!existsSync(manifest)) {
      await writeFile(manifest, `${JSON.stringify({ name: 'dsh-enterprise-plugins', private: true }, null, 2)}\n`, { mode: 0o600 })
    }
  }

  private async removeNow(packageName: string): Promise<void> {
    if (!PACKAGE_NAME.test(packageName)) throw new Error('插件包名无效')
    if (!existsSync(join(this.root, 'node_modules', packageName))) return
    const invocation = pnpmInvocation(this.sourceRoot, ['remove', packageName])
    await run(invocation.command, invocation.args, this.root)
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation)
    this.queue = next.then(() => undefined, () => undefined)
    return next
  }
}
