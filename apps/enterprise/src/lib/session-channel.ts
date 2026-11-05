/** Cross-tab notification shared with the Harness session guard. */
const CHANNEL_NAME = 'enterprise-session'

/** Tell every open workspace tab that the enterprise session ended. */
export function announceEnterpriseSignOut(): void {
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME)
    channel.postMessage({ type: 'signed-out' })
    channel.close()
  } catch {
    // Older browsers without BroadcastChannel still revalidate the session on their next request.
  }
}
