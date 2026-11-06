import { describe, expect, it } from 'vitest'
import {
  VerificationService,
  createWebhookVerificationDelivery,
  type VerificationMessage,
} from '../src/verification.ts'

function serviceWithDelivery(now: () => number): { service: VerificationService; messages: VerificationMessage[] } {
  const messages: VerificationMessage[] = []
  const service = new VerificationService({
    now,
    delivery: { send: async (message) => { messages.push(message) } },
  })
  return { service, messages }
}

const request = {
  identifier: 'owner@example.com',
  channel: 'email' as const,
  purpose: 'login' as const,
  brandName: 'Enterprise Test',
  requestIp: '127.0.0.1',
  send: true,
}

describe('verification service', () => {
  it('delivers a six-digit code and consumes it once', async () => {
    const { service, messages } = serviceWithDelivery(() => Date.parse('2026-10-31T10:00:00.000Z'))
    const result = await service.request(request)

    expect(result).toEqual({ expiresInSeconds: 600, retryAfterSeconds: 60 })
    expect(messages).toHaveLength(1)
    expect(messages[0]?.code).toMatch(/^\d{6}$/u)
    expect(() => { service.verify({ identifier: request.identifier, purpose: 'login', code: messages[0]?.code ?? '' }) }).not.toThrow()
    expect(() => { service.verify({ identifier: request.identifier, purpose: 'login', code: messages[0]?.code ?? '' }) })
      .toThrow(expect.objectContaining({ status: 401, code: 'invalid_code' }))
  })

  it('expires challenges after ten minutes', async () => {
    let now = Date.parse('2026-10-31T10:00:00.000Z')
    const { service, messages } = serviceWithDelivery(() => now)
    await service.request(request)
    now += 10 * 60 * 1000
    expect(() => { service.verify({ identifier: request.identifier, purpose: 'login', code: messages[0]?.code ?? '' }) })
      .toThrow(expect.objectContaining({ status: 401, code: 'invalid_code' }))
  })

  it('invalidates a challenge after five wrong attempts', async () => {
    const { service, messages } = serviceWithDelivery(() => Date.parse('2026-10-31T10:00:00.000Z'))
    await service.request(request)
    const code = messages[0]?.code ?? ''
    const wrong = code === '000000' ? '111111' : '000000'
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(() => { service.verify({ identifier: request.identifier, purpose: 'login', code: wrong }) })
        .toThrow(expect.objectContaining({ status: 401 }))
    }
    expect(() => { service.verify({ identifier: request.identifier, purpose: 'login', code }) })
      .toThrow(expect.objectContaining({ status: 401 }))
  })

  it('separates login and registration purposes', async () => {
    const { service, messages } = serviceWithDelivery(() => Date.parse('2026-10-31T10:00:00.000Z'))
    await service.request({ ...request, purpose: 'register' })
    expect(() => {
      service.verify({ identifier: request.identifier, purpose: 'login', code: messages[0]?.code ?? '' })
    }).toThrow(expect.objectContaining({ status: 401 }))
  })

  it('enforces resend cooldown and the hourly identifier limit', async () => {
    let now = Date.parse('2026-10-31T10:00:00.000Z')
    const { service, messages } = serviceWithDelivery(() => now)
    await service.request(request)
    await expect(service.request(request)).rejects.toMatchObject({ status: 429 })

    for (let index = 1; index < 8; index += 1) {
      now += 61_000
      await service.request(request)
    }
    now += 61_000
    await expect(service.request(request)).rejects.toMatchObject({ status: 429 })
    expect(messages).toHaveLength(8)
  })

  it('skips delivery without creating a challenge for ineligible accounts', async () => {
    const { service, messages } = serviceWithDelivery(() => Date.parse('2026-10-31T10:00:00.000Z'))
    const result = await service.request({ ...request, send: false })
    expect(result.expiresInSeconds).toBe(600)
    expect(messages).toEqual([])
  })

  it('bounds rate-limit bucket state under identifier and request-source spraying', async () => {
    const { service } = serviceWithDelivery(() => Date.parse('2026-10-31T10:00:00.000Z'))
    for (let index = 0; index <= 10_000; index += 1) {
      await service.request({
        ...request,
        identifier: `spray-${String(index)}@example.com`,
        requestIp: `2001:db8::${String(index)}`,
        send: false,
      })
    }
  })
})

describe('verification webhook delivery', () => {
  it('posts the code with bearer authentication', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const delivery = createWebhookVerificationDelivery({
      url: 'https://verify.example.com/send',
      token: 'secret-token',
      fetch: async (input, init) => {
        calls.push({ url: String(input), init })
        return new Response(null, { status: 204 })
      },
    })
    await delivery.send({
      identifier: '+8613800138000',
      channel: 'phone',
      code: '123456',
      purpose: 'login',
      brandName: 'Enterprise Test',
      expiresInSeconds: 600,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://verify.example.com/send')
    expect(calls[0]?.init?.headers).toMatchObject({
      'content-type': 'application/json',
      authorization: 'Bearer secret-token',
    })
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({ identifier: '+8613800138000', code: '123456' })
  })

  it('rejects insecure remote webhooks and provider failures', async () => {
    expect(() => createWebhookVerificationDelivery({ url: 'http://verify.example.com/send' }))
      .toThrow('HTTPS')
    const delivery = createWebhookVerificationDelivery({
      url: 'https://verify.example.com/send',
      fetch: async () => new Response(null, { status: 500 }),
    })
    await expect(delivery.send({
      identifier: 'owner@example.com',
      channel: 'email',
      code: '123456',
      purpose: 'login',
      brandName: 'Enterprise Test',
      expiresInSeconds: 600,
    })).rejects.toThrow('status 500')
  })
})
