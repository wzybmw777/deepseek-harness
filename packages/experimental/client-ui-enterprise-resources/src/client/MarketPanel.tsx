/** Curated agent catalog, plan-based access, and in-chat handoff. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Button,
  IconAgentPresetOutlineRegular,
  IconChecklistOutlineRegular,
  IconDataOutlineRegular,
  IconDatabaseOutlineRegular,
  IconDeliverDocRegular,
  IconGaugeOutlineRegular,
  IconGoalOutlineRegular,
  IconPlanOutlineRegular,
  IconPlayOutlineRegular,
  IconShieldOutlineRegular,
  IconSkillOutlineRegular,
  IconSparkleRegular,
  IconUsersOutlineRegular,
  IconWarningOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { describeError, EmptyState, ErrorState, FormError, LoadingState, PageFrame, ResourceDialog, SearchBox, type ResourcePanelProps } from './common.tsx'
import { marketTransaction, workbenchProducts, type AgentIcon, type MarketAgent, type MarketSnapshot, type ProductIdentity } from './product-api.ts'
import css from './Product.module.css'

export interface MarketPanelInjected { readonly useAgent: (id: string, title: string) => Promise<void> }

type CatalogFilter = 'all' | 'recommended' | 'unlocked'
type CatalogTab = 'featured' | 'expert' | 'team'

function icon(key: AgentIcon | undefined, size = 20): ReactNode {
  switch (key) {
    case 'strategy': return <IconPlanOutlineRegular size={size} />
    case 'operations': return <IconGaugeOutlineRegular size={size} />
    case 'brand': return <IconSparkleRegular size={size} />
    case 'growth': return <IconDataOutlineRegular size={size} />
    case 'marketing': return <IconGoalOutlineRegular size={size} />
    case 'finance': return <IconChecklistOutlineRegular size={size} />
    case 'organization': return <IconUsersOutlineRegular size={size} />
    case 'legal': return <IconShieldOutlineRegular size={size} />
    case 'image': return <IconDeliverDocRegular size={size} />
    case 'video': return <IconPlayOutlineRegular size={size} />
    case 'document': return <IconDeliverDocRegular size={size} />
    case 'chat': return <IconAgentPresetOutlineRegular size={size} />
    case 'knowledge': return <IconDatabaseOutlineRegular size={size} />
    default: return <IconSkillOutlineRegular size={size} />
  }
}

function firstLine(value: string | undefined): string {
  return (value ?? '').split('\n').map(line => line.trim()).filter(Boolean)[0] ?? ''
}

const GROUP_HINTS = new Set(['办公创作', '企业经营参谋', '超级数字员工', '专家团'])

function groupHint(t: ResourcePanelProps['t'], name: string): string {
  if (!GROUP_HINTS.has(name)) return ''
  return t(`market.groupHint.${name}` as 'market.groupHint.办公创作')
}

/**
 * Render the curated catalog with plan-based unlocking and in-chat usage.
 * @param props - localized main-panel props.
 * @returns agent catalog panel.
 */
