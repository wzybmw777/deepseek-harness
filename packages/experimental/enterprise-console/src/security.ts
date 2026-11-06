/** Password, session, and credential cryptography for the enterprise console. */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto'

const SCRYPT_COST = 16_384
const SCRYPT_BLOCK_SIZE = 8
const SCRYPT_PARALLELIZATION = 1
const SCRYPT_KEY_BYTES = 64
const SESSION_VERSION = 1

export interface SessionPayload {
  readonly version: typeof SESSION_VERSION
  readonly userId: string
  readonly sessionVersion: number
  readonly issuedAt: number
  readonly expiresAt: number
}

function base64url(value: Buffer): string {
  return value.toString('base64url')
}

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_BYTES, {
      N: SCRYPT_COST,
      r: SCRYPT_BLOCK_SIZE,
      p: SCRYPT_PARALLELIZATION,
      maxmem: 64 * 1024 * 1024,
    }, (error, key) => {
      if (error !== null) reject(error)
      else resolve(key)
    })
  })
}

/**
 * Hash a password with a fresh salt.
 * @param password - plaintext password.
 * @returns a self-describing Scrypt record safe to persist.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await deriveKey(password, salt)
  return [
    'scrypt',
    String(SCRYPT_COST),
    String(SCRYPT_BLOCK_SIZE),
    String(SCRYPT_PARALLELIZATION),
    base64url(salt),
    base64url(key),
  ].join('$')
}

/**
 * Verify a password against a stored Scrypt record in constant time.
 * @param password - candidate plaintext password.
 * @param record - stored password hash.
 * @returns true only for a well-formed record and a matching password.
 */
export async function verifyPassword(password: string, record: string): Promise<boolean> {
  const parts = record.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const cost = Number(parts[1])
  const blockSize = Number(parts[2])
  const parallelization = Number(parts[3])
  if (cost !== SCRYPT_COST || blockSize !== SCRYPT_BLOCK_SIZE || parallelization !== SCRYPT_PARALLELIZATION) return false
  const salt = Buffer.from(parts[4] ?? '', 'base64url')
  const expected = Buffer.from(parts[5] ?? '', 'base64url')
  if (salt.byteLength !== 16 || expected.byteLength !== SCRYPT_KEY_BYTES) return false
  const actual = await deriveKey(password, salt)
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected)
}

function sessionSignature(secret: Buffer, domain: string, body: string): Buffer {
  return createHmac('sha256', secret).update(`${domain}.${body}`).digest()
}

/**
 * Serialize and sign a session cookie value.
 * @param payload - authenticated user and expiry facts.
 * @param secret - server-side HMAC key.
 * @returns a compact signed cookie value.
 */
export function encodeSession(payload: SessionPayload, secret: Buffer): string {
  const body = base64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  return `${body}.${base64url(sessionSignature(secret, 'enterprise-session', body))}`
}

/**
 * Verify a session cookie and return its payload.
 * @param value - signed cookie value.
 * @param secret - server-side HMAC key.
 * @param now - comparison timestamp in milliseconds.
 * @returns the payload only when its signature, version, and expiry are valid.
 */
export function decodeSession(value: string, secret: Buffer, now = Date.now()): SessionPayload | undefined {
  const parts = value.split('.')
  if (parts.length !== 2) return undefined
  const body = parts[0]
  const encodedSignature = parts[1]
  if (body === undefined || encodedSignature === undefined) return undefined
  const actual = Buffer.from(encodedSignature, 'base64url')
  const expected = sessionSignature(secret, 'enterprise-session', body)
  if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const candidate = parsed as Record<string, unknown>
  if (candidate.version !== SESSION_VERSION
    || typeof candidate.userId !== 'string' || candidate.userId === ''
    || typeof candidate.sessionVersion !== 'number' || !Number.isSafeInteger(candidate.sessionVersion)
    || typeof candidate.issuedAt !== 'number' || !Number.isSafeInteger(candidate.issuedAt)
    || typeof candidate.expiresAt !== 'number' || !Number.isSafeInteger(candidate.expiresAt)
    || candidate.expiresAt <= now) return undefined
  return {
    version: SESSION_VERSION,
    userId: candidate.userId,
    sessionVersion: candidate.sessionVersion,
    issuedAt: candidate.issuedAt,
    expiresAt: candidate.expiresAt,
  }
}

/**
 * Encrypt a credential with AES-256-GCM.
 * @param plaintext - channel API key.
 * @param key - 32-byte encryption key.
 * @returns a versioned ciphertext string safe to persist.
 */
export function encryptCredential(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return `v1.${base64url(iv)}.${base64url(cipher.getAuthTag())}.${base64url(ciphertext)}`
}

/**
 * Decrypt a channel credential for an administrative reveal operation.
 * @param encoded - ciphertext produced by {@link encryptCredential}.
 * @param key - 32-byte encryption key.
 * @returns plaintext when the envelope authenticates.
 */
export function decryptCredential(encoded: string, key: Buffer): string {
  const parts = encoded.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Unsupported credential envelope')
  const iv = Buffer.from(parts[1] ?? '', 'base64url')
  const tag = Buffer.from(parts[2] ?? '', 'base64url')
  const ciphertext = Buffer.from(parts[3] ?? '', 'base64url')
  if (iv.byteLength !== 12 || tag.byteLength !== 16) throw new Error('Invalid credential envelope')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

/** Generate a 32-byte key encoded for the owner-only key file. */
export function generateKeyMaterial(): string {
  return base64url(randomBytes(32))
}

/**
 * Decode a key file value.
 * @param value - base64url-encoded 32-byte key.
 * @returns the raw key.
 * @throws if the value is not exactly one 256-bit key.
 */
export function decodeKeyMaterial(value: string): Buffer {
  const decoded = Buffer.from(value.trim(), 'base64url')
  if (decoded.byteLength !== 32) throw new Error('Enterprise key material must contain exactly 32 bytes')
  return decoded
}

/** Generate a human-enterable temporary password with 120 bits of randomness. */
export function generateTemporaryPassword(): string {
  return randomBytes(15).toString('base64url')
}

/** Generate a stable opaque record identifier. */
export function recordId(): string {
  return randomBytes(16).toString('hex')
}

/** Normalize an email address before uniqueness checks and login. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Validate a normalized email without accepting display-name syntax. */
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value) && value.length <= 320
}

/** Normalize a phone number for uniqueness checks and login. */
export function normalizePhone(phone: string): string {
  const compact = phone.trim().replace(/[\s().-]/gu, '')
  if (/^0086(1[3-9]\d{9})$/u.test(compact)) return `+${compact.slice(2)}`
  if (/^86(1[3-9]\d{9})$/u.test(compact)) return `+${compact}`
  return /^1[3-9]\d{9}$/u.test(compact) ? `+86${compact}` : compact
}

/** Validate a normalized phone number. */
export function isPhone(value: string): boolean {
  return /^\+?[1-9]\d{6,14}$/u.test(normalizePhone(value))
}

/** Normalize an email address or phone number used as a login identifier. */
export function normalizeIdentifier(value: string): string {
  const trimmed = value.trim()
  return trimmed.includes('@') ? normalizeEmail(trimmed) : normalizePhone(trimmed)
}

/** Validate a normalized email-address or phone-number login identifier. */
export function isIdentifier(value: string): boolean {
  return value.includes('@') ? isEmail(value) : isPhone(value)
}
