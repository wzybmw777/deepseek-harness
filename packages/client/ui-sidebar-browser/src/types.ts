/** Type-only Electron bridge declarations shared by the desktop shell and browser provider. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Main-issued identity of one guest reservation. */
export type DesktopBrowserLeaseId = Branded<'DesktopBrowserLeaseId'>

/** A guest's approved, process-local storage partition. */
export interface DesktopBrowserReservation {
  readonly lease: DesktopBrowserLeaseId
  readonly partition: string
}

/** Main-approved request to open an HTTP(S) page from an existing guest. */
export interface DesktopBrowserOpenRequest {
  readonly lease: DesktopBrowserLeaseId
  readonly url: string
}

/** Origin-scoped operations; no Electron objects or arbitrary IPC cross this interface. */
export interface DesktopBrowserBridge {
  /** @param workspace - resolved storage account. @returns one approved guest reservation. */
  acquire(workspace: string): Promise<DesktopBrowserReservation>
  /** @param lease - the caller's reservation. @returns after its guest has been destroyed. */
  release(lease: DesktopBrowserLeaseId): Promise<void>
  /** @param lease - originating guest. @param listener - approved URL consumer. @returns unsubscribe callback. */
  onOpenRequested(lease: DesktopBrowserLeaseId, listener: (url: string) => void): () => void
}

/** Browser-visible state reported by a server-side Chromium page. */
export interface RemoteBrowserViewState {
  /** Current HTTP(S) address, or the requested address before Chromium commits it. */
  readonly url: string
  readonly title: string
  readonly loading: boolean
  readonly canGoBack: boolean
  readonly canGoForward: boolean
}

/** Result of creating one server-side browser session. */
export interface RemoteBrowserOpenResult {
  readonly sessionId: string
  readonly state: RemoteBrowserViewState
}

/** Pointer buttons accepted by the remote browser surface. */
export type RemoteBrowserButton = 'left' | 'middle' | 'right'

/** One control operation sent to a server-side Chromium page. */
export type RemoteBrowserControl =
  | { readonly action: 'navigate'; readonly url: string }
  | { readonly action: 'back' }
  | { readonly action: 'forward' }
  | { readonly action: 'reload' }
  | { readonly action: 'resize'; readonly width: number; readonly height: number }
  | {
    readonly action: 'pointer'
    readonly event: 'click' | 'move' | 'down' | 'up'
    readonly x: number
    readonly y: number
    readonly button?: RemoteBrowserButton
  }
  | { readonly action: 'wheel'; readonly deltaX: number; readonly deltaY: number }
  | {
    readonly action: 'key'
    readonly key: string
    readonly modifiers?: readonly ('Alt' | 'Control' | 'Meta' | 'Shift')[]
  }
  | { readonly action: 'insertText'; readonly text: string }

/** Event stream emitted by a server-side Chromium page. */
export type RemoteBrowserEvent =
  | { readonly type: 'state'; readonly state: RemoteBrowserViewState }
  | { readonly type: 'frame'; readonly data: string; readonly width: number; readonly height: number }
  | { readonly type: 'failure'; readonly code: string; readonly message: string }