export function MarketPanel({ t, useAgent }: ResourcePanelProps & MarketPanelInjected): ReactNode {
  const [data, setData] = useState<MarketSnapshot | null>(null)
  const [identity, setIdentity] = useState<ProductIdentity | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<string | null>(null)
  const [filter, setFilter] = useState<CatalogFilter>('all')
  const [tab, setTab] = useState<CatalogTab>('featured')
  const [detail, setDetail] = useState<MarketAgent | null>(null)
  const [busy, setBusy] = useState(false)
  const active = useRef(false)
  const busyRef = useRef(false)
  const sequence = useRef(0)
  const groupOf = (agent: MarketAgent): string => agent.group || agent.category || t('market.otherGroup')
  const kindOf = (agent: MarketAgent): string => agent.kind ?? 'agent'
  const refresh = useCallback(async (): Promise<void> => {
    const request = ++sequence.current
    try {
      const [snapshot, member] = await Promise.all([workbenchProducts.market(), workbenchProducts.identity()])
      if (!active.current || request !== sequence.current) return
      setData(snapshot); setIdentity(member); setError(null)
      setDetail(current => current === null ? null : snapshot.agents.find(agent => agent.id === current.id) ?? current)
    } catch (caught) {
      if (active.current && request === sequence.current) setError(describeError(caught, t, 'error.load'))
    }
  }, [t])
  useEffect(() => {
    active.current = true
    void refresh()
    return () => { active.current = false; sequence.current++ }
  }, [refresh])
  const closeDetail = (): void => { if (!busyRef.current) { setDetail(null); setActionError(null) } }
  const use = (agent: MarketAgent): void => {
    setDetail(null); setActionError(null)
    void useAgent(agent.id, agent.title).catch((caught: unknown) => { setError(describeError(caught, t, 'error.request')) })
  }
  const unlock = async (agent: MarketAgent): Promise<void> => {
    if (!identity || busyRef.current) return
    busyRef.current = true; setBusy(true); setActionError(null)
    try {
      const transaction = await marketTransaction(identity.user, 'purchase', { agentId: agent.id })
      await workbenchProducts.purchase(agent.id, transaction.key)
      transaction.complete()
      if (active.current) await refresh()
    } catch (caught) {
      if (active.current) setActionError(describeError(caught, t, 'error.request'))
    } finally { busyRef.current = false; if (active.current) setBusy(false) }
  }

  const term = query.trim().toLocaleLowerCase()
  const agents = useMemo(() => data?.agents.slice().sort((left, right) => (left.sortOrder ?? 100) - (right.sortOrder ?? 100)) ?? [], [data])
  const counts = useMemo(() => ({
    featured: agents.filter(agent => kindOf(agent) === 'agent').length,
    expert: agents.filter(agent => kindOf(agent) === 'expert').length,
    team: agents.filter(agent => kindOf(agent) === 'team').length,
  }), [agents])
  const scoped = agents.filter(agent => kindOf(agent) === (tab === 'featured' ? 'agent' : tab === 'expert' ? 'expert' : 'team'))
  const groups = [...new Set(scoped.map(groupOf))]
  const visible = scoped.filter(agent => (group === null || groupOf(agent) === group)
    && (filter === 'all' || (filter === 'unlocked' ? Boolean(agent.entitlement?.active) : agent.recommended))
    && (term === '' || `${agent.title} ${agent.alias ?? ''} ${agent.description} ${agent.tasks ?? ''} ${agent.deliverables ?? ''} ${agent.category} ${groupOf(agent)}`.toLocaleLowerCase().includes(term)))
  const sections = (group === null ? groups : [group])
    .map(name => ({ name, items: visible.filter(agent => groupOf(agent) === name) }))
    .filter(section => section.items.length > 0)
  const unlocked = scoped.filter(agent => agent.entitlement?.active).length
  const tabs: readonly { key: CatalogTab; label: string; count: number }[] = [
    { key: 'featured', label: t('market.tab.featured'), count: counts.featured },
    { key: 'expert', label: t('market.tab.experts'), count: counts.expert },
    { key: 'team', label: t('market.tab.teams'), count: counts.team },
  ]

  const access = (agent: MarketAgent): string => agent.entitlement?.active
    ? (agent.entitlement.expiresAt ? t('market.expires', { date: new Date(agent.entitlement.expiresAt).toLocaleDateString() }) : t('market.permanent'))
    : t('market.planUnlock')
  const limitReached = data !== null && data.access.agentLimit !== null && data.access.unlocked >= data.access.agentLimit
  const teamLocked = (agent: MarketAgent): boolean => agent.kind === 'team' && data !== null && !data.access.teams
  const planSummary = data === null ? '' : data.access.agentLimit === null
    ? t('market.planSummaryUnlimited', { plan: data.access.planName, unlocked: data.access.unlocked })
    : t('market.planSummary', { plan: data.access.planName, unlocked: data.access.unlocked, limit: data.access.agentLimit })
  const blocked = (agent: MarketAgent): string => teamLocked(agent)
    ? t('market.teamsLocked')
    : limitReached && !agent.entitlement?.active && !agent.teamUnlocked ? t('market.limitReached', { limit: data?.access.agentLimit ?? 0 }) : ''

  const facts = (agent: MarketAgent): ReactNode => <>
    {agent.kind === 'team' && agent.members.length > 0
      ? <section className={css.detailSection}>
        <h3><IconUsersOutlineRegular size={16} />{t('market.teamMembers')}</h3>
        <p>{agent.members.map(member => member.title).join('、')}</p>
      </section>
      : null}
    <section className={css.detailSection}>
      <h3><IconChecklistOutlineRegular size={16} />{t('market.detailTasks')}</h3>
      <p>{agent.tasks || t('market.detailMissing')}</p>
    </section>
    <section className={css.detailSection}>
      <h3><IconDeliverDocRegular size={16} />{t('market.detailMaterials')}</h3>
      <p>{agent.materials || t('market.detailMissing')}</p>
    </section>
    <section className={css.detailSection}>
      <h3><IconAgentPresetOutlineRegular size={16} />{t('market.detailDeliverables')}</h3>
      <p>{agent.deliverables || t('market.detailMissing')}</p>
    </section>
    <section className={css.detailSection}>
      <h3><IconSparkleRegular size={16} />{t('market.detailExample')}</h3>
      <p className={css.detailExample}>{agent.example || t('market.detailMissing')}</p>
    </section>
  </>

  return <PageFrame title={t('market.title')} description={t('market.subtitle')}
    actions={data ? <span className={css.balance}>{planSummary}</span> : undefined}>
    {error ? <ErrorState message={error} retryLabel={t('common.retry')} onRetry={() => { void refresh() }} /> : null}
    {!data && !error ? <LoadingState label={t('common.loading')} /> : null}
    {data ? <>
      <div className={css.marketTabs} role="tablist" aria-label={t('market.categories')}>
        {tabs.map(item => <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} aria-pressed={tab === item.key}
          onClick={() => { setTab(item.key); setGroup(null) }}>{item.label} <em>{item.count}</em></button>)}
      </div>
      {tab === 'team' && !data.access.teams ? <p className={css.lockNote} role="note">
        <IconShieldOutlineRegular size={16} /><span><strong>{t('market.teamLockedTitle')}</strong>{t('market.teamLockedDetail')}</span></p> : null}
      <div className={css.marketToolbar}>
        <SearchBox value={query} onChange={setQuery} label={t('market.search')} placeholder={t('market.search')} />
        <div className={css.filterRow} role="group" aria-label={t('market.filters')}>
          <button type="button" aria-pressed={filter === 'all'} onClick={() => { setFilter('all') }}>{t('market.all')}</button>
          <button type="button" aria-pressed={filter === 'recommended'} onClick={() => { setFilter('recommended') }}>{t('market.recommended')}</button>
          <button type="button" aria-pressed={filter === 'unlocked'} onClick={() => { setFilter('unlocked') }}>{t('market.unlockedFilter')}{unlocked > 0 ? ` ${unlocked}` : ''}</button>
        </div>
      </div>
      {groups.length > 1 ? <div className={css.categories} role="group" aria-label={t('market.categories')}>
        <button type="button" aria-pressed={group === null} onClick={() => { setGroup(null) }}>{t('market.allGroups')}</button>
        {groups.map(item => <button key={item} type="button" aria-pressed={group === item} onClick={() => { setGroup(item) }}>{item}</button>)}
      </div> : null}
      {visible.length === 0 ? <EmptyState title={t('market.empty')} description={t('market.emptyDetail')} icon={<IconSkillOutlineRegular size={24} />} />
        : <div className={css.catalog}>
          {sections.map(section => <section className={css.agentGroup} key={section.name} aria-labelledby={`agent-group-${encodeURIComponent(section.name)}`}>
            <header className={css.groupHeader}>
              <div><h2 id={`agent-group-${encodeURIComponent(section.name)}`}>{section.name}</h2>
                {groupHint(t, section.name) ? <p>{groupHint(t, section.name)}</p> : null}</div>
              <span>{t('market.count', { count: section.items.length })}</span>
            </header>
            <div className={css.agents}>{section.items.map(agent => <article
              className={css.agentCard} key={agent.id} data-recommended={agent.recommended || undefined}>
              <button type="button" className={css.agentOpen} onClick={() => { setDetail(agent); setActionError(null) }}>
                <span className={css.agentIcon} data-icon={agent.icon}>{icon(agent.icon, 22)}</span>
                <span className={css.agentIdentity}>
                  <span className={css.agentName}>{agent.title}</span>
                  <span className={css.agentCategory}>{groupOf(agent)}{agent.category ? ` · ${agent.category}` : ''}</span>
                </span>
                <span className={css.badges}>
                  {agent.recommended ? <span className={css.badge}>{t('market.recommendedBadge')}</span> : null}
                  {agent.entitlement?.active ? <span className={css.badge} data-state="unlocked">{t('market.unlocked')}</span> : null}
                </span>
              </button>
              <p className={css.description}>{agent.description}</p>
              {agent.kind === 'team' && agent.members.length > 0
                ? <p className={css.teamMembers}>{t('market.teamMembers')}: {agent.members.map(member => member.title).join(' · ')}</p>
                : null}
              <dl className={css.agentFacts}>
                <div><dt>{t('market.detailTasks')}</dt><dd>{firstLine(agent.tasks) || t('market.detailMissing')}</dd></div>
                <div><dt>{t('market.detailDeliverables')}</dt><dd>{firstLine(agent.deliverables) || t('market.detailMissing')}</dd></div>
              </dl>
              <footer><span>{agent.entitlement?.active ? access(agent) : ''}</span>
                {agent.entitlement?.active
                  ? <Button variant="primary" disabled={busy || !identity} onClick={() => { use(agent) }}>
                    {agent.kind === 'team' ? t('market.useTeam') : t('market.use')}
                  </Button>
                  : teamLocked(agent)
                    ? <Button variant="outline" disabled>{t('market.teamOnly')}</Button>
                    : <Button variant="outline" disabled={busy || !identity || (limitReached && !agent.teamUnlocked)}
                      title={blocked(agent) || undefined}
                      onClick={() => { setDetail(agent); setActionError(null) }}>{t('market.planUnlock')}</Button>}
              </footer>
            </article>)}</div>
          </section>)}</div>}
      <p className={css.note}>{t('market.planHint')}</p>
    </> : null}

    <ResourceDialog wide open={detail !== null} onClose={closeDetail} closeLabel={t('common.close')}
      title={detail ? detail.title : t('market.title')}
      footer={<><Button onClick={closeDetail} disabled={busy}>{t('common.close')}</Button>
        {detail?.entitlement?.active
          ? <Button variant="primary" onClick={() => { use(detail) }}>{detail.kind === 'team' ? t('market.useTeam') : t('market.useInChat')}</Button>
          : <Button variant="primary" disabled={busy || !identity || !detail || blocked(detail) !== ''}
            onClick={() => { if (detail) void unlock(detail) }}>
            {detail !== null && teamLocked(detail) ? t('market.teamOnly') : busy ? t('market.submitting') : t('market.unlock')}</Button>}</>}>
      {detail ? <div className={css.agentDetail}>
        <header className={css.detailHeader}>
          <span className={css.agentIcon} data-icon={detail.icon}>{icon(detail.icon, 28)}</span>
          <div><h2>{detail.title}</h2><p>{groupOf(detail)}{detail.category ? ` · ${detail.category}` : ''}{detail.alias ? ` · ${detail.alias}` : ''}</p></div>
          <div className={css.detailStatus}><strong>{access(detail)}</strong><span>{detail.entitlement?.active ? t('market.unlocked') : t('market.notEntitled')}</span></div>
        </header>
        <p className={css.detailIntro}>{detail.description}</p>
        {detail.disclaimer ? <p className={css.disclaimer}>
          <IconWarningOutlineRegular size={16} /><span>{detail.disclaimer}</span></p> : null}
        {facts(detail)}
        {blocked(detail) ? <p className={css.lockNote} role="note"><IconShieldOutlineRegular size={16} /><span>{blocked(detail)}</span></p>
          : <p className={css.note}>{t('market.planNote')}</p>}
        {actionError ? <FormError message={actionError} /> : null}
      </div> : null}
    </ResourceDialog>
  </PageFrame>
}
