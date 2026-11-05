import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  EnterpriseCredentialError,
  EnterpriseCredentialStore,
  type EnterpriseCredentialVault,
} from '../src/enterprise-credentials.ts'
import type { EnterpriseCredentialRecord } from '../src/enterprise-types.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).reverse().map(cleanup => cleanup()))
})

function vault(available = true): EnterpriseCredentialVault & { readonly encrypted: string[] } {
  const encrypted: string[] = []
  return {
    encrypted,
    isEncryptionAvailable: () => available,
    encryptString(value) {
      encrypted.push(value)
      return Buffer.from(`sealed:${Buffer.from(value, 'utf8').toString('base64url')}`, 'utf8')
    },
    decryptString(value) {
      const text = value.toString('utf8')
      if (!text.startsWith('sealed:')) throw new Error('bad ciphertext')
      return Buffer.from(text.slice('sealed:'.length), 'base64url').toString('utf8')
    },
  }
}

function record(overrides: Partial<EnterpriseCredentialRecord> = {}): EnterpriseCredentialRecord {
  return {
    cloudBaseUrl: 'https://cloud.example.com',
    userId: 'user-owner',
    email: 'owner@example.com',
    deviceId: 'device-a',
    profileKey: '0123456789abcdef0123456789abcdef',
    refreshToken: 'refresh-secret-value',
    ...overrides,
  }
}

async function harness(options: { available?: boolean } = {}): Promise<{
  directory: string
  store: EnterpriseCredentialStore
  vault: ReturnType<typeof vault>
}> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-enterprise-credentials-'))
  cleanups.push(async () => { await rm(directory, { recursive: true, force: true }) })
  const fakeVault = vault(options.available ?? true)
  return { directory, vault: fakeVault, store: new EnterpriseCredentialStore({ directory, vault: fakeVault }) }
}

describe('enterprise desktop credential store', { concurrent: false }, () => {
  it('writes only safeStorage ciphertext at mode 0600', async () => {
    const { directory, store, vault: fakeVault } = await harness()
    await store.save(record())

    const files = await import('node:fs/promises').then(fs => fs.readdir(directory))
    expect(files).toHaveLength(1)
    const path = join(directory, files[0] ?? '')
    const bytes = await readFile(path)
    expect(bytes.toString('utf8')).not.toContain('refresh-secret-value')
    expect(bytes.toString('utf8')).toContain('sealed:')
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(fakeVault.encrypted.join('\n')).toContain('refresh-secret-value')
    await expect(store.load('https://cloud.example.com')).resolves.toEqual(record())
  })

  it('fails closed when operating-system encryption is unavailable', async () => {
    const { store } = await harness({ available: false })
    await expect(store.save(record())).rejects.toMatchObject({ code: 'enterprise_credentials_unavailable' })
  })

  it('removes only the selected server credential on clear', async () => {
    const { store } = await harness()
    await store.save(record())
    await store.save(record({ cloudBaseUrl: 'https://other.example.com', refreshToken: 'other-secret' }))

    await store.clear('https://cloud.example.com')
    await expect(store.load('https://cloud.example.com')).resolves.toBeUndefined()
    await expect(store.load('https://other.example.com')).resolves.toMatchObject({ refreshToken: 'other-secret' })
  })

  it('never includes a refresh token in an error message', async () => {
    const { directory, store } = await harness()
    await store.save(record())
    const files = await import('node:fs/promises').then(fs => fs.readdir(directory))
    const path = join(directory, files[0] ?? '')
    await import('node:fs/promises').then(fs => fs.writeFile(path, Buffer.from('sealed:not-json')))

    await expect(store.load('https://cloud.example.com')).rejects.toSatisfy((error: unknown) =>
      error instanceof EnterpriseCredentialError
      && !error.message.includes('refresh-secret-value'))
  })
})
