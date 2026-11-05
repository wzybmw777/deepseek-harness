import { describe, expect, it, vi } from 'vitest'
import type {
  RemoteBrowserControl,
  RemoteBrowserEvent,
  RemoteBrowserViewState,
} from '@deepseek-ai/dsh-client-ui-sidebar-browser/types'
import {
  normalizeRemoteBrowserUrl,
  RemoteBrowserPool,
  type RemoteBrowserRuntime,
  type RemoteBrowserRuntimeFactory,
} from '../src/remote-browser.ts'

const VIEWPORT = { width: 960, height: 720 }

class FakeRuntime implements RemoteBrowserRuntime {
  readonly navigations: string[] = []
  readonly resizes: Array<{ readonly width: number; readonly height: number }> = []
  readonly controls: RemoteBrowserControl[] = []
  readonly listeners = new Set<(event: RemoteBrowserEvent) => void>()
  closed = false
  private state: RemoteBrowserViewState

  constructor(url: string) {
    this.state = { url, title: new URL(url).hostname, loading: true, canGoBack: false, canGoForward: false }
  }

  getState(): RemoteBrowserViewState {
    return this.state
  }

  subscribe(listener: (event: RemoteBrowserEvent) => void): () => void {
    this.listeners.add(listener)
    listener({ type: 'state', state: this.state })
    return () => { this.listeners.delete(listener) }
  }

  async navigate(url: string): Promise<void> {
    this.navigations.push(url)
    this.state = { ...this.state, url, title: new URL(url).hostname, loading: false }
    this.emit({ type: 'state', state: this.state })
  }

  async back(): Promise<void> {
    this.controls.push({ action: 'back' })
  }

  async forward(): Promise<void> {
    this.controls.push({ action: 'forward' })
  }

  async reload(): Promise<void> {
    this.controls.push({ action: 'reload' })
  }

  async resize(width: number, height: number): Promise<void> {
    this.resizes.push({ width, height })
  }

  async pointer(control: Extract<RemoteBrowserControl, { action: 'pointer' }>): Promise<void> {
    this.controls.push(control)
  }

  async wheel(deltaX: number, deltaY: number): Promise<void> {
    this.controls.push({ action: 'wheel', deltaX, deltaY })
  }

  async key(control: Extract<RemoteBrowserControl, { action: 'key' | 'insertText' }>): Promise<void> {
    this.controls.push(control)
  }

  async close(): Promise<void> {
    this.closed = true
  }

