import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
/** Administrative catalog, publishing, and plan-scoped member grants. */
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Icon } from '../components/Icon.tsx'
import {
  Badge, Button, Card, EmptyState, ErrorPanel, Field, FormGrid, Input, Modal, PageHeader, PageLoader,
  SearchField, SectionTitle, Select, Textarea,
} from '../components/ui.tsx'
import { productApi, type ManagedAgent, type ProductAdmin } from '../lib/product-api.ts'
import { productCopy as c } from '../lib/product-copy.ts'
import styles from './Product.module.css'

const PAGE_SIZE = 8

function blank(): ManagedAgent {
  return { id: randomUUID(), title: c.defaultTitle, description: c.defaultDescription, category: c.defaultCategory,
    alias: '', kind: 'agent', members: [], group: c.defaultCategory, icon: 'spark', tasks: '', materials: '', deliverables: '', example: '',
    disclaimer: '', sortOrder: 100, recommended: false,
    output: 'text', executor: 'text', published: false, modelId: '',
    systemPrompt: c.defaultPrompt, skill: c.defaultSkill, revision: 0 }
}

/** Page numbers around the current page, with gaps for long catalogs. */
function pageItems(current: number, total: number): Array<number | 'gap'> {
  if (total <= 6) return Array.from({ length: total }, (_, index) => index + 1)
  const items: Array<number | 'gap'> = [1]
  const start = Math.max(2, Math.min(current - 1, total - 4))
  const end = Math.min(total - 1, Math.max(current + 1, 4))
  if (start > 2) items.push('gap')
  for (let page = start; page <= end; page += 1) items.push(page)
  if (end < total - 1) items.push('gap')
  items.push(total)
  return items
}

