/** One-time email and phone verification challenges for enterprise authentication. */

import { randomInt, timingSafeEqual } from 'node:crypto'
import { HttpError } from './http.ts'

const CODE_DIGITS = 6
const CODE_TTL_MILLISECONDS = 10 * 60 * 1000
const RESEND_COOLDOWN_MILLISECONDS = 60 * 1000
const MAX_ATTEMPTS = 5
const RATE_WINDOW_MILLISECONDS = 60 * 60 * 1000
const MAX_IDENTIFIER_REQUESTS = 8
const MAX_IP_REQUESTS = 30
const MAX_CHALLENGES = 10_000
const MAX_RATE_LIMIT_BUCKETS = 10_000

/** Authentication flow that requested a verification code. */
export type VerificationPurpose = 'login' | 'register'

/** Delivery route for a verification code. */
export type VerificationChannel = 'email' | 'phone'

/** Delivery payload for an email or SMS gateway. */
export interface VerificationMessage {
  readonly identifier: string
  readonly channel: VerificationChannel
  readonly code: string
  readonly purpose: VerificationPurpose
  readonly brandName: string
  readonly expiresInSeconds: number
}

/** Provider boundary for email or SMS verification delivery. */
export interface VerificationDelivery {
  /**
   * Deliver one verification code without writing it to logs.
   * @param message - destination, code, purpose, and display branding.
   * @returns completion after the provider accepts the message.
   */
  send(message: VerificationMessage): Promise<void>
}

/** Accepted verification-code request details safe to return to the browser. */
export interface VerificationRequestResult {
  readonly expiresInSeconds: number
  readonly retryAfterSeconds: number
}

interface Challenge {
  readonly code: string
  readonly channel: VerificationChannel
  readonly purpose: VerificationPurpose
  readonly sentAt: number
  readonly expiresAt: number
  attempts: number
}

interface VerificationServiceOptions {
  readonly delivery?: VerificationDelivery
  readonly now?: () => number
}

function challengeKey(identifier: string, purpose: VerificationPurpose): string {
  return `${purpose}:${identifier}`
}

function codeMatches(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected, 'utf8')
  const actualBytes = Buffer.from(actual, 'utf8')
  return expectedBytes.byteLength === actualBytes.byteLength && timingSafeEqual(expectedBytes, actualBytes)
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
}

function webhookUrl(value: string): URL {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('enterprise verification webhook URL is invalid')
  }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname))) {
    throw new Error('enterprise verification webhook must use HTTPS, except on loopback')
  }
  return parsed
}

/** Create an HTTPS webhook delivery adapter for an external email/SMS gateway. */
export function createWebhookVerificationDelivery(options: {
  readonly url: string
  readonly token?: string
  readonly timeoutMilliseconds?: number
  readonly fetch?: typeof fetch
}): VerificationDelivery {
  const endpoint = webhookUrl(options.url)
  const token = options.token
  const timeoutMilliseconds = options.timeoutMilliseconds ?? 10_000
  const fetchImplementation = options.fetch ?? fetch
  return {
    async send(message) {
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (token !== undefined && token !== '') headers.authorization = `Bearer ${token}`
      let response: Response
      try {
        response = await fetchImplementation(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(message),
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMilliseconds),
        })
      } catch (error) {
        throw new Error('enterprise verification webhook request failed', { cause: error })
      }
      if (!response.ok) {
        throw new Error(`enterprise verification webhook rejected delivery with status ${String(response.status)}`)
      }
    },
  }
}

/** In-memory challenge issuer and verifier shared by passwordless login and registration. */
export class VerificationService {
  private readonly delivery: VerificationDelivery | undefined
  private readonly now: () => number
  private readonly challenges = new Map<string, Challenge>()
  private readonly identifierRequests = new Map<string, number[]>()
  private readonly ipRequests = new Map<string, number[]>()

  /** Create a verifier with an optional delivery provider. */
  constructor(options: VerificationServiceOptions = {}) {
    this.delivery = options.delivery
    this.now = options.now ?? Date.now
  }

  /** Whether code login and registration can deliver a verification message. */
  get enabled(): boolean {
    return this.delivery !== undefined
  }

