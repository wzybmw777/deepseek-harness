/** Claim the frame-wide quota notice when the enterprise gateway exhausts the team allowance. */

import { useEffect } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { QuotaNoticeOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { DesktopQuotaStore } from './quota.ts'

/** Injected share of the enterprise quota notice bridge. */
export interface QuotaNoticeBridgeFace {
  readonly store: DesktopQuotaStore
}

type QuotaNoticeBridgeProps = PropsRuntime<'shell.quota-notice'>
  & { matched: QuotaNoticeOwnerProps }
  & InjectFace<QuotaNoticeBridgeFace>

/**
 * Move the gateway failure into the sidebar quota row and suppress Chat's generic toast.
 * @param props - the matched notice and the shared quota store.
 * @returns no surface of its own.
 */
export function QuotaNoticeBridge({ matched, store }: QuotaNoticeBridgeProps): null {
  useEffect(() => {
    store.noteGatewayError({ code: matched.code })
  }, [matched.code, store])
  return null
}
