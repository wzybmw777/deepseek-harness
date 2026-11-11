import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
/** Administrative catalog, publishing, and plan-scoped member grants. */
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Badge, Button, Card, ErrorPanel, Field, FormGrid, Input, PageHeader, PageLoader, SectionTitle, Select, Textarea } from '../components/ui.tsx'
import { productApi, type ManagedAgent, type ProductAdmin } from '../lib/product-api.ts'
import { productCopy as c } from '../lib/product-copy.ts'
import styles from './Product.module.css'

function blank(): ManagedAgent {
  return { id: randomUUID(), title: c.defaultTitle, description: c.defaultDescription, category: c.defaultCategory,
    alias: '', kind: 'agent', members: [], group: c.defaultCategory, icon: 'spark', tasks: '', materials: '', deliverables: '', example: '',
    disclaimer: '', sortOrder: 100, recommended: false,
    output: 'text', executor: 'text', published: false, modelId: '',
    systemPrompt: c.defaultPrompt, skill: c.defaultSkill, revision: 0 }
}

/** Product settings remain separate from ordinary users' creation flow. */
export function AgentAdminPage(): ReactNode {
  const [data, setData] = useState<ProductAdmin | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editor, setEditor] = useState<ManagedAgent | null>(null)
  const [memberId, setMemberId] = useState('')
  const [grantAgent, setGrantAgent] = useState('')
  const [grantDays, setGrantDays] = useState('30')
  const [permanent, setPermanent] = useState(false)
  const refresh = useCallback(async () => {
    try {
      const next = await productApi.admin(); setData(next); setError(null)
      setEditor(current => current ?? next.agents[0] ?? blank())
    } catch (caught) { setError(caught instanceof Error ? caught.message : c.loadError) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  const member = data?.members.find(item => item.id === memberId)

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
    <PageHeader title={c.adminTitle} description={c.adminIntro} actions={<div className={styles.inline}>
      <Button disabled={busy} onClick={() => { setEditor(blank()) }} icon="plus">{c.newAgent}</Button></div>} />
    {error ? <ErrorPanel message={error} onRetry={() => { void refresh() }} /> : null}
    {message ? <p className={styles.success} role="status">{message}</p> : null}
    {!data ? <PageLoader /> : <div className={styles.adminGrid}>
      <Card><SectionTitle title={c.catalog} /><div className={styles.catalogList}>{data.agents.map(agent => <button disabled={busy} type="button" className={editor?.id === agent.id ? styles.selectedItem : ''} onClick={() => { setEditor(agent) }} key={agent.id}>
        <span>{agent.title}</span><Badge tone={agent.published ? 'success' : 'neutral'}>{agent.published ? c.published : c.draft}</Badge></button>)}</div>
      {editor ? <form className={styles.form} onSubmit={(event) => {
        submit(event, async () => { setEditor(await productApi.save(editor)) })
      }}>
        <FormGrid><Field label={c.name} htmlFor="agent-name"><Input disabled={busy} id="agent-name" value={editor.title} required maxLength={80} onChange={(event) => { update('title', event.target.value) }} /></Field>
          <Field label={c.alias} htmlFor="agent-alias"><Input disabled={busy} id="agent-alias" value={editor.alias} maxLength={200} onChange={(event) => { update('alias', event.target.value) }} /></Field></FormGrid>
        <FormGrid><Field label={c.group} htmlFor="agent-group"><Input disabled={busy} id="agent-group" value={editor.group} required maxLength={40} onChange={(event) => { update('group', event.target.value) }} /></Field>
          <Field label={c.category} htmlFor="agent-category"><Input disabled={busy} id="agent-category" value={editor.category} required maxLength={40} onChange={(event) => { update('category', event.target.value) }} /></Field></FormGrid>
        <Field label={c.description} htmlFor="agent-description"><Textarea disabled={busy} id="agent-description" value={editor.description} rows={3} required maxLength={1000} onChange={(event) => { update('description', event.target.value) }} /></Field>
        <FormGrid>
          <Field label={c.iconLabel} htmlFor="agent-icon">
            <Select disabled={busy} id="agent-icon" value={editor.icon}
              onChange={(event) => { update('icon', event.target.value as ManagedAgent['icon']) }}>
              {Object.entries(c.icons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
          <Field label={c.sortOrder} htmlFor="agent-order">
            <Input disabled={busy} id="agent-order" type="number" min={0} max={10_000} step={1}
              value={editor.sortOrder} onChange={(event) => { update('sortOrder', Number(event.target.value)) }} />
          </Field>
        </FormGrid>
        <Field label={c.tasks} htmlFor="agent-tasks"><Textarea disabled={busy} id="agent-tasks" value={editor.tasks} rows={3} maxLength={2000} onChange={(event) => { update('tasks', event.target.value) }} /></Field>
        <FormGrid><Field label={c.materials} htmlFor="agent-materials"><Textarea disabled={busy} id="agent-materials" value={editor.materials} rows={3} maxLength={1000} onChange={(event) => { update('materials', event.target.value) }} /></Field>
          <Field label={c.deliverables} htmlFor="agent-deliverables"><Textarea disabled={busy} id="agent-deliverables" value={editor.deliverables} rows={3} maxLength={1000} onChange={(event) => { update('deliverables', event.target.value) }} /></Field></FormGrid>
        <Field label={c.example} htmlFor="agent-example"><Textarea disabled={busy} id="agent-example" value={editor.example} rows={2} maxLength={2000} onChange={(event) => { update('example', event.target.value) }} /></Field>
        <Field label={c.disclaimer} htmlFor="agent-disclaimer"><Input disabled={busy} id="agent-disclaimer" value={editor.disclaimer} maxLength={300} onChange={(event) => { update('disclaimer', event.target.value) }} /></Field>
        <FormGrid><Field label={c.executor} htmlFor="agent-executor"><Select disabled={busy} id="agent-executor" value={editor.executor} onChange={(event) => {
          const executor = event.target.value as ManagedAgent['executor']; setEditor({ ...editor, executor, output: executor === 'ppt-master' ? 'pptx' : executor })
        }}><option value="ppt-master">{c.pptExecutor}</option><option value="text">{c.textExecutor}</option><option value="video">{c.videoExecutor}</option></Select></Field>
        <Field label={c.model} htmlFor="agent-model"><Select disabled={busy} id="agent-model" required={editor.published} value={editor.modelId} onChange={(event) => { update('modelId', event.target.value) }}><option value="">{c.selectModel}</option>{data.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</Select></Field></FormGrid>
        <Field label={c.systemPrompt} htmlFor="agent-prompt"><Textarea disabled={busy} id="agent-prompt" rows={6} maxLength={30_000} required value={editor.systemPrompt} onChange={(event) => { update('systemPrompt', event.target.value) }} /></Field>
        <Field label={c.skill} htmlFor="agent-skill"><Textarea disabled={busy} id="agent-skill" rows={6} maxLength={30_000} required value={editor.skill} onChange={(event) => { update('skill', event.target.value) }} /></Field>
        <label className={styles.check}><input disabled={busy} type="checkbox" checked={editor.recommended} onChange={(event) => { update('recommended', event.target.checked) }} />{c.recommended}</label>
        <label className={styles.check}><input disabled={busy} type="checkbox" checked={editor.published} onChange={(event) => { update('published', event.target.checked) }} />{c.publish}</label>
        <p className={styles.quiet}>{c.saveHint}</p><Button type="submit" loading={busy} variant="primary">{c.save}</Button>
      </form> : null}
      </Card>
      <div className={styles.sideForms}>
        <Card><SectionTitle title={c.planTitle} description={c.planHint} />
          <ul className={styles.planList}>{data.teams.map(team => <li key={team.id}>
            <div><strong>{team.name}</strong><span>{team.planName}</span></div>
            <div className={styles.planFacts}>
              <span>{c.planUnlocked} {team.unlocked}{team.agentLimit === null ? '' : `/${team.agentLimit}`}</span>
              <span>{team.agentLimit === null ? c.planUnlimited : c.planLimit.replace('{limit}', String(team.agentLimit))}</span>
              <span>{team.teams ? c.planTeams : c.planNoTeams}</span>
            </div>
          </li>)}</ul>
        </Card>
        <Card><SectionTitle title={c.members} description={c.policyHint} /><Field label={c.member} htmlFor="grant-member"><Select disabled={busy} id="grant-member" value={memberId} onChange={(event) => { setMemberId(event.target.value) }}><option value="">{c.selectMember}</option>{data.members.map(item => <option key={item.id} value={item.id}>{item.name} · {item.teamName}</option>)}</Select></Field>
          {member ? <form className={styles.form} onSubmit={(event) => {
            submit(event, () => productApi.grant(member, grantAgent,
              permanent ? null : new Date(Date.now() + Number(grantDays) * 86_400_000).toISOString(), false))
          }}>
            <Field label={c.grantAgent} htmlFor="grant-agent"><Select disabled={busy} id="grant-agent" required value={grantAgent} onChange={(event) => { setGrantAgent(event.target.value) }}><option value="">{c.grantAgent}</option>{data.agents.map(agent => <option value={agent.id} key={agent.id}>{agent.title}</option>)}</Select></Field>
            <label className={styles.check}><input disabled={busy} type="checkbox" checked={permanent} onChange={(event) => { setPermanent(event.target.checked) }} />{c.grantPermanent}</label>
            {!permanent ? <Field label={c.grantDays} htmlFor="grant-days"><Input disabled={busy} id="grant-days" type="number" min={1} max={3650} required value={grantDays} onChange={(event) => { setGrantDays(event.target.value) }} /></Field> : null}
            <div className={styles.inline}><Button loading={busy} type="submit">{c.grant}</Button><Button loading={busy} disabled={!grantAgent} variant="danger" type="button" onClick={() => { void action(() => productApi.grant(member, grantAgent, null, true)) }}>{c.revoke}</Button></div>
          </form> : null}
        </Card>
      </div>
    </div>}
  </div>
}