  /**
   * Issue and deliver a verification code when requested.
   * @param input - identifier, purpose, requester address, and whether delivery is eligible.
   * @returns code lifetime and resend cooldown.
   */
  async request(input: {
    readonly identifier: string
    readonly channel: VerificationChannel
    readonly purpose: VerificationPurpose
    readonly brandName: string
    readonly requestIp: string
    readonly send: boolean
  }): Promise<VerificationRequestResult> {
    const delivery = this.delivery
    if (delivery === undefined) throw new HttpError(503, '验证码服务尚未配置', 'verification_unavailable')
    const now = this.now()
    this.prune(now)
    if (!input.send) {
      this.enforceRequestLimit(input.identifier, input.requestIp, now)
      return { expiresInSeconds: CODE_TTL_MILLISECONDS / 1000, retryAfterSeconds: RESEND_COOLDOWN_MILLISECONDS / 1000 }
    }
    const key = challengeKey(input.identifier, input.purpose)
    const current = this.challenges.get(key)
    if (current !== undefined && current.sentAt + RESEND_COOLDOWN_MILLISECONDS > now) {
      throw new HttpError(429, '验证码发送过于频繁，请稍后再试', 'too_many_attempts')
    }
    this.enforceRequestLimit(input.identifier, input.requestIp, now)
    const code = String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0')
    const challenge: Challenge = {
      code,
      channel: input.channel,
      purpose: input.purpose,
      sentAt: now,
      expiresAt: now + CODE_TTL_MILLISECONDS,
      attempts: 0,
    }
    this.challenges.set(key, challenge)
    try {
      await delivery.send({
        identifier: input.identifier,
        channel: input.channel,
        code,
        purpose: input.purpose,
        brandName: input.brandName,
        expiresInSeconds: CODE_TTL_MILLISECONDS / 1000,
      })
    } catch {
      this.challenges.delete(key)
      throw new HttpError(503, '验证码发送失败，请稍后重试', 'verification_delivery_failed')
    }
    return { expiresInSeconds: CODE_TTL_MILLISECONDS / 1000, retryAfterSeconds: RESEND_COOLDOWN_MILLISECONDS / 1000 }
  }

  /**
   * Consume a matching verification code.
   * @param input - identifier, purpose, and the user-entered code.
   * @returns the delivery channel of the consumed code.
   */
  verify(input: {
    readonly identifier: string
    readonly purpose: VerificationPurpose
    readonly code: string
  }): { readonly channel: VerificationChannel } {
    const now = this.now()
    this.prune(now)
    const key = challengeKey(input.identifier, input.purpose)
    const challenge = this.challenges.get(key)
    if (challenge === undefined || challenge.expiresAt <= now) {
      this.challenges.delete(key)
      throw new HttpError(401, '验证码无效或已过期', 'invalid_code')
    }
    challenge.attempts += 1
    if (!codeMatches(challenge.code, input.code)) {
      if (challenge.attempts >= MAX_ATTEMPTS) this.challenges.delete(key)
      throw new HttpError(401, '验证码无效或已过期', 'invalid_code')
    }
    this.challenges.delete(key)
    return { channel: challenge.channel }
  }

  private enforceRequestLimit(identifier: string, requestIp: string, now: number): void {
    this.assertWithinLimit(this.identifierRequests, identifier, MAX_IDENTIFIER_REQUESTS, now)
    this.assertWithinLimit(this.ipRequests, requestIp, MAX_IP_REQUESTS, now)
  }

  private assertWithinLimit(
    buckets: Map<string, number[]>,
    key: string,
    limit: number,
    now: number,
  ): void {
    const cutoff = now - RATE_WINDOW_MILLISECONDS
    const recent = (buckets.get(key) ?? []).filter(timestamp => timestamp > cutoff)
    if (recent.length >= limit) throw new HttpError(429, '验证码请求过多，请稍后再试', 'too_many_attempts')
    recent.push(now)
    buckets.delete(key)
    buckets.set(key, recent)
    while (buckets.size > MAX_RATE_LIMIT_BUCKETS) {
      const oldest = buckets.keys().next()
      if (oldest.done) return
      buckets.delete(oldest.value)
    }
  }

  private prune(now: number): void {
    for (const [key, challenge] of this.challenges) {
      if (challenge.expiresAt <= now || challenge.attempts >= MAX_ATTEMPTS) this.challenges.delete(key)
    }
    if (this.challenges.size <= MAX_CHALLENGES) return
    const oldest = [...this.challenges.entries()]
      .sort((left, right) => left[1].sentAt - right[1].sentAt)
      .slice(0, this.challenges.size - MAX_CHALLENGES)
    for (const [key] of oldest) this.challenges.delete(key)
  }
}
