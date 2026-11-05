/** Compact team quota status in the workbench sidebar foot. */

import { useSyncExternalStore } from 'react'
import {
  IconChevronRightOutlineRegular, IconInfoOutlineRegular, IconPlanOutlineRegular, IconRefreshOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { DesktopQuotaSnapshot, DesktopQuotaStore } from './quota.ts'
import css from './QuotaStatus.module.css'

/** Shared operations supplied to every sidebar quota row. */
export interface QuotaStatusFace {
  readonly store: DesktopQuotaStore
  readonly openPurchase: (url: string) => void
}

/** Quota row composed by the sidebar footer-action slot. */
export type QuotaStatusProps =
  PropsRuntime<'sidebar.footer.action'> & PropsLocale<'enterpriseQuota'> & InjectFace<QuotaStatusFace>

/** Open a purchase page outside the Desktop renderer. */
export function openExternalPurchase(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

function tokens(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
}

function useQuota(store: DesktopQuotaStore): DesktopQuotaSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

/** Render the team balance without turning a transient failure into zero usage. */
export function QuotaStatus({ wide, store, openPurchase, t }: QuotaStatusProps) {
  const snapshot = useQuota(store)

  if (snapshot.status === 'loading') {
    return (
      <div className={`${css.root} ${wide ? css.wide : css.rail}`} role="status" aria-label={t('quota.loading')} aria-busy="true">
        {wide && <span className={css.skeletonIcon} aria-hidden="true" />}
        <span className={`${css.skeleton} ${wide ? '' : css.skeletonRail}`} aria-hidden="true" />
      </div>
    )
  }

  if (snapshot.status === 'unavailable') {
    const label = `${t('quota.unavailable')}，${t('quota.retry')}`
    return (
      <button type="button" className={`${css.root} ${css.unavailable} ${wide ? css.wide : css.rail}`}
        aria-label={label} title={label} onClick={() => { void store.refresh() }}>
        <IconRefreshOutlineRegular className={css.icon} size={16} aria-hidden="true" />
        {wide && <span className={css.unavailableLabel}>{t('quota.retry')}</span>}
      </button>
    )
  }

  const data = snapshot.data
  const remaining = data === undefined ? '—' : tokens(data.quota.remainingTokens)
  const personal = data === undefined ? '—' : tokens(data.quota.userTokens)
  const exhausted = snapshot.status === 'exhausted'
  const label = exhausted
    ? t('quota.exhausted')
    : `${t('quota.remaining', { tokens: remaining })} ${t('quota.personal', { tokens: personal })}`

  if (exhausted) {
    if (!wide) {
      return (
        <button type="button" className={`${css.root} ${css.exhausted} ${css.rail}`} data-state="exhausted"
          aria-label={`${label}，${t('quota.purchase')}`} title={`${label}，${t('quota.purchase')}`}
          disabled={data === undefined} onClick={() => { if (data !== undefined) openPurchase(data.purchaseUrl) }}>
          <IconInfoOutlineRegular className={css.icon} size={16} aria-hidden="true" />
        </button>
      )
    }
    return (
      <div className={`${css.root} ${css.exhausted} ${css.wide}`} data-state="exhausted"
        aria-label={label} title={label}>
        <IconInfoOutlineRegular className={css.icon} size={16} aria-hidden="true" />
        <span className={css.exhaustedLabel}>{t('quota.exhausted')}</span>
        <button type="button" className={css.purchase} aria-label={t('quota.purchase')} title={t('quota.purchase')}
          disabled={data === undefined} onClick={() => { if (data !== undefined) openPurchase(data.purchaseUrl) }}>
          <span>{t('quota.purchase')}</span>
          <IconChevronRightOutlineRegular size={13} aria-hidden="true" />
        </button>
      </div>
    )
  }

  return (
    <div className={`${css.root} ${wide ? css.wide : css.rail}`} data-state="available" aria-label={label} title={label}>
      <IconPlanOutlineRegular className={css.icon} size={16} aria-hidden="true" />
      {wide && (
        <span className={css.copy}>
          <span className={css.primary}>{t('quota.remaining', { tokens: remaining })}</span>
          <span className={css.secondary}>{t('quota.personal', { tokens: personal })}</span>
        </span>
      )}
    </div>
  )
}
