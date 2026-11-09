/** Curated agents, purchases, and deliverables inside the existing workbench. */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button, IconSkillOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { describeError, EmptyState, ErrorState, FormError, LoadingState, PageFrame, ResourceDialog, SearchBox, type ResourcePanelProps } from './common.tsx'
import { marketTransaction, workbenchProducts, type MarketAgent, type MarketSnapshot, type ProductIdentity } from './product-api.ts'
import css from './Product.module.css'

export interface MarketPanelInjected { readonly useAgent: (id: string, title: string) => Promise<void> }

/**
 * Render the marketplace without navigating away from the current chat document.
 * @param props - localized main-panel props.
 * @returns market panel.
 */
export function MarketPanel({ t, useAgent }: ResourcePanelProps & MarketPanelInjected): ReactNode {
  const [data, setData] = useState<MarketSnapshot | null>(null)
  const [identity, setIdentity] = useState<ProductIdentity | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [category, setCategory] = useState<string | null>(null)
  const [unlockedOnly, setUnlockedOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [selection, setSelection] = useState<MarketAgent | null>(null)
  const [busy, setBusy] = useState(false)
  const active = useRef(false)
  const busyRef = useRef(false)
  const sequence = useRef(0)
  const number = (value: number): string => new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(value)
  const duration = (agent: MarketAgent): string => agent.durationDays === null ? t('market.permanent') : t('market.duration', { days: agent.durationDays })
  const refresh = useCallback(async (): Promise<void> => {
    const request = ++sequence.current
    try {
      const [snapshot, member] = await Promise.all([workbenchProducts.market(), workbenchProducts.identity()])
      if (!active.current || request !== sequence.current) return
      setData(snapshot); setIdentity(member); setError(null)
    } catch (caught) {
      if (active.current && request === sequence.current) setError(describeError(caught, t, 'error.load'))
    }
  }, [t])
  useEffect(() => {
    active.current = true
    void refresh()
    return () => { active.current = false; sequence.current++ }
  }, [refresh])
  const close = (): void => { if (!busyRef.current) { setSelection(null); setActionError(null) } }
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!selection || !identity || busyRef.current) return
    busyRef.current = true; setBusy(true); setActionError(null)
    try {
      const transaction = await marketTransaction(identity.user, 'purchase', { agentId: selection.id })
      await workbenchProducts.purchase(selection.id, transaction.key)
      transaction.complete()
      window.dispatchEvent(new Event('dsh-enterprise-points-changed'))
      if (active.current) {
        setSelection(null); await refresh()
      }
    } catch (caught) {
      if (active.current) setActionError(describeError(caught, t, 'error.request'))
    } finally { busyRef.current = false; if (active.current) setBusy(false) }
  }
  const term = search.trim().toLocaleLowerCase()
  const categories = [...new Set(data?.agents.map(agent => agent.category) ?? [])]
  const agents = data?.agents.filter(agent => (category === null || agent.category === category)
    && (!unlockedOnly || agent.entitlement?.active)
    && (term === '' || `${agent.title} ${agent.description}`.toLocaleLowerCase().includes(term))) ?? []
  return <PageFrame title={t('market.title')} description={t('market.subtitle')}>
    <div className={css.tabs} role="group" aria-label={t('market.title')}>
      {data ? <span className={css.balance}>{t('market.balance')} <strong>{number(Math.max(0, data.wallet.balance - data.wallet.reserved))}</strong></span> : null}
    </div>
    {error ? <ErrorState message={error} retryLabel={t('common.retry')} onRetry={() => { void refresh() }} /> : null}
    {!data && !error ? <LoadingState label={t('common.loading')} /> : null}
    {data ? <>
      <div className={css.filters}>
        <SearchBox value={search} onChange={setSearch} label={t('market.search')} placeholder={t('market.search')} />
        <button type="button" className={css.filter} aria-pressed={unlockedOnly} onClick={() => { setUnlockedOnly(value => !value) }}>{t('market.unlockedFilter')}</button>
      </div>
      <div className={css.categories} role="group" aria-label={t('market.categories')}>
        <button type="button" aria-pressed={category === null} onClick={() => { setCategory(null) }}>{t('market.all')}</button>
        {categories.map(item => <button key={item} type="button" aria-pressed={category === item} onClick={() => { setCategory(item) }}>{item}</button>)}
      </div>
      {agents.length === 0 ? <EmptyState title={t('market.empty')} description={t('market.emptyDetail')} icon={<IconSkillOutlineRegular size={24} />} />
        : <div className={css.agents}>{agents.map(agent => <article className={css.agent} key={agent.id}>
          <div className={css.agentTop}><span className={css.agentIcon}><IconSkillOutlineRegular size={20} /></span><span>{agent.category}</span>{agent.entitlement?.active ? <span className={css.status} data-state="completed">{t('market.unlocked')}</span> : null}</div>
          <h2>{agent.title}</h2><p className={css.description}>{agent.description}</p>
          <div className={css.tags}><span>{t(`market.output.${agent.output}`)}</span><span>{duration(agent)}</span></div>
          <footer><span>{agent.entitlement?.active
            ? (agent.entitlement.expiresAt ? t('market.expires', { date: new Date(agent.entitlement.expiresAt).toLocaleDateString() }) : t('market.permanent'))
            : t('market.price', { amount: number(agent.price) })}</span>
          <Button variant={agent.entitlement?.active ? 'primary' : 'outline'} disabled={busy || !identity || (agent.entitlement?.active ? !data.wallet.canRun : !data.wallet.canPurchase)}
            onClick={() => { setActionError(null); if (agent.entitlement?.active) { void useAgent(agent.id, agent.title).catch((caught: unknown) => { setError(describeError(caught, t, 'error.request')) }) } else setSelection(agent) }}>
            {agent.entitlement?.active ? t('market.use') : t('market.unlock')}</Button>
          </footer>
        </article>)}</div>}
      <p className={css.note}>{t('market.billing')}{!data.wallet.canPurchase || !data.wallet.canRun ? ` · ${t('market.restricted')}` : ''}</p>
    </> : null}
    <ResourceDialog open={selection !== null} onClose={close} closeLabel={t('common.close')}
      title={selection ? t('market.confirmTitle', { name: selection.title }) : t('market.title')}
      footer={<><Button onClick={close} disabled={busy}>{t('common.cancel')}</Button><Button type="submit" form="enterprise-market-task" variant="primary"
        disabled={busy || !identity || !selection || !data || data.wallet.balance - data.wallet.reserved < selection.price}>
        {busy ? t('market.submitting') : t('market.confirm')}</Button></>}>
      <form id="enterprise-market-task" onSubmit={(event) => { void submit(event) }}>
        {selection ? <p className={css.note}>{t('market.confirmDetail', { amount: number(selection.price), duration: duration(selection) })}</p> : null}
        {actionError ? <FormError message={actionError} /> : null}
      </form>
    </ResourceDialog>
  </PageFrame>
}
