/** Canvas and input adapter for one server-side Chromium page. */

import type { RemoteBrowserControl } from '../../../types.ts'
import type { BrowserPresentation } from '../../view/BrowserPresentation.ts'
import css from '../../view/Browser.module.css'

const MIN_WIDTH = 320
const MAX_WIDTH = 1600
const MIN_HEIGHT = 320
const MAX_HEIGHT = 1200
const RESIZE_DELAY_MILLISECONDS = 160

/** Host callbacks invoked by pointer, wheel, keyboard, and resize input. */
export interface RemoteBrowserPresentationEvents {
  /** @param control - operation to deliver to Chromium. */
  readonly control: (control: RemoteBrowserControl) => void
  /** @param width - measured surface width. @param height - measured surface height. */
  readonly resize: (width: number, height: number) => void
}

/** Own the visible remote canvas and every browser input surface. */
export class RemoteBrowserPresentation implements BrowserPresentation {
  private host: HTMLElement | undefined
  private surface: HTMLDivElement | undefined
  private canvas: HTMLCanvasElement | undefined
  private input: HTMLTextAreaElement | undefined
  private observer: ResizeObserver | undefined
  private resizeTimer: ReturnType<typeof setTimeout> | undefined
  private lastFrame: { readonly data: string; readonly width: number; readonly height: number } | undefined
  private frameGeneration = 0
  private pointerActive = false
  private disposed = false

  /** @param events - Host-side input and viewport sink. */
  constructor(private readonly events: RemoteBrowserPresentationEvents) {}

