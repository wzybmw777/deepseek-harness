/** Minimal consumer market and owner-scoped artifact history. */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ProductLayout } from '../components/ProductLayout.tsx'
import { Icon } from '../components/Icon.tsx'
import { Badge, Button, EmptyState, ErrorPanel, Field, Modal, PageLoader, Textarea } from '../components/ui.tsx'
import { useAuth } from '../lib/auth.tsx'
import { productApi, type Agent, type Market } from '../lib/product-api.ts'
import { productCopy as c } from '../lib/product-copy.ts'
import { productTransaction } from '../lib/product-transaction.ts'
import styles from './Product.module.css'

function points(value: number): string { return value.toLocaleString('zh-CN', { maximumFractionDigits: 6 }) }
function duration(agent: Agent): string { return agent.durationDays === null ? c.permanent : `${agent.durationDays} ${c.days}` }

/** Consumer market keeps technical settings inside the administrative surface. */
export function MarketPage(): ReactNode {
  const { session } = useAuth()
  const [data, setData] = useState<Market | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [unlock, setUnlock] = useState<Agent | null>(null)
  const [selected, setSelected] = useState<Agent | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => {
    try { setData(await productApi.market()); setError(null) }
    catch (caught) { setError(caught instanceof Error ? caught.message : c.loadError) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  const pending = data?.jobs.some(job => job.state === 'queued' || job.state === 'running') ?? false
  useEffect(() => {
    if (!pending) return
    const timer = window.setInterval(() => { void refresh() }, 3000)
    return () => { window.clearInterval(timer) }
  }, [pending, refresh])

  const purchase = async (): Promise<void> => {
    if (!unlock || busy) return
    setBusy(true); setActionError(null)
    try {
      const transaction = await productTransaction(`${session?.user.id}:purchase`, { agentId: unlock.id })
      await productApi.purchase(unlock.id, transaction.key)
      transaction.complete(); setUnlock(null); await refresh()
    } catch (caught) { setActionError(caught instanceof Error ? caught.message : c.purchaseRetry) }
    finally { setBusy(false) }
  }
  const run = async (): Promise<void> => {
    if (!selected || busy) return
    setBusy(true); setActionError(null)
    try {
      const transaction = await productTransaction(`${session?.user.id}:run`, { agentId: selected.id, input: input.trim() })
      await productApi.run(selected.id, input, transaction.key)
      transaction.complete(); setSelected(null); setInput(''); await refresh()
    } catch (caught) { setActionError(caught instanceof Error ? caught.message : c.loadError) }
    finally { setBusy(false) }
  }
  return <ProductLayout>
    <div className={styles.intro}>
      <div><p className={styles.eyebrow}>{c.eyebrow}</p><h1>{c.title}</h1><p>{c.intro}</p></div>
      {data ? <div className={styles.wallet}><span>{c.balance}</span>
        <strong>{points(Math.max(0, data.wallet.balance - data.wallet.reserved))}</strong>
        {data.wallet.reserved > 0 ? <small>{c.held} {points(data.wallet.reserved)}</small> : null}</div> : null}
    </div>
    {error ? <ErrorPanel message={error} onRetry={() => { void refresh() }} /> : null}
    {!data && !error ? <PageLoader /> : null}
    {data ? <>
      {data.agents.length === 0 ? <EmptyState title={c.empty} description={c.emptyDetail} />
        : <section className={styles.agents} aria-label={c.market}>
          {data.agents.map(agent => <article className={styles.agent} key={agent.id}>
            <div className={styles.cardTop}><span className={styles.agentIcon}><Icon name={agent.output === 'pptx' ? 'workspace' : 'spark'} size={22} /></span><span>{agent.category}</span>
              {agent.entitlement?.active ? <Badge tone="success">{c.unlocked}</Badge> : null}</div>
            <h2>{agent.title}</h2><p className={styles.agentDescription}>{agent.description}</p>
            <div className={styles.tags}><span>{c.outputs[agent.output]}</span><span>{duration(agent)}</span></div>
            <div className={styles.cardBottom}>
              <span>{agent.entitlement?.active ? (agent.entitlement.expiresAt ? `${c.expiry} ${new Date(agent.entitlement.expiresAt).toLocaleDateString('zh-CN')}` : c.permanent) : `${points(agent.price)} ${c.points}`}</span>
              <Button variant={agent.entitlement?.active ? 'primary' : 'secondary'} disabled={agent.entitlement?.active ? (!data.wallet.canRun || pending) : !data.wallet.canPurchase}
                onClick={() => { setActionError(null); if (agent.entitlement?.active) setSelected(agent); else setUnlock(agent) }}>
                {agent.entitlement?.active ? c.use : c.unlock}</Button>
            </div>
          </article>)}
        </section>}
      <p className={styles.billingNote}>{c.billing}{!data.wallet.canPurchase || !data.wallet.canRun ? ` ${c.notAllowed}` : ''}</p>
      <section className={styles.history}><div className={styles.sectionHeading}><h2>{c.recent}</h2><Button variant="ghost" size="small" icon="activity" onClick={() => { void refresh() }}>{c.refresh}</Button></div>
        {data.jobs.length === 0 ? <p className={styles.quiet}>{c.noJobs}</p>
          : data.jobs.map(job => <article className={styles.job} key={job.id}>
            <div className={styles.jobHead}><div><h3>{job.title}</h3><time>{new Date(job.createdAt).toLocaleString('zh-CN')}</time></div><Badge tone={job.state === 'completed' ? 'success' : job.state === 'failed' || job.state === 'interrupted' ? 'danger' : 'neutral'}>{c.states[job.state]}</Badge></div>
            <p className={styles.jobInput}>{job.input}</p>
            {job.result ? <p className={styles.result}>{job.result}</p> : null}
            {job.error ? <p className={styles.failure} role="alert">{job.error}</p> : null}
            <footer><small>{c.charged} {points(job.charged)} {c.points}</small>
              {job.artifact && job.state === 'completed' ? <a className="button button-primary button-small" href={productApi.download(job.id)}>{c.download}</a> : null}</footer>
          </article>)}
      </section>
      <details className={styles.ledger}><summary>{c.ledger}</summary>{data.ledger.length === 0 ? <p>{c.noLedger}</p> : data.ledger.map(row => <div key={row.id}><span>{c.ledgerKinds[row.kind as keyof typeof c.ledgerKinds] ?? row.kind}</span><time>{new Date(row.createdAt).toLocaleString('zh-CN')}</time><span>{row.delta > 0 ? '+' : ''}{points(row.delta)}</span></div>)}</details>
    </> : null}
    <Modal open={unlock !== null} onClose={() => { if (!busy) setUnlock(null) }} title={c.unlockTitle} description={c.unlockDetail}
      footer={<><Button disabled={busy} onClick={() => { setUnlock(null) }}>{c.cancel}</Button><Button variant="primary" loading={busy} onClick={() => { void purchase() }}>{c.confirm}</Button></>}>
      {unlock ? <div className={styles.unlock}>
        <h3>{unlock.title}</h3><p>{points(unlock.price)} {c.points} · {duration(unlock)}</p><p>{c.billing}</p></div> : null}
      {actionError ? <p className={styles.failure} role="alert">{actionError}</p> : null}
    </Modal>
    <Modal open={selected !== null} onClose={() => { if (!busy) setSelected(null) }} title={selected?.title ?? c.market}
      footer={<><Button disabled={busy} onClick={() => { setSelected(null) }}>{c.cancel}</Button><Button variant="primary" disabled={!input.trim() || pending} loading={busy} onClick={() => { void run() }}>{selected?.output === 'pptx' ? c.quick : c.submit}</Button></>}>
      <Field label={c.material} htmlFor="agent-material" hint={c.materialHelp}><Textarea disabled={busy} id="agent-material" rows={10} value={input} maxLength={30_000} placeholder={c.materialHint} onChange={(event) => { setInput(event.target.value) }} /></Field>
      <p className={styles.quiet}>{c.executionNote}</p>{actionError ? <p className={styles.failure} role="alert">{actionError}</p> : null}
    </Modal>
  </ProductLayout>
}
