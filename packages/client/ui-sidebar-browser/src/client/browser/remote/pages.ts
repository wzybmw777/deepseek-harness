/** Assemble the server-side Chromium navigation and canvas faces. */

import type { BrowserPage, BrowserPageOptions } from '../BrowserPage.ts'
import { RemoteBrowserPresentation } from './RemoteBrowserPresentation.ts'
import { RemoteBrowserSession } from './RemoteBrowserSession.ts'

/**
 * Create one remote Chromium page without attaching DOM.
 * @param options - persisted navigation and source-tab callbacks.
 * @param endpoint - same-origin remote Browser API prefix.
 * @returns the navigation and presentation pair consumed by the Sidebar tab.
 */
export function createRemoteBrowserPage(options: BrowserPageOptions, endpoint: string): BrowserPage {
  const current: { session?: RemoteBrowserSession } = {}
  const presentation = new RemoteBrowserPresentation({
    control: (control) => { current.session?.controlFromPresentation(control) },
    resize: (width, height) => { current.session?.resizeViewport(width, height) },
  })
  const session = new RemoteBrowserSession(options, endpoint, presentation)
  current.session = session
  return { frame: session, presentation }
}
