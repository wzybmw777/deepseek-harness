/** HTTP helpers shared by the enterprise API and static application route. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'

const MAX_JSON_BYTES = 2 * 1024 * 1024

/** Standard security headers for every enterprise response. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'referrer-policy': 'same-origin',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
}

/** Read a single request header. */
export function requestHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name]
  return typeof value === 'string' ? value : undefined
}

/** First comma-separated header value, which is the client-facing proxy hop. */
function firstForwarded(value: string | undefined): string | undefined {
  return value?.split(',')[0]?.trim() || undefined
}

/** Public protocol inferred from the terminating proxy, then the local socket. */
export function requestProtocol(request: IncomingMessage): 'http' | 'https' {
  const forwarded = firstForwarded(requestHeader(request, 'x-forwarded-proto'))?.toLowerCase()
  if (forwarded === 'https' || forwarded === 'http') return forwarded
  if (requestHeader(request, 'x-forwarded-ssl')?.toLowerCase() === 'on') return 'https'
  const socket = request.socket as Socket & { readonly encrypted?: boolean }
  return socket.encrypted === true ? 'https' : 'http'
}

/** Public authority as seen by the browser. */
export function requestAuthority(request: IncomingMessage): string | undefined {
  const host = firstForwarded(requestHeader(request, 'x-forwarded-host')) ?? requestHeader(request, 'host')
  if (host === undefined || host === '') return undefined
  try {
    return new URL(`${requestProtocol(request)}://${host}`).host
  } catch {
    return undefined
  }
}

/** Browser-facing origin used for cookie policy and mutation checks. */
export function requestOrigin(request: IncomingMessage): string | undefined {
  const authority = requestAuthority(request)
  return authority === undefined ? undefined : `${requestProtocol(request)}://${authority}`
}

/** Require a cookie-authenticated mutation to come from this exact browser origin. */
export function sameOriginMutation(request: IncomingMessage): boolean {
  const origin = requestHeader(request, 'origin')
  const expected = requestOrigin(request)
  return origin !== undefined && expected !== undefined && origin === expected
}

/** Client address for audit and login throttling. */
export function clientIp(request: IncomingMessage): string {
  return firstForwarded(requestHeader(request, 'cf-connecting-ip'))
    ?? firstForwarded(requestHeader(request, 'x-real-ip'))
    ?? firstForwarded(requestHeader(request, 'x-forwarded-for'))
    ?? request.socket.remoteAddress
    ?? 'unknown'
}

/** Parse one cookie from the Cookie header. */
export function readCookie(request: IncomingMessage, name: string): string | undefined {
  const header = requestHeader(request, 'cookie')
  if (header === undefined) return undefined
  for (const segment of header.split(';')) {
    const equals = segment.indexOf('=')
    if (equals === -1) continue
    if (segment.slice(0, equals).trim() === name) return segment.slice(equals + 1).trim()
  }
  return undefined
}

/**
 * Serialize a hardened session cookie.
 * @param name - Cookie name.
 * @param value - Cookie value.
 * @param options - Lifetime, security, and path attributes.
 * @returns The Set-Cookie value.
 */
export function serializeCookie(
  name: string,
  value: string,
  options: { maxAgeSeconds?: number; secure: boolean; expires?: Date; path?: string },
): string {
  const attributes = [`${name}=${value}`, `Path=${options.path ?? '/'}`, 'HttpOnly', 'SameSite=Lax']
  if (options.maxAgeSeconds !== undefined) attributes.push(`Max-Age=${String(options.maxAgeSeconds)}`)
  if (options.expires !== undefined) attributes.push(`Expires=${options.expires.toUTCString()}`)
  if (options.secure) attributes.push('Secure')
  return attributes.join('; ')
}

/** Write JSON with the response's common security headers. */
export function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
  headers: Readonly<Record<string, string>> = {},
): void {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
    ...headers,
  })
  response.end(body)
}

