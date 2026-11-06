/** OS-backed storage for the enterprise desktop refresh credential. */

import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { EnterpriseCredentialRecord } from './enterprise-types.ts'

/** Minimal operating-system encryption surface used by the credential store. */
export interface EnterpriseCredentialVault {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

/** Stable credential-store failure codes. */
export type EnterpriseCredentialErrorCode =
  | 'enterprise_credentials_unavailable'
  | 'enterprise_credentials_corrupt'
  | 'enterprise_credentials_io'

/** Failure that never embeds credential material in its message. */
export class EnterpriseCredentialError extends Error {
  /**
   * @param code - stable failure code.
   * @param message - credential-free explanation.
   */
  constructor(readonly code: EnterpriseCredentialErrorCode, message: string) {
    super(message)
    this.name = 'EnterpriseCredentialError'
  }
}

export interface EnterpriseCredentialStoreOptions {
  readonly directory: string
  readonly vault: EnterpriseCredentialVault
}

function normalizedOrigin(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new EnterpriseCredentialError('enterprise_credentials_corrupt', '企业云服务地址无效')
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username !== '' || url.password !== ''
    || url.search !== '' || url.hash !== '' || (url.pathname !== '' && url.pathname !== '/')) {
    throw new EnterpriseCredentialError('enterprise_credentials_corrupt', '企业云服务地址无效')
  }
  return url.origin
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EnterpriseCredentialError('enterprise_credentials_corrupt', '企业桌面端凭据格式无效')
  }
  return value as Record<string, unknown>
}

function text(value: Record<string, unknown>, field: string): string {
  const candidate = value[field]
  if (typeof candidate !== 'string' || candidate === '') {
    throw new EnterpriseCredentialError('enterprise_credentials_corrupt', '企业桌面端凭据字段缺失')
  }
  return candidate
}

/** Read and write one credential file per normalized enterprise cloud origin. */
export class EnterpriseCredentialStore {
  private readonly directory: string
  private readonly vault: EnterpriseCredentialVault

  /** @param options - private directory and operating-system encryption provider. */
  constructor(options: EnterpriseCredentialStoreOptions) {
    this.directory = options.directory
    this.vault = options.vault
  }

  /**
   * Load the credential for one server origin.
   * @param cloudBaseUrl - enterprise cloud origin.
   * @returns the stored credential, or undefined when this server was never signed in.
   */
  async load(cloudBaseUrl: string): Promise<EnterpriseCredentialRecord | undefined> {
    const path = this.path(cloudBaseUrl)
    let encrypted: Buffer
    try {
      encrypted = await readFile(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw new EnterpriseCredentialError('enterprise_credentials_io', '读取企业桌面端凭据失败')
    }
    if (!this.vault.isEncryptionAvailable()) {
      throw new EnterpriseCredentialError('enterprise_credentials_unavailable', '操作系统凭据加密不可用')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(this.vault.decryptString(encrypted))
    } catch {
      throw new EnterpriseCredentialError('enterprise_credentials_corrupt', '企业桌面端凭据已损坏')
    }
    const value = record(parsed)
    return {
      cloudBaseUrl: normalizedOrigin(text(value, 'cloudBaseUrl')),
      userId: text(value, 'userId'),
      email: text(value, 'email'),
      deviceId: text(value, 'deviceId'),
      profileKey: text(value, 'profileKey'),
      refreshToken: text(value, 'refreshToken'),
    }
  }

  /**
   * Encrypt and replace the credential for its server origin.
   * @param value - credential containing the refresh secret.
   */
  async save(value: EnterpriseCredentialRecord): Promise<void> {
    if (!this.vault.isEncryptionAvailable()) {
      throw new EnterpriseCredentialError('enterprise_credentials_unavailable', '操作系统凭据加密不可用')
    }
    const target = this.path(value.cloudBaseUrl)
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      await chmod(this.directory, 0o700)
      const encrypted = this.vault.encryptString(JSON.stringify({
        ...value,
        cloudBaseUrl: normalizedOrigin(value.cloudBaseUrl),
      }))
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(encrypted)
        await handle.sync()
      } finally {
        await handle.close()
      }
      await chmod(temporary, 0o600)
      await rename(temporary, target)
      await chmod(target, 0o600)
    } catch (error) {
      await rm(temporary, { force: true })
      if (error instanceof EnterpriseCredentialError) throw error
      throw new EnterpriseCredentialError('enterprise_credentials_io', '保存企业桌面端凭据失败')
    }
  }

  /**
   * Remove only the credential belonging to one server origin.
   * @param cloudBaseUrl - enterprise cloud origin.
   */
  async clear(cloudBaseUrl: string): Promise<void> {
    try {
      await rm(this.path(cloudBaseUrl), { force: true })
    } catch {
      throw new EnterpriseCredentialError('enterprise_credentials_io', '删除企业桌面端凭据失败')
    }
  }

  private path(cloudBaseUrl: string): string {
    const digest = createHash('sha256').update(normalizedOrigin(cloudBaseUrl), 'utf8').digest('hex')
    return join(this.directory, `${digest}.bin`)
  }
}
