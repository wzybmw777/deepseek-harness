/** Same-origin HTTP transport for server-side Chromium pages. */

import type {
  RemoteBrowserControl,
  RemoteBrowserEvent,
  RemoteBrowserOpenResult,
  RemoteBrowserViewState,
} from '../../../types.ts'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** One rejected remote-browser request with its HTTP status when available. */
export class RemoteBrowserRequestError extends Error {
  /** @param status - HTTP status, or zero when the event stream ended. @param message - safe diagnostic. */
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

/**
 * Call the enterprise-owned remote Browser API.
 * The endpoint is same-origin, so the normal enterprise session cookie authenticates every call.
 */
export class RemoteBrowserClient {
  /** @param endpoint - API prefix such as `/enterprise/api/browser`. @param request - injectable fetch for tests. */
  constructor(
    private readonly endpoint: string,
    private readonly request: FetchLike = globalThis.fetch.bind(globalThis),
  ) {}

  /**
   * Allocate one Chromium page.
   * @param input - requested address and initial CSS viewport.
   * @param signal - allocation cancellation.
   * @returns the opaque session capability and initial state.
   */
  async open(
    input: { readonly url: string; readonly width: number; readonly height: number },
    signal?: AbortSignal,
  ): Promise<RemoteBrowserOpenResult> {
    const response = await this.post('/sessions', input, signal)
    const value = await response.json() as RemoteBrowserOpenResult
    if (typeof value.sessionId !== 'string' || value.sessionId === '') {
      throw new RemoteBrowserRequestError(502, '')
    }
    return value
  }

  /**
   * Send one input or navigation operation.
   * @param sessionId - opaque session capability.
   * @param control - operation to apply.
   * @returns Chromium's latest page state.
   */
  async control(sessionId: string, control: RemoteBrowserControl): Promise<RemoteBrowserViewState> {
    const response = await this.post('/control', { sessionId, ...control })
    return await response.json() as RemoteBrowserViewState
  }

  /**
   * Close one Chromium page.
   * @param sessionId - opaque session capability.
   */
  async close(sessionId: string): Promise<void> {
    await this.post('/close', { sessionId })
  }

  /**
   * Consume one authenticated server-sent event stream.
   * @param sessionId - opaque session capability.
   * @param listener - decoded state, frame, and failure events.
   * @param signal - stream cancellation.
   */
  async stream(sessionId: string, listener: (event: RemoteBrowserEvent) => void, signal: AbortSignal): Promise<void> {
    const response = await this.request(`${this.endpoint}/frames?session=${encodeURIComponent(sessionId)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'text/event-stream' },
      signal,
    })
    if (!response.ok) throw await requestFailure(response)
    if (response.body === null) throw new RemoteBrowserRequestError(502, '')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      for (;;) {
        const boundary = buffer.indexOf('\n\n')
        if (boundary === -1) break
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const data = block.split('\n')
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trimStart())
          .join('\n')
        if (data !== '') listener(JSON.parse(data) as RemoteBrowserEvent)
      }
    }
    if (!signal.aborted) throw new RemoteBrowserRequestError(0, '')
  }

  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    const response = await this.request(`${this.endpoint}${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...signal === undefined ? {} : { signal },
    })
    if (!response.ok) throw await requestFailure(response)
    return response
  }
}

async function requestFailure(response: Response): Promise<RemoteBrowserRequestError> {
  let message = ''
  try {
    const value = await response.json() as { readonly error?: { readonly message?: unknown } }
    if (typeof value.error?.message === 'string' && value.error.message !== '') message = value.error.message
  } catch {
    // A non-JSON proxy failure still exposes its HTTP status.
  }
  return new RemoteBrowserRequestError(response.status, message)
}
