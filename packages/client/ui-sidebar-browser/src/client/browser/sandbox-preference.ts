/** Process-wide Web Browser iframe sandbox preference persisted in this browser. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Storage key shared by every Browser tab and Session. */
export const BROWSER_SANDBOX_PREFERENCE_KEY = 'dsh.sidebar-browser.sandbox.v1'

/** Shared embedding-sandbox policy; Desktop providers do not expose this control. */
export interface BrowserSandboxPreference {
  /** @returns whether iframe sandbox restrictions are enabled. */
  getSnapshot(): boolean
  /** @param listener - policy invalidation. @returns unsubscribe callback. */
  subscribe(listener: () => void): () => void
  /** @param enabled - whether iframe sandbox restrictions are enabled. */
  setEnabled(enabled: boolean): void
}

/**
 * Create the shared Web Browser policy; an unset preference disables sandbox restrictions.
 * @returns the persisted preference.
 */
export function createBrowserSandboxPreference(): BrowserSandboxPreference {
  const store = createSnapshotStore(false, {
    persist: { name: BROWSER_SANDBOX_PREFERENCE_KEY },
  })
  return {
    getSnapshot: () => store.getSnapshot(),
    subscribe: listener => store.subscribe(listener),
    setEnabled: (enabled) => {
      if (store.getSnapshot() !== enabled) store.set(enabled)
    },
  }
}
