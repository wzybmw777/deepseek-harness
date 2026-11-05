import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteBrowserClient } from '../src/client/browser/remote/client.ts'
import { browserRemoteEndpoint } from '../src/client/browser/remote/endpoint.ts'
import type { RemoteBrowserEvent, RemoteBrowserViewState } from '../src/types.ts'

const STATE: RemoteBrowserViewState = {
  url: 'https://www.google.com/', title: 'Google', loading: false, canGoBack: false, canGoForward: false,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

describe('browserRemoteEndpoint', () => {
  it('accepts only a same-origin API path and normalizes its trailing slash', () => {
    vi.stubGlobal('__DSH_SIDEBAR_BROWSER_REMOTE__', { endpoint: '/enterprise/api/browser/' })
    expect(browserRemoteEndpoint()).toBe('/enterprise/api/browser')
    vi.stubGlobal('__DSH_SIDEBAR_BROWSER_REMOTE__', { endpoint: '/browser' })
    expect(browserRemoteEndpoint()).toBe('/browser')
  })

  it.each([
    undefined,
    null,
    {},
    { endpoint: '' },
    { endpoint: '//attacker.example/browser' },
    { endpoint: 'https://attacker.example/browser' },
    { endpoint: '/browser?target=attacker' },
    { endpoint: '/browser#fragment' },
    { endpoint: `/browser/${'a'.repeat(600)}` },
  ])('rejects malformed bootstrap %#', (value) => {
    vi.stubGlobal('__DSH_SIDEBAR_BROWSER_REMOTE__', value)
    expect(browserRemoteEndpoint()).toBeUndefined()
  })
})

describe('RemoteBrowserClient', () => {
  it('opens, controls, and closes with the same-origin credentials policy', async () => {
    const requests: Array<{ readonly input: RequestInfo | URL; readonly init: RequestInit | undefined }> = []
    const client = new RemoteBrowserClient('/enterprise/api/browser', async (input, init) => {
      requests.push({ input, init })
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.endsWith('/sessions')) return Response.json({ sessionId: 'session-1', state: STATE }, { status: 201 })
      if (url.endsWith('/control')) return Response.json(STATE)
      return Response.json({ ok: true })
    })

    await expect(client.open({ url: STATE.url, width: 800, height: 600 }))
      .resolves.toEqual({ sessionId: 'session-1', state: STATE })
    await expect(client.control('session-1', { action: 'reload' })).resolves.toEqual(STATE)
    await client.close('session-1')

    expect(requests.map(request => ({
      url: requestUrl(request.input), method: request.init?.method, credentials: request.init?.credentials,
      cache: request.init?.cache, contentType: new Headers(request.init?.headers).get('content-type'),
    }))).toEqual([
      {
        url: '/enterprise/api/browser/sessions', method: 'POST', credentials: 'same-origin',
        cache: 'no-store', contentType: 'application/json',
      },
      {
        url: '/enterprise/api/browser/control', method: 'POST', credentials: 'same-origin',
        cache: 'no-store', contentType: 'application/json',
      },
      {
        url: '/enterprise/api/browser/close', method: 'POST', credentials: 'same-origin',
        cache: 'no-store', contentType: 'application/json',
      },
    ])
    const controlBody = requests[1]?.init?.body
    if (typeof controlBody !== 'string') throw new Error('expected a JSON control body')
    expect(JSON.parse(controlBody)).toEqual({ sessionId: 'session-1', action: 'reload' })
  })

  it('parses server-sent state and frame events and reports a stream ending', async () => {
    const encoder = new TextEncoder()
    const events: RemoteBrowserEvent[] = []
    const client = new RemoteBrowserClient('/enterprise/api/browser', async () => new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"type":"state","state":{"url":"https://example.com/",'))
          controller.enqueue(encoder.encode('"title":"Example","loading":false,"canGoBack":false,"canGoForward":false}}\n\n'))
          controller.enqueue(encoder.encode(': keepalive\n\ndata: {"type":"frame","data":"abc","width":800,"height":600}\n\n'))
          controller.close()
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ))

    await expect(client.stream('session/with space', (event) => { events.push(event) }, new AbortController().signal))
      .rejects.toMatchObject({ status: 0, message: '' })
    const [stateEvent, frameEvent] = events
    expect(stateEvent).toMatchObject({ type: 'state', state: { url: 'https://example.com/' } })
    expect(frameEvent).toEqual({ type: 'frame', data: 'abc', width: 800, height: 600 })
  })

  it('surfaces safe API errors and malformed session results', async () => {
    const client = new RemoteBrowserClient('/api', async (input) => {
      const url = requestUrl(input)
      if (url.endsWith('/sessions')) return Response.json({ sessionId: '' }, { status: 201 })
      return Response.json({ error: { message: '当前账号打开的远程浏览器过多' } }, { status: 429 })
    })

    await expect(client.open({ url: STATE.url, width: 800, height: 600 }))
      .rejects.toMatchObject({ status: 502 })
    await expect(client.control('session-1', { action: 'back' }))
      .rejects.toMatchObject({ status: 429, message: '当前账号打开的远程浏览器过多' })
  })
})