  /** @param viewportId - committed Sidebar content container. @returns physical attachment cleanup only. */
  mount(viewportId: string): () => void {
    const host = document.getElementById(viewportId)
    if (host === null) throw new Error('remote browser presentation: viewport is not mounted')
    this.detach()
    this.host = host
    this.render()
    this.reportSize()
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => { this.reportSize() })
      this.observer.observe(host)
    }
    return () => {
      if (this.host !== host) return
      this.detach()
    }
  }

  /**
   * Paint one JPEG frame from Chromium.
   * @param data - base64 JPEG bytes without a data-URL prefix.
   * @param width - Chromium viewport width at capture time.
   * @param height - Chromium viewport height at capture time.
   */
  showFrame(data: string, width: number, height: number): void {
    if (this.disposed) return
    this.lastFrame = { data, width, height }
    this.paint(data)
  }

  /** @param title - observed Chromium document title, used as the input surface label. */
  setTitle(title: string): void {
    if (title !== '' && this.input !== undefined) this.input.setAttribute('aria-label', title)
  }

  /** Remove DOM listeners and retained frame data. */
  dispose(): void {
    this.disposed = true
    if (this.resizeTimer !== undefined) clearTimeout(this.resizeTimer)
    this.detach()
    this.surface = undefined
    this.canvas = undefined
    this.input = undefined
    this.lastFrame = undefined
  }

  private render(): void {
    const host = this.host
    if (host === undefined || this.surface !== undefined) {
      if (host !== undefined && this.surface !== undefined) host.append(this.surface)
      return
    }
    const surface = document.createElement('div')
    surface.className = css.remoteSurface as string
    surface.dataset.sidebarBrowserFrame = 'remote'
    const canvas = document.createElement('canvas')
    canvas.className = css.remoteCanvas as string
    canvas.setAttribute('aria-hidden', 'true')
    const input = document.createElement('textarea')
    input.className = css.remoteInput as string
    input.autocomplete = 'off'
    input.autocapitalize = 'off'
    input.spellcheck = false
    input.setAttribute('role', 'application')
    surface.append(canvas, input)
    this.attachInput(input)
    this.surface = surface
    this.canvas = canvas
    this.input = input
    host.append(surface)
    if (this.lastFrame !== undefined) this.paint(this.lastFrame.data)
  }

  private attachInput(input: HTMLTextAreaElement): void {
    input.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 && event.button !== 1 && event.button !== 2) return
      event.preventDefault()
      input.focus({ preventScroll: true })
      this.pointerActive = true
      this.events.control({
        action: 'pointer', event: 'down', x: this.pointX(event), y: this.pointY(event),
        button: event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left',
      })
    })
    input.addEventListener('pointermove', (event) => {
      if (!this.pointerActive) return
      this.events.control({ action: 'pointer', event: 'move', x: this.pointX(event), y: this.pointY(event) })
    })
    const release = (event: PointerEvent): void => {
      if (!this.pointerActive) return
      this.pointerActive = false
      this.events.control({
        action: 'pointer', event: 'up', x: this.pointX(event), y: this.pointY(event),
        button: event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left',
      })
    }
    input.addEventListener('pointerup', release)
    input.addEventListener('pointercancel', release)
    input.addEventListener('wheel', (event) => {
      event.preventDefault()
      const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? Math.max(1, input.clientHeight) : 1
      this.events.control({ action: 'wheel', deltaX: event.deltaX * scale, deltaY: event.deltaY * scale })
    }, { passive: false })
    input.addEventListener('keydown', (event) => {
      if (event.isComposing || event.key === 'Process') return
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return
      const modified = event.ctrlKey || event.metaKey || event.altKey
      if (!modified && event.key.length === 1) {
        event.preventDefault()
        this.events.control({ action: 'insertText', text: event.key })
        return
      }
      event.preventDefault()
      const modifiers: ('Alt' | 'Control' | 'Meta' | 'Shift')[] = []
      if (event.altKey) modifiers.push('Alt')
      if (event.ctrlKey) modifiers.push('Control')
      if (event.metaKey) modifiers.push('Meta')
      if (event.shiftKey) modifiers.push('Shift')
      this.events.control({ action: 'key', key: event.key, ...modifiers.length === 0 ? {} : { modifiers } })
    })
    input.addEventListener('compositionend', (event) => {
      if (event.data !== '') this.events.control({ action: 'insertText', text: event.data })
      input.value = ''
    })
    input.addEventListener('paste', (event) => {
      const text = event.clipboardData?.getData('text')
      if (text === undefined || text === '') return
      event.preventDefault()
      this.events.control({ action: 'insertText', text })
    })
  }

  private detach(): void {
    this.observer?.disconnect()
    this.observer = undefined
    this.pointerActive = false
    this.surface?.remove()
    this.host = undefined
  }

  private reportSize(): void {
    const host = this.host
    if (host === undefined) return
    const rect = host.getBoundingClientRect()
    const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(rect.width)))
    const height = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(rect.height)))
    if (width === 0 || height === 0) return
    if (this.resizeTimer !== undefined) clearTimeout(this.resizeTimer)
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = undefined
      this.events.resize(width, height)
    }, RESIZE_DELAY_MILLISECONDS)
  }

  private pointX(event: PointerEvent): number {
    const rect = this.input?.getBoundingClientRect()
    if (rect === undefined || rect.width === 0) return 0
    return Math.max(0, Math.min((event.clientX - rect.left) / rect.width, 1)) * (this.canvas?.width ?? 1)
  }

  private pointY(event: PointerEvent): number {
    const rect = this.input?.getBoundingClientRect()
    if (rect === undefined || rect.height === 0) return 0
    return Math.max(0, Math.min((event.clientY - rect.top) / rect.height, 1)) * (this.canvas?.height ?? 1)
  }

  private paint(data: string): void {
    const canvas = this.canvas
    if (canvas === undefined || this.host === undefined) return
    const generation = ++this.frameGeneration
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      if (generation !== this.frameGeneration || this.canvas !== canvas || this.disposed) return
      if (canvas.width !== image.naturalWidth || canvas.height !== image.naturalHeight) {
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
      }
      canvas.getContext('2d')?.drawImage(image, 0, 0)
    }
    image.src = `data:image/jpeg;base64,${data}`
  }
}