/** Write a JSON error in one stable envelope. */
export function sendError(response: ServerResponse, status: number, message: string, code = 'request_failed'): void {
  sendJson(response, status, { error: { code, message } })
}

/** Write an empty response carrying the common security headers. */
export function sendEmpty(response: ServerResponse, status: number, headers: Readonly<Record<string, string>> = {}): void {
  response.writeHead(status, { ...SECURITY_HEADERS, 'cache-control': 'no-store', ...headers })
  response.end()
}

/** Read and parse a bounded JSON request body. */
export async function readJson(request: IncomingMessage): Promise<unknown> {
  const contentType = requestHeader(request, 'content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, '请求必须使用 application/json', 'unsupported_media_type')
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of request) {
    const bytes: Uint8Array = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += bytes.byteLength
    if (total > MAX_JSON_BYTES) throw new HttpError(413, '请求体超过 2 MiB 限制', 'payload_too_large')
    chunks.push(bytes)
  }
  if (total === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new HttpError(400, '请求体不是有效 JSON', 'invalid_json')
  }
}

/** Read a bounded binary request body. */
export async function readBody(
  request: IncomingMessage,
  maximum: number,
  message: string,
): Promise<Buffer> {
  const declared = Number(requestHeader(request, 'content-length'))
  if (Number.isFinite(declared) && declared > maximum) {
    throw new HttpError(413, message, 'payload_too_large')
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of request) {
    const bytes: Uint8Array = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += bytes.byteLength
    if (total > maximum) throw new HttpError(413, message, 'payload_too_large')
    chunks.push(bytes)
  }
  return Buffer.concat(chunks)
}

/** An error that is safe to expose to the console client. */
export class HttpError extends Error {
  /** Create a localized API failure. */
  constructor(
    readonly status: number,
    message: string,
    readonly code = 'request_failed',
  ) {
    super(message)
  }
}

/** Require a non-empty trimmed string field. */
export function textField(value: unknown, name: string, maxLength = 500): string {
  if (typeof value !== 'string' || value.trim() === '') throw new HttpError(400, `${name}不能为空`, 'invalid_field')
  const text = value.trim()
  if (text.length > maxLength) throw new HttpError(400, `${name}超过 ${String(maxLength)} 个字符`, 'invalid_field')
  return text
}

/** Require a non-empty secret whose leading and trailing characters are significant. */
export function secretField(value: unknown, name: string, maxLength = 500): string {
  if (typeof value !== 'string' || value === '') throw new HttpError(400, `${name}不能为空`, 'invalid_field')
  if (value.length > maxLength) throw new HttpError(400, `${name}超过 ${String(maxLength)} 个字符`, 'invalid_field')
  return value
}

/** Read an optional trimmed string field. */
export function optionalTextField(value: unknown, name: string, maxLength = 500): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return textField(value, name, maxLength)
}

/** Read an integer field within inclusive bounds. */
export function integerField(value: unknown, name: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new HttpError(400, `${name}必须是 ${String(minimum)} 到 ${String(maximum)} 之间的整数`, 'invalid_field')
  }
  return value
}

/** Read a boolean field. */
export function booleanField(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new HttpError(400, `${name}必须是布尔值`, 'invalid_field')
  return value
}

/** Read an array of unique non-empty strings. */
export function stringArrayField(value: unknown, name: string, maxItems = 50): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new HttpError(400, `${name}必须是最多 ${String(maxItems)} 项的字符串数组`, 'invalid_field')
  }
  const items = value.map(item => textField(item, name, 120))
  return [...new Set(items)]
}

/** Parse the last path segment of an API resource. */
export function pathIdentifier(pathname: string, prefix: string): string | undefined {
  if (!pathname.startsWith(prefix)) return undefined
  const rest = pathname.slice(prefix.length)
  if (rest === '' || rest.includes('/')) return undefined
  return decodeURIComponent(rest)
}
