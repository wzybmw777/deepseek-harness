/** Independent account binding and read-only knowledge access. */
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Badge, Button, Card, ErrorPanel, Field, Input, Modal, PageHeader, PageLoader, SectionTitle, Select, Textarea } from '../components/ui.tsx'
import { ProductLayout } from '../components/ProductLayout.tsx'
import { productApi, type FeilianStatus } from '../lib/product-api.ts'
import { productCopy as c } from '../lib/product-copy.ts'
import styles from './Product.module.css'

/** Password exchange stays transient; only safe binding metadata reaches this view. */
export function FeilianPage(): ReactNode {
  const [data, setData] = useState<FeilianStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [tenantSlug, setTenantSlug] = useState('')
  const [knowledgeBase, setKnowledgeBase] = useState('')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmUnbind, setConfirmUnbind] = useState(false)
  const refresh = useCallback(async () => {
    try { const next = await productApi.feilian(); setData(next); setError(null); setKnowledgeBase(current => next.knowledgeBases.some(item => item.id === current) ? current : next.knowledgeBases[0]?.id ?? '') }
    catch (caught) { setError(caught instanceof Error ? caught.message : c.loadError) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  const action = async (operation: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(true); setError(null)
    try { await operation() } catch (caught) { setError(caught instanceof Error ? caught.message : c.loadError) }
    finally { setPassword(''); setBusy(false) }
  }
  const bind = (event: FormEvent): void => {
    event.preventDefault()
    void action(async () => { await productApi.bindFeilian(email, password, tenantSlug); await refresh() })
  }
  return <ProductLayout section="knowledge">
    <PageHeader group={c.knowledge} title={c.feilian} description={c.feilianIntro} actions={<Button onClick={() => { void refresh() }} icon="activity">{c.refresh}</Button>} />
    {error ? <ErrorPanel message={error} onRetry={() => { void refresh() }} /> : null}
    {!data ? <PageLoader /> : <div className={styles.feilianContent}>
      <Card><SectionTitle title={c.feilian} actions={<Badge tone={data.state === 'connected' ? 'success' : 'neutral'}>{c.feilianStates[data.state]}</Badge>} />
        <p className={styles.quiet}>{c.feilianSeparate}</p>
        {!data.bound && data.available ? <form className={styles.form} onSubmit={bind}>
          <Field label={c.feilianEmail} htmlFor="feilian-email"><Input disabled={busy} id="feilian-email" type="email" maxLength={320} autoComplete="username" required value={email} onChange={(event) => { setEmail(event.target.value) }} /></Field>
          <Field label={c.feilianPassword} htmlFor="feilian-password"><Input disabled={busy} id="feilian-password" type="password" maxLength={200} autoComplete="current-password" required value={password} onChange={(event) => { setPassword(event.target.value) }} /></Field>
          <Field label={c.feilianWorkspace} htmlFor="feilian-workspace" hint={c.feilianWorkspaceHint}><Input disabled={busy} id="feilian-workspace" maxLength={100} value={tenantSlug} onChange={(event) => { setTenantSlug(event.target.value) }} /></Field>
          <Button loading={busy} type="submit" variant="primary">{c.bind}</Button>
        </form> : null}
        {data.bound ? <div className={styles.form}><p>{c.boundAccount} · {data.account}</p><Button loading={busy} variant="ghost" onClick={() => { setConfirmUnbind(true) }}>{c.unbind}</Button></div> : null}
        <div className={styles.externalLinks}>
          {data.registrationUrl ? <a href={data.registrationUrl} target="_blank" rel="noopener noreferrer">{c.feilianRegister}</a> : null}
          {data.enterpriseUrl ? <a href={data.enterpriseUrl} target="_blank" rel="noopener noreferrer">{c.feilianEnterprise}</a> : null}
        </div>
      </Card>
      {data.state === 'connected' ? <Card>
        {data.knowledgeBases.length === 0 ? <p className={styles.quiet}>{c.feilianEmpty}</p> : <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void action(async () => { setAnswer(''); setAnswer((await productApi.queryFeilian(knowledgeBase, question)).answer) }) }}>
          <Field label={c.feilianChoose} htmlFor="feilian-kb"><Select disabled={busy} id="feilian-kb" value={knowledgeBase} required onChange={(event) => { setKnowledgeBase(event.target.value); setAnswer('') }}>{data.knowledgeBases.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
          <Field label={c.feilianQuestion} htmlFor="feilian-question"><Textarea disabled={busy} id="feilian-question" rows={4} required maxLength={10_000} value={question} onChange={(event) => { setQuestion(event.target.value) }} /></Field>
          <p className={styles.quiet}>{c.feilianBilling}</p><Button loading={busy} variant="primary" type="submit">{c.feilianAsk}</Button>
        </form>}
        {answer ? <div className={styles.form} aria-live="polite"><SectionTitle title={c.feilianAnswer} /><p className={styles.result}>{answer}</p></div> : null}
      </Card> : null}
    </div>}
    <Modal open={confirmUnbind} title={c.unbind} description={c.feilianUnbindConfirm} onClose={() => { if (!busy) setConfirmUnbind(false) }} footer={<><Button disabled={busy} onClick={() => { setConfirmUnbind(false) }}>{c.cancel}</Button><Button loading={busy} variant="danger" onClick={() => { void action(async () => { await productApi.unbindFeilian(); setConfirmUnbind(false); setAnswer(''); await refresh() }) }}>{c.unbind}</Button></>}><span /></Modal>
  </ProductLayout>
}
