/** A compact, anchored plan and points summary owned by the client plugin. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button, IconCloseOutlineRegular, MenuSurface } from '@deepseek-ai/dsh-client-ui-primitives'
import { describeError, type ResourcePanelProps } from './common.tsx'
import { workbenchProducts, type PlanSummary, type PointsWallet, type ProductIdentity } from './product-api.ts'
import { enterprisePagePath } from './public-path.ts'
import css from './Product.module.css'

/** Same-document event used by quota and account-menu triggers. */
export const USAGE_OPEN_EVENT = 'dsh-enterprise-usage-open'

/**
 * Render a portal beside the existing quota trigger without replacing the chat page.
 * @param props - localized copy.
 * @returns transient summary.
 */
export function UsageSummary({ t }: Pick<ResourcePanelProps, 't'>): ReactNode {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [plan, setPlan] = useState<PlanSummary | null>(null)
  const [wallet, setWallet] = useState<PointsWallet | null>(null)
  const [identity, setIdentity] = useState<ProductIdentity | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' })
  const surface = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const requestId = useRef(0)
  const alive = useRef(false)
  const refresh = useCallback(async (): Promise<void> => {
    const request = ++requestId.current
    setLoading(true)
    try {
      const [billing, points, member] = await Promise.all([
        workbenchProducts.billing(), workbenchProducts.wallet(), workbenchProducts.identity(),
      ])
      if (!alive.current || request !== requestId.current) return
      setPlan(billing); setWallet(points.wallet); setIdentity(member); setError(null)
    } catch (caught) {
      if (alive.current && request === requestId.current) setError(describeError(caught, t, 'error.load'))
    } finally { if (alive.current && request === requestId.current) setLoading(false) }
  }, [t])
  useEffect(() => {
    alive.current = true
    const open = (event: Event): void => {
      const candidate: unknown = (event as CustomEvent<unknown>).detail
      if (candidate instanceof HTMLElement && candidate.isConnected) setAnchor(previous => previous === candidate ? null : candidate)
    }
    window.addEventListener(USAGE_OPEN_EVENT, open)
    return () => { alive.current = false; requestId.current++; window.removeEventListener(USAGE_OPEN_EVENT, open) }
  }, [])
  useEffect(() => {
    if (!anchor) return
    void refresh()
    const changed = (): void => { void refresh() }
    window.addEventListener('dsh-enterprise-points-changed', changed)
    return () => { requestId.current++; window.removeEventListener('dsh-enterprise-points-changed', changed) }
  }, [anchor, refresh])
  useLayoutEffect(() => {
    if (!anchor) return
    const place = (): void => {
      if (!anchor.isConnected) { setAnchor(null); return }
      const rect = anchor.getBoundingClientRect()
      const box = surface.current?.getBoundingClientRect()
      if (!box) return
      const left = Math.max(12, Math.min(rect.right - box.width, innerWidth - box.width - 12))
      const below = rect.bottom + 8
      const top = below + box.height <= innerHeight - 12 ? below : Math.max(12, rect.top - box.height - 8)
      setPosition({ left, top, visibility: 'visible' })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [anchor, plan, wallet, error, loading])
  useEffect(() => {
    if (!anchor) return
    if (anchor.hasAttribute('data-dsh-enterprise-quota')) anchor.setAttribute('aria-expanded', 'true')
    closeButton.current?.focus()
    const outside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !surface.current?.contains(event.target) && !anchor.contains(event.target)) setAnchor(null)
    }
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); setAnchor(null); if (anchor.isConnected) anchor.focus() }
    }
    const focus = (event: FocusEvent): void => {
      if (event.target instanceof Node && !surface.current?.contains(event.target) && !anchor.contains(event.target)) setAnchor(null)
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', keydown, true)
    document.addEventListener('focusin', focus, true)
    return () => {
      if (anchor.hasAttribute('data-dsh-enterprise-quota')) anchor.setAttribute('aria-expanded', 'false')
      document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', keydown, true); document.removeEventListener('focusin', focus, true)
    }
  }, [anchor])
  if (!anchor) return null
  const percent = Math.max(0, Math.min(100, plan?.quota.percentUsed ?? 0))
  const canManage = identity?.permissions.includes('settings.write') ?? false
  const number = (value: number): string => new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(value)
  return createPortal(<MenuSurface ref={surface} className={css.usage} style={position} role="dialog" aria-label={t('usage.title')} id="enterprise-usage-summary">
    <header className={css.usageHeader}><h2>{t('usage.title')}</h2><Button ref={closeButton} size="sm" icon={<IconCloseOutlineRegular size={16} />} aria-label={t('common.close')}
      onClick={() => { setAnchor(null); if (anchor.isConnected) anchor.focus() }} /></header>
    {error ? <p className={css.error} role="alert">{error}</p> : null}
    {!plan && loading ? <p role="status" className={css.quiet}>{t('common.loading')}</p> : null}
    {plan ? <section className={css.usageGroup}>
      <div className={css.usageRow}><span>{plan.plan?.name ?? t('usage.noPlan')}</span><span>{t('usage.used', { percent: Math.round(percent) })}</span></div>
      <progress max={100} value={percent} aria-label={t('usage.planProgress')} />
      <p className={css.quiet}>{t('usage.period', { date: new Date(plan.cycle.endsAt).toLocaleDateString() })}</p>
    </section> : null}
    {wallet ? <section className={css.usageGroup} aria-label={t('usage.points')}>
      <span className={css.quiet}>{t('market.balance')}</span><p className={css.points}>{number(Math.max(0, wallet.balance - wallet.reserved))}</p>
      <div className={css.usageRow}><span>{t('usage.reserved')}</span><span>{number(wallet.reserved)}</span></div>
      {wallet.reserved > 0 ? <p className={css.quiet}>{t('usage.reservedHint')}</p> : null}
      <p className={css.quiet}>{t('usage.separate')}</p>
    </section> : null}
    <footer className={css.usageFooter}><Button size="sm" disabled={loading} onClick={() => { void refresh() }}>{error ? t('common.retry') : t('usage.refresh')}</Button>
      {canManage ? <a href={enterprisePagePath('/admin/agents')} target="_blank" rel="noopener noreferrer">{t('usage.details')}</a> : null}</footer>
  </MenuSurface>, document.body)
}
