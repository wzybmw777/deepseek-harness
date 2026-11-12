// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { resourcesApi, uploadResourceFile } from '../src/client/api.ts'
import { enterprisePagePath } from '../src/client/public-path.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('enterprise resources API client', () => {
  it('opens the admin page beneath the same preview mount', () => {
    window.history.replaceState(null, '', '/yituobo/t/acme/harness/')
    expect(enterprisePagePath('/admin/agents')).toBe('/yituobo/enterprise/admin/agents')
  })
  it('keeps resource mutations inside the current deployment prefix', async () => {
    window.history.replaceState(null, '', '/preview/t/acme/harness/')
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetcher)
    await resourcesApi.removeFile('reports/q1.csv')
    const [input] = fetcher.mock.calls[0] as unknown as [URL]
    expect(input.pathname).toBe('/preview/enterprise/api/resources/files')
  })

  it('reads the signed-in member resource capabilities', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ canWrite: false })))

    await expect(resourcesApi.access()).resolves.toEqual({ canWrite: false })
  })

  it('uses same-origin endpoints and returns void for 204 responses', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetcher)

    await expect(resourcesApi.removeFile('reports/q1.csv')).resolves.toBeUndefined()
    const [input, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit]
    expect(input.origin).toBe(window.location.origin)
    expect(input.pathname).toBe('/enterprise/api/resources/files')
    expect(input.searchParams.get('path')).toBe('reports/q1.csv')
    expect(init).toMatchObject({ method: 'DELETE', credentials: 'same-origin' })
  })

  it('reports structured API failures and notifies the enterprise unauthorized channel', async () => {
    const dispatches: string[] = []
    const listener = (event: Event): void => { dispatches.push(event.type) }
    window.addEventListener('enterprise:unauthorized', listener)
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      error: { code: 'team_suspended', message: '团队已停用' },
    }, 401)))
    try {
      await expect(resourcesApi.skills()).rejects.toMatchObject({
        name: 'ResourceApiError',
        status: 401,
        code: 'team_suspended',
        message: '团队已停用',
      })
      expect(dispatches).toEqual(['enterprise:unauthorized'])
    } finally {
      window.removeEventListener('enterprise:unauthorized', listener)
    }
  })

  it('rejects a non-JSON success response instead of accepting an unknown body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not-json', { status: 200 })))
    await expect(resourcesApi.knowledge()).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
    })
  })

  it('uploads the file body with path and name in the query', async () => {
    const entry = {
      name: 'a b.txt',
      path: 'reports/a b.txt',
      kind: 'file',
      size: 5,
      modifiedAt: '2026-10-31T00:00:00.000Z',
      editable: true,
    }
    const fetcher = vi.fn(async () => jsonResponse(entry, 201))
    vi.stubGlobal('fetch', fetcher)
    const file = new File(['hello'], 'a b.txt', { type: 'text/plain' })

    await expect(uploadResourceFile('reports', file)).resolves.toEqual(entry)
    const [input, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit]
    expect(input.pathname).toBe('/enterprise/api/resources/files/upload')
    expect(input.searchParams.get('path')).toBe('reports')
    expect(input.searchParams.get('name')).toBe('a b.txt')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(file)
    expect(init.headers).toEqual({ 'content-type': 'text/plain' })
  })
})