  emit(event: RemoteBrowserEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

class FakeFactory implements RemoteBrowserRuntimeFactory {
  readonly created: FakeRuntime[] = []
  disposed = false

  async create(request: { readonly url: string; readonly width: number; readonly height: number }): Promise<RemoteBrowserRuntime> {
    expect(request.width).toBeGreaterThanOrEqual(320)
    expect(request.height).toBeGreaterThanOrEqual(320)
    const runtime = new FakeRuntime(request.url)
    this.created.push(runtime)
    return runtime
  }

  async dispose(): Promise<void> {
    this.disposed = true
  }
}

function poolConfig(overrides: Partial<{
  readonly maxSessions: number
  readonly maxSessionsPerUser: number
  readonly idleTimeoutMs: number
}> = {}) {
  return {
    maxSessions: 4,
    maxSessionsPerUser: 2,
    idleTimeoutMs: 60_000,
    blockedOrigins: ['https://console.example'],
    ...overrides,
  }
}

describe('normalizeRemoteBrowserUrl', () => {
  it('canonicalizes public HTTP(S) destinations', () => {
    expect(normalizeRemoteBrowserUrl('https://www.google.com/search?q=zhiliu'))
      .toBe('https://www.google.com/search?q=zhiliu')
    expect(normalizeRemoteBrowserUrl('HTTP://example.com:80/path')).toBe('http://example.com/path')
  })

  it.each([
    ['', 'invalid_browser_url'],
    ['not a url', 'invalid_browser_url'],
    ['file:///etc/passwd', 'unsupported_browser_protocol'],
    ['ftp://example.com/file', 'unsupported_browser_protocol'],
    ['https://name:password@example.com/', 'browser_credentials_forbidden'],
    ['http://localhost:3000/', 'browser_private_address'],
    ['http://service.localhost/', 'browser_private_address'],
    ['http://router.local/', 'browser_private_address'],
    ['http://metadata.internal/', 'browser_private_address'],
    ['http://127.0.0.1/', 'browser_private_address'],
    ['http://10.0.0.1/', 'browser_private_address'],
    ['http://[::1]/', 'browser_private_address'],
  ])('rejects %s', (value, code) => {
    expect(() => normalizeRemoteBrowserUrl(value)).toThrow(expect.objectContaining({ code, status: 400 }))
  })

  it('rejects the application origin and oversized addresses', () => {
    expect(() => normalizeRemoteBrowserUrl('https://console.example/path', ['https://console.example']))
      .toThrow(expect.objectContaining({ code: 'browser_application_origin' }))
    expect(() => normalizeRemoteBrowserUrl(`https://example.com/${'a'.repeat(17_000)}`))
      .toThrow(expect.objectContaining({ code: 'invalid_browser_url' }))
  })
})

describe('RemoteBrowserPool', () => {
  it('isolates sessions by exact owner and closes only the owner request', async () => {
    const factory = new FakeFactory()
    const pool = new RemoteBrowserPool(poolConfig(), factory)
    try {
      const opened = await pool.open('team-default:user-a', { url: 'https://example.com/', ...VIEWPORT })
      const runtime = factory.created[0]!
      await vi.waitFor(() => { expect(runtime.navigations).toEqual(['https://example.com/']) })

      await expect(pool.control('team-default:user-b', opened.sessionId, { action: 'reload' }))
        .rejects.toMatchObject({ status: 404, code: 'browser_session_not_found' })
      expect(() => pool.subscribe('team-default:user-b', opened.sessionId, vi.fn()))
        .toThrow(expect.objectContaining({ status: 404 }))

      await pool.close('team-default:user-b', opened.sessionId)
      await expect(pool.control('team-default:user-a', opened.sessionId, { action: 'reload' }))
        .resolves.toMatchObject({ url: 'https://example.com/' })

      await pool.close('team-default:user-a', opened.sessionId)
      expect(runtime.closed).toBe(true)
      await expect(pool.control('team-default:user-a', opened.sessionId, { action: 'reload' }))
        .rejects.toMatchObject({ status: 404 })
    } finally {
      await pool.dispose()
    }
    expect(factory.disposed).toBe(true)
  })

  it('reserves capacity across concurrent opens for one owner and the whole host', async () => {
    const pending: Array<(request: { readonly url: string; readonly width: number; readonly height: number }) => void> = []
    const factory: RemoteBrowserRuntimeFactory = {
      create: request => new Promise((resolve) => {
        pending.push(() => { resolve(new FakeRuntime(request.url)) })
      }),
      dispose: async () => {},
    }
    const pool = new RemoteBrowserPool(poolConfig({ maxSessions: 1, maxSessionsPerUser: 1 }), factory)
    try {
      const first = pool.open('team-default:user-a', { url: 'https://example.com/', ...VIEWPORT })
      await expect(pool.open('team-default:user-a', { url: 'https://example.org/', ...VIEWPORT }))
        .rejects.toMatchObject({ status: 429, code: 'browser_session_limit' })
      await expect(pool.open('team-default:user-b', { url: 'https://example.net/', ...VIEWPORT }))
        .rejects.toMatchObject({ status: 503, code: 'browser_capacity' })

      pending[0]!({ url: 'https://example.com/', ...VIEWPORT })
      await expect(first).resolves.toMatchObject({ state: { url: 'https://example.com/' } })
    } finally {
      await pool.dispose()
    }
  })

  it('replays retained failures and the latest state to late stream subscribers', async () => {
    const factory = new FakeFactory()
    const pool = new RemoteBrowserPool(poolConfig(), factory)
    try {
      const opened = await pool.open('team-default:user-a', { url: 'https://example.com/', ...VIEWPORT })
      const runtime = factory.created[0]!
      await vi.waitFor(() => { expect(runtime.navigations).toHaveLength(1) })
      runtime.emit({ type: 'failure', code: 'browser_page_crashed', message: '远程浏览器页面已崩溃' })

      const events: RemoteBrowserEvent[] = []
      const unsubscribe = pool.subscribe('team-default:user-a', opened.sessionId, (event) => { events.push(event) })
      expect(events).toEqual([
        expect.objectContaining({ type: 'state' }),
        { type: 'failure', code: 'browser_page_crashed', message: '远程浏览器页面已崩溃' },
      ])

      unsubscribe()
      runtime.emit({ type: 'state', state: { ...runtime.getState(), title: 'Changed' } })
      expect(events).toHaveLength(2)
    } finally {
      await pool.dispose()
    }
  })

  it('validates navigation controls and releases every runtime on disposal', async () => {
    const factory = new FakeFactory()
    const pool = new RemoteBrowserPool(poolConfig(), factory)
    const first = await pool.open('team-default:user-a', { url: 'https://example.com/', ...VIEWPORT })
    const second = await pool.open('team-default:user-a', { url: 'https://example.org/', ...VIEWPORT })
    await expect(pool.control('team-default:user-a', first.sessionId, {
      action: 'navigate', url: 'http://127.0.0.1/private',
    })).rejects.toMatchObject({ status: 400, code: 'browser_private_address' })

    await pool.control('team-default:user-a', first.sessionId, {
      action: 'resize', width: 10, height: 5000,
    })
    expect(factory.created[0]?.resizes.at(-1)).toEqual({ width: 320, height: 1200 })

    await pool.dispose()
    expect(factory.created).toHaveLength(2)
    expect(factory.created.every(runtime => runtime.closed)).toBe(true)
    expect(factory.disposed).toBe(true)
    await expect(pool.open('team-default:user-a', { url: 'https://example.net/', ...VIEWPORT }))
      .rejects.toMatchObject({ status: 503, code: 'browser_unavailable' })
    expect(second.sessionId).not.toBe(first.sessionId)
  })
})
