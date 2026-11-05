/** Browser entry for the enterprise token quota surface. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { QuotaNoticeBridge, type QuotaNoticeBridgeFace } from './QuotaNoticeBridge.tsx'
import { QuotaStatus, openExternalPurchase } from './QuotaStatus.tsx'
import { DesktopQuotaStore, DESKTOP_QUOTA_EXHAUSTED } from './quota.ts'
import { NS, de, en, es, fr, ja, pt, ru, zh } from './quota-locales.ts'

/** Services required by the quota row. */
export const inject = ['slots', 'locale']

export { DESKTOP_BILLING_PATH, DESKTOP_QUOTA_EXHAUSTED, DesktopQuotaStore } from './quota.ts'
export type { DesktopQuota, DesktopQuotaSnapshot, DesktopQuotaState, DesktopQuotaStoreOptions } from './quota.ts'
export { NS } from './quota-locales.ts'
export type { EnterpriseQuotaKey } from './quota-locales.ts'
export { QuotaNoticeBridge } from './QuotaNoticeBridge.tsx'
export type { QuotaNoticeBridgeFace } from './QuotaNoticeBridge.tsx'
export { QuotaStatus, openExternalPurchase } from './QuotaStatus.tsx'
export type { QuotaStatusFace, QuotaStatusProps } from './QuotaStatus.tsx'

/**
 * Register the team quota row and its localized dictionaries.
 * @param ctx - Client Context with slots and locale available.
 */
export function apply(ctx: Context): void {
  const store = new DesktopQuotaStore()
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'enterprise-desktop: quota dictionaries')
  ctx.effect(() => {
    const stop = store.start()
    return () => {
      stop()
      store.dispose()
    }
  }, 'enterprise-desktop: quota refresh')
  ctx.slots.inject('shell.quota-notice', () => ctx.slots.register({
    name: 'shell.quota-notice',
    locale: NS,
    select: owner => owner.code === DESKTOP_QUOTA_EXHAUSTED ? owner : null,
    inject: (): QuotaNoticeBridgeFace => ({ store }),
  }, QuotaNoticeBridge))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'enterprise-quota',
    order: -10,
    locale: NS,
    inject: () => ({ store, openPurchase: openExternalPurchase }),
  }, QuotaStatus))
}