/** Product settings remain separate from ordinary users' creation flow. */
export function AgentAdminPage(): ReactNode {
  const [data, setData] = useState<ProductAdmin | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editor, setEditor] = useState<ManagedAgent | null>(null)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [memberId, setMemberId] = useState('')
  const [grantAgent, setGrantAgent] = useState('')
  const [grantDays, setGrantDays] = useState('30')
  const [permanent, setPermanent] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const next = await productApi.admin()
      setData(next)
      setError(null)
    } catch (caught) { setError(caught instanceof Error ? caught.message : c.loadError) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { setPage(1) }, [search])

  const member = data?.members.find(item => item.id === memberId)
  const filteredAgents = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (query === '') return data?.agents ?? []
    return (data?.agents ?? []).filter(agent =>
      [agent.title, agent.alias, agent.group, agent.category].some(value => value.toLowerCase().includes(query)))
  }, [data, search])
  const pageCount = Math.max(1, Math.ceil(filteredAgents.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const visibleAgents = filteredAgents.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const creating = editor !== null && !(data?.agents.some(agent => agent.id === editor.id) ?? false)

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
  const openNew = (): void => { setEditor(blank()); setEditorError(null) }
  const openEditor = (agent: ManagedAgent): void => { setEditor(agent); setEditorError(null) }
  const closeEditor = (): void => { if (busy) return; setEditor(null); setEditorError(null) }
  const saveAgent = async (): Promise<void> => {
    if (editor === null || busy) return
    setBusy(true); setMessage(null); setEditorError(null)
    try {
      await productApi.save(editor)
      setEditor(null)
      setMessage(c.saved)
      await refresh()
    } catch (caught) {
      setEditorError(caught instanceof Error ? caught.message : c.loadError)
    } finally { setBusy(false) }
  }

  return <div className="admin-page">
    <PageHeader title={c.adminTitle} description={c.adminIntro} actions={<div className={styles.inline}>
      <Button disabled={busy || data === null} onClick={openNew} icon="plus">{c.newAgent}</Button></div>} />
    {error ? <ErrorPanel message={error} onRetry={() => { void refresh() }} /> : null}
    {message ? <p className={styles.success} role="status">{message}</p> : null}
    {!data ? <PageLoader /> : <div className={styles.adminGrid}>
      <Card>
        <SectionTitle title={c.catalog} description={c.catalogHint} />
        <div className={styles.catalogToolbar}>
          <SearchField onChange={setSearch} placeholder={c.searchAgents} value={search} />
          <span className={styles.catalogCount}>{c.catalogCount.replace('{count}', String(filteredAgents.length))}</span>
        </div>
        {visibleAgents.length === 0 ? <EmptyState
          action={data.agents.length === 0 ? <Button icon="plus" onClick={openNew} size="small" variant="primary">{c.newAgent}</Button> : undefined}
          description={c.emptyCatalogHint}
          icon="spark"
          title={c.emptyCatalog}
        /> : <div className={styles.catalogList}>
          {visibleAgents.map(agent => <button aria-haspopup="dialog" key={agent.id} onClick={() => { openEditor(agent) }} type="button">
            <span className={styles.catalogCopy}><strong>{agent.title}</strong><small>{agent.group} · {agent.category}</small></span>
            <span className={styles.catalogTrailing}>
              <Badge tone={agent.published ? 'success' : 'neutral'}>{agent.published ? c.published : c.draft}</Badge>
              <Icon name="chevron-right" size={14} />
            </span>
          </button>)}
        </div>}
        {filteredAgents.length === 0 ? null : <footer className={styles.pagination}>
          <span>{c.pageSummary.replace('{page}', String(currentPage)).replace('{total}', String(pageCount))}</span>
          <nav aria-label={c.paginationLabel} className={styles.pageControls}>
            <Button disabled={busy || currentPage === 1} icon="arrow-left" onClick={() => { setPage(currentPage - 1) }} size="small">{c.previousPage}</Button>
            <div className={styles.pageNumbers}>
              {pageItems(currentPage, pageCount).map((item, index) => item === 'gap'
                ? <span className={styles.pageGap} key={`gap-${index}`}>…</span>
                : <button aria-current={item === currentPage ? 'page' : undefined} aria-label={c.pageNumber.replace('{page}', String(item))} className={`${styles.pageNumber} ${item === currentPage ? styles.pageNumberActive : ''}`} key={item} onClick={() => { setPage(item) }} type="button">{item}</button>)}
            </div>
            <Button disabled={busy || currentPage === pageCount} icon="arrow-right" onClick={() => { setPage(currentPage + 1) }} size="small">{c.nextPage}</Button>
          </nav>
        </footer>}
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

    <Modal
      description={creating ? c.createAgentHint : c.editAgentHint}
      footer={<><Button disabled={busy} onClick={closeEditor}>{c.cancel}</Button><Button form="agent-editor-form" loading={busy} type="submit" variant="primary">{c.save}</Button></>}
      onClose={closeEditor}
      open={editor !== null}
      title={creating ? c.newAgent : c.editAgent}
      width={760}
    >
      {editor ? <form className={`${styles.form} ${styles.editorForm}`} id="agent-editor-form" onSubmit={(event) => { event.preventDefault(); void saveAgent() }}>
        {editorError === null ? null : <div className="form-error" role="alert"><Icon name="alert" size={15} />{editorError}</div>}
        <section className={styles.formSection}>
          <h3>{c.basicSection}</h3>
          <FormGrid><Field label={c.name} htmlFor="agent-name"><Input disabled={busy} id="agent-name" value={editor.title} required maxLength={80} onChange={(event) => { update('title', event.target.value) }} /></Field>
            <Field label={c.alias} htmlFor="agent-alias"><Input disabled={busy} id="agent-alias" value={editor.alias} maxLength={200} onChange={(event) => { update('alias', event.target.value) }} /></Field></FormGrid>
          <FormGrid><Field label={c.group} htmlFor="agent-group"><Input disabled={busy} id="agent-group" value={editor.group} required maxLength={40} onChange={(event) => { update('group', event.target.value) }} /></Field>
            <Field label={c.category} htmlFor="agent-category"><Input disabled={busy} id="agent-category" value={editor.category} required maxLength={40} onChange={(event) => { update('category', event.target.value) }} /></Field></FormGrid>
          <Field label={c.description} htmlFor="agent-description"><Textarea disabled={busy} id="agent-description" value={editor.description} rows={3} required maxLength={1000} onChange={(event) => { update('description', event.target.value) }} /></Field>
        </section>
        <section className={styles.formSection}>
          <h3>{c.contentSection}</h3>
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
        </section>
        <section className={styles.formSection}>
          <h3>{c.executionSection}</h3>
          <FormGrid><Field label={c.executor} htmlFor="agent-executor"><Select disabled={busy} id="agent-executor" value={editor.executor} onChange={(event) => {
            const executor = event.target.value as ManagedAgent['executor']; setEditor({ ...editor, executor, output: executor === 'ppt-master' ? 'pptx' : executor })
          }}><option value="ppt-master">{c.pptExecutor}</option><option value="text">{c.textExecutor}</option><option value="video">{c.videoExecutor}</option></Select></Field>
          <Field label={c.model} htmlFor="agent-model"><Select disabled={busy} id="agent-model" required={editor.published} value={editor.modelId} onChange={(event) => { update('modelId', event.target.value) }}><option value="">{c.selectModel}</option>{data?.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</Select></Field></FormGrid>
          <Field label={c.systemPrompt} htmlFor="agent-prompt"><Textarea disabled={busy} id="agent-prompt" rows={6} maxLength={30_000} required value={editor.systemPrompt} onChange={(event) => { update('systemPrompt', event.target.value) }} /></Field>
          <Field label={c.skill} htmlFor="agent-skill"><Textarea disabled={busy} id="agent-skill" rows={6} maxLength={30_000} required value={editor.skill} onChange={(event) => { update('skill', event.target.value) }} /></Field>
          <label className={styles.check}><input disabled={busy} type="checkbox" checked={editor.recommended} onChange={(event) => { update('recommended', event.target.checked) }} />{c.recommended}</label>
          <label className={styles.check}><input disabled={busy} type="checkbox" checked={editor.published} onChange={(event) => { update('published', event.target.checked) }} />{c.publish}</label>
          <p className={styles.quiet}>{c.saveHint}</p>
        </section>
      </form> : null}
    </Modal>
  </div>
}
