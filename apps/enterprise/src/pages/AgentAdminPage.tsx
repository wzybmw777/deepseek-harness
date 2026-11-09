import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
/** Administrative market revisions, billing rates, and explicit member allocations. */
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Badge, Button, Card, ErrorPanel, Field, FormGrid, Input, PageHeader, PageLoader, SectionTitle, Select, Textarea } from '../components/ui.tsx'
import { useAuth } from '../lib/auth.tsx'
import { productApi, type ManagedAgent, type ProductAdmin, type ProductReview } from '../lib/product-api.ts'
import { productCopy as c } from '../lib/product-copy.ts'
import { productTransaction } from '../lib/product-transaction.ts'
import styles from './Product.module.css'

function blank(): ManagedAgent {
  return { id: randomUUID(), title: c.defaultTitle, description: c.defaultDescription, category: c.defaultCategory,
    output: 'text', executor: 'text', price: 0, durationDays: 30, published: false, modelId: '',
    systemPrompt: c.defaultPrompt, skill: c.defaultSkill, revision: 0 }
}

function ReviewForm({ review, busy, resolve }: {
  review: ProductReview
  busy: boolean
  resolve: (input: number, output: number, note: string) => void
}): ReactNode {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [note, setNote] = useState('')
  return <form className={styles.form} onSubmit={(event) => { event.preventDefault(); resolve(Number(input), Number(output), note) }}>
    <p className={styles.quiet}>{review.jobId} · {c.held} {review.reserved}</p>
    <Field label={c.verifiedInput} htmlFor={`review-input-${review.id}`}><Input disabled={busy} id={`review-input-${review.id}`} type="number" required min={0} step={1} max={10_000_000} value={input} onChange={(event) => { setInput(event.target.value) }} /></Field>
    <Field label={c.verifiedOutput} htmlFor={`review-output-${review.id}`}><Input disabled={busy} id={`review-output-${review.id}`} type="number" required min={0} step={1} max={10_000_000} value={output} onChange={(event) => { setOutput(event.target.value) }} /></Field>
    <Field label={c.evidence} htmlFor={`review-note-${review.id}`}><Input disabled={busy} id={`review-note-${review.id}`} required maxLength={1000} value={note} onChange={(event) => { setNote(event.target.value) }} /></Field>
    <Button loading={busy} type="submit">{c.reconcile}</Button>
  </form>
}

/** Product settings remain separate from ordinary users' creation flow. */
export function AgentAdminPage(): ReactNode {
  const { session } = useAuth()
  const [data, setData] = useState<ProductAdmin | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editor, setEditor] = useState<ManagedAgent | null>(null)
  const [inputRate, setInputRate] = useState('')
  const [outputRate, setOutputRate] = useState('')
  const [memberId, setMemberId] = useState('')
  const [purchase, setPurchase] = useState(false)
  const [run, setRun] = useState(false)
  const [credit, setCredit] = useState('')
  const [reason, setReason] = useState('')
  const [grantAgent, setGrantAgent] = useState('')
  const [grantDays, setGrantDays] = useState('30')
  const [permanent, setPermanent] = useState(false)
  const refresh = useCallback(async () => {
    try {
      const next = await productApi.admin(); setData(next); setError(null)
      setEditor(current => current ?? next.agents[0] ?? blank())
      setInputRate(next.rates ? String(next.rates.input) : ''); setOutputRate(next.rates ? String(next.rates.output) : '')
    } catch (caught) { setError(caught instanceof Error ? caught.message : c.loadError) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  const member = data?.members.find(item => item.id === memberId)
  useEffect(() => { setPurchase(member?.wallet.canPurchase ?? false); setRun(member?.wallet.canRun ?? false) }, [member])

  const action = async (operation: () => Promise<unknown>): Promise<void> => {
    if (busy) return
    setBusy(true); setMessage(null); setError(null)
    try { await operation(); setMessage(c.saved); await refresh() }
    catch (caught) { setError(caught instanceof Error ? caught.message : c.loadError) }
    finally { setBusy(false) }
  }
  const submit = (event: FormEvent, operation: () => Promise<unknown>): void => { event.preventDefault(); void action(operation) }
  const update = <K extends keyof ManagedAgent>(key: K, value: ManagedAgent[K]): void => {
    setEditor(current => current ? { ...current, [key]: value } : current)
  }
  return <div className="admin-page">
    <PageHeader title={c.adminTitle} description={c.adminIntro} actions={<Button disabled={busy} onClick={() => { setEditor(blank()) }} icon="plus">{c.newAgent}</Button>} />
    {error ? <ErrorPanel message={error} onRetry={() => { void refresh() }} /> : null}
    {message ? <p className={styles.success} role="status">{message}</p> : null}
    {!data ? <PageLoader /> : <div className={styles.adminGrid}>
      <Card><SectionTitle title={c.catalog} /><div className={styles.catalogList}>{data.agents.map(agent => <button disabled={busy} type="button" className={editor?.id === agent.id ? styles.selectedItem : ''} onClick={() => { setEditor(agent) }} key={agent.id}>
        <span>{agent.title}</span><Badge tone={agent.published ? 'success' : 'neutral'}>{agent.published ? c.published : c.draft}</Badge></button>)}</div>
      {editor ? <form className={styles.form} onSubmit={(event) => {
        submit(event, async () => { setEditor(await productApi.save(editor)) })
      }}>
        <FormGrid><Field label={c.name} htmlFor="agent-name"><Input disabled={busy} id="agent-name" value={editor.title} required maxLength={80} onChange={(event) => { update('title', event.target.value) }} /></Field>
          <Field label={c.category} htmlFor="agent-category"><Input disabled={busy} id="agent-category" value={editor.category} required maxLength={40} onChange={(event) => { update('category', event.target.value) }} /></Field></FormGrid>
        <Field label={c.description} htmlFor="agent-description"><Textarea disabled={busy} id="agent-description" value={editor.description} rows={3} required maxLength={1000} onChange={(event) => { update('description', event.target.value) }} /></Field>
        <FormGrid><Field label={c.executor} htmlFor="agent-executor"><Select disabled={busy} id="agent-executor" value={editor.executor} onChange={(event) => {
          const executor = event.target.value as ManagedAgent['executor']; setEditor({ ...editor, executor, output: executor === 'ppt-master' ? 'pptx' : executor })
        }}><option value="ppt-master">{c.pptExecutor}</option><option value="text">{c.textExecutor}</option><option value="video">{c.videoExecutor}</option></Select></Field>
        <Field label={c.model} htmlFor="agent-model"><Select disabled={busy} id="agent-model" required={editor.published} value={editor.modelId} onChange={(event) => { update('modelId', event.target.value) }}><option value="">{c.selectModel}</option>{data.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</Select></Field></FormGrid>
        <FormGrid><Field label={c.price} htmlFor="agent-price"><Input disabled={busy} id="agent-price" type="number" min={0} max={1_000_000} step={1} required value={editor.price} onChange={(event) => { update('price', Number(event.target.value)) }} /></Field>
          <Field label={c.duration} htmlFor="agent-duration"><Select disabled={busy} id="agent-duration" value={editor.durationDays === null ? 'permanent' : editor.durationDays === 30 ? '30' : 'custom'} onChange={(event) => { update('durationDays', event.target.value === 'permanent' ? null : event.target.value === '30' ? 30 : 7) }}>
            <option value="30">{c.thirty}</option><option value="custom">{c.custom}</option><option value="permanent">{c.permanent}</option></Select></Field></FormGrid>
        {editor.durationDays !== null && editor.durationDays !== 30 ? <Field label={c.durationDays} htmlFor="agent-days"><Input disabled={busy} id="agent-days" type="number" min={1} max={3650} required value={editor.durationDays} onChange={(event) => { update('durationDays', Number(event.target.value)) }} /></Field> : null}
        <Field label={c.systemPrompt} htmlFor="agent-prompt"><Textarea disabled={busy} id="agent-prompt" rows={6} maxLength={30_000} required value={editor.systemPrompt} onChange={(event) => { update('systemPrompt', event.target.value) }} /></Field>
        <Field label={c.skill} htmlFor="agent-skill"><Textarea disabled={busy} id="agent-skill" rows={6} maxLength={30_000} required value={editor.skill} onChange={(event) => { update('skill', event.target.value) }} /></Field>
        <label className={styles.check}><input disabled={busy} type="checkbox" checked={editor.published} onChange={(event) => { update('published', event.target.checked) }} />{c.publish}</label>
        <p className={styles.quiet}>{c.saveHint}</p><Button type="submit" loading={busy} variant="primary">{c.save}</Button>
      </form> : null}
      </Card>
      <div className={styles.sideForms}>
        {data.reviews.length > 0 ? <Card>
          <SectionTitle title={c.reviews} description={c.reviewHint} />
          {data.reviews.map(review => <ReviewForm key={review.id} review={review} busy={busy}
            resolve={(input, output, note) => { void action(() => productApi.reconcile(review.id, input, output, note)) }} />)}
        </Card> : null}
        <Card><SectionTitle title={c.ratesTitle} description={c.rateHint} />
          <form className={styles.form} onSubmit={(event) => {
            submit(event, () => productApi.rates(Number(inputRate), Number(outputRate)))
          }}>
            <Field label={c.inputRate} htmlFor="input-rate"><Input disabled={busy} id="input-rate" type="number" min={0} max={1_000_000} step={1} required value={inputRate} onChange={(event) => { setInputRate(event.target.value) }} /></Field>
            <Field label={c.outputRate} htmlFor="output-rate"><Input disabled={busy} id="output-rate" type="number" min={0} max={1_000_000} step={1} required value={outputRate} onChange={(event) => { setOutputRate(event.target.value) }} /></Field>
            <Button type="submit" loading={busy}>{c.save}</Button></form></Card>
        <Card><SectionTitle title={c.members} description={c.policyHint} /><Field label={c.member} htmlFor="points-member"><Select disabled={busy} id="points-member" value={memberId} onChange={(event) => { setMemberId(event.target.value) }}><option value="">{c.selectMember}</option>{data.members.map(item => <option key={item.id} value={item.id}>{item.name} · {item.teamName}</option>)}</Select></Field>
          {member ? <div className={styles.form}>
            <div className={styles.memberBalance}><span>{c.balance}</span><strong>{(member.wallet.balance - member.wallet.reserved).toLocaleString('zh-CN', { maximumFractionDigits: 6 })}</strong></div>
            <label className={styles.check}><input disabled={busy} type="checkbox" checked={purchase} onChange={(event) => { setPurchase(event.target.checked) }} />{c.purchasePermission}</label>
            <label className={styles.check}><input disabled={busy} type="checkbox" checked={run} onChange={(event) => { setRun(event.target.checked) }} />{c.runPermission}</label>
            <Button loading={busy} onClick={() => { void action(() => productApi.policy(member, purchase, run)) }}>{c.save}</Button>
            <hr />
            <form className={styles.form} onSubmit={(event) => { submit(event, async () => {
              const transaction = await productTransaction(`${session?.user.id}:credit`, { userId: member.id, teamId: member.teamId, points: Number(credit), note: reason })
              await productApi.credit(member, Number(credit), transaction.key, reason); transaction.complete(); setCredit(''); setReason('')
            }) }}>
              <Field label={c.creditAmount} htmlFor="credit-amount"><Input disabled={busy} id="credit-amount" type="number" min={1} max={1_000_000} step={1} required value={credit} onChange={(event) => { setCredit(event.target.value) }} /></Field>
              <Field label={c.reason} htmlFor="credit-reason"><Input disabled={busy} id="credit-reason" required maxLength={300} value={reason} onChange={(event) => { setReason(event.target.value) }} /></Field>
              <Button type="submit" loading={busy}>{c.credit}</Button>
            </form><hr />
            <form className={styles.form} onSubmit={(event) => {
              submit(event, () => productApi.grant(member, grantAgent,
                permanent ? null : new Date(Date.now() + Number(grantDays) * 86_400_000).toISOString(), false))
            }}>
              <Field label={c.grantAgent} htmlFor="grant-agent"><Select disabled={busy} id="grant-agent" required value={grantAgent} onChange={(event) => { setGrantAgent(event.target.value) }}><option value="">{c.grantAgent}</option>{data.agents.map(agent => <option value={agent.id} key={agent.id}>{agent.title}</option>)}</Select></Field>
              <label className={styles.check}><input disabled={busy} type="checkbox" checked={permanent} onChange={(event) => { setPermanent(event.target.checked) }} />{c.grantPermanent}</label>
              {!permanent ? <Field label={c.grantDays} htmlFor="grant-days"><Input disabled={busy} id="grant-days" type="number" min={1} max={3650} required value={grantDays} onChange={(event) => { setGrantDays(event.target.value) }} /></Field> : null}
              <div className={styles.inline}><Button loading={busy} type="submit">{c.grant}</Button><Button loading={busy} disabled={!grantAgent} variant="danger" type="button" onClick={() => { void action(() => productApi.grant(member, grantAgent, null, true)) }}>{c.revoke}</Button></div>
            </form>
          </div> : null}
        </Card>
      </div>
    </div>}
  </div>
}
