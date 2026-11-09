/** Native Feilian binding and library selection in the current workbench. */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button, IconDatabaseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { describeError, EmptyState, ErrorState, FormError, LoadingState, PageFrame, type ResourcePanelProps } from './common.tsx'
import { InternalKnowledgePanel } from './KnowledgePanel.tsx'
import { workbenchProducts, type FeilianStatus } from './product-api.ts'
import css from './Product.module.css'

/** Workbench library selection callback, independent of browser navigation. */
export interface KnowledgePanelInjected {
  readonly useKnowledge: (id: string, title: string) => Promise<void>
}

/**
 * Render Feilian by default and preserve the existing internal knowledge catalog.
 * @param props - locale and chat action.
 * @returns native library panel.
 */
export function KnowledgePanel(props: ResourcePanelProps & KnowledgePanelInjected): ReactNode {
  const { t, useKnowledge } = props
  const [internal, setInternal] = useState(false)
  const [data, setData] = useState<FeilianStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [tenant, setTenant] = useState('')
  const [busy, setBusy] = useState(false)
  const active = useRef(false)
  const lock = useRef(false)
  const sequence = useRef(0)
  const refresh = useCallback(async (): Promise<void> => {
    const request = ++sequence.current
    try {
      const status = await workbenchProducts.feilian()
      if (active.current && request === sequence.current) { setData(status); setError(null) }
    } catch (caught) {
      if (active.current && request === sequence.current) setError(describeError(caught, t, 'error.load'))
    }
  }, [t])
  useEffect(() => { active.current = true; void refresh(); return () => { active.current = false; sequence.current++ } }, [refresh])
  const perform = async (action: () => Promise<unknown>): Promise<void> => {
    if (lock.current) return
    lock.current = true; setBusy(true); setActionError(null)
    try {
      await action()
      if (active.current) { setPassword(''); await refresh() }
    } catch (caught) { if (active.current) setActionError(describeError(caught, t, 'error.request')) }
    finally { lock.current = false; if (active.current) setBusy(false) }
  }
  const bind = (event: FormEvent): void => {
    event.preventDefault()
    void perform(() => workbenchProducts.bindFeilian(email.trim(), password, tenant.trim()))
  }
  return <>
    <div className={css.knowledgeSwitch} role="group" aria-label={t('knowledge.title')}>
      <button type="button" aria-pressed={!internal} onClick={() => { setInternal(false) }}>{t('knowledge.feilian')}</button>
      <button type="button" aria-pressed={internal} onClick={() => { setInternal(true) }}>{t('feilian.internal')}</button>
    </div>
    {internal ? <InternalKnowledgePanel {...props} /> : <PageFrame title={t('knowledge.feilian')} description={t('feilian.subtitle')}>
      {error ? <ErrorState message={error} retryLabel={t('common.retry')} onRetry={() => { void refresh() }} /> : null}
      {!data && !error ? <LoadingState label={t('common.loading')} /> : null}
      {data ? <>
        <div className={css.libraryHeader}>
          <span>{t(`feilian.${data.state}`)}{data.account ? ` · ${data.account}` : ''}</span>
          <Button size="sm" disabled={busy} onClick={() => { void refresh() }}>{t('usage.refresh')}</Button>
          {data.bound ? <Button size="sm" disabled={busy} onClick={() => {
            if (window.confirm(t('feilian.unbindConfirm'))) void perform(() => workbenchProducts.unbindFeilian())
          }}>{t('feilian.unbind')}</Button> : null}
        </div>
        {data.available && (!data.bound || data.state === 'reauth') ? <form className={css.binding} onSubmit={bind}>
          <p className={css.note}>{t('feilian.bindingHint')}</p>
          <label className={css.materials}>{t('feilian.email')}<input type="email" autoComplete="username" maxLength={320} required disabled={busy} value={email} onChange={(event) => { setEmail(event.target.value) }} /></label>
          <label className={css.materials}>{t('feilian.password')}<input type="password" autoComplete="current-password" maxLength={200} required disabled={busy} value={password} onChange={(event) => { setPassword(event.target.value) }} /></label>
          <label className={css.materials}>{t('feilian.tenant')}<input autoComplete="off" maxLength={100} disabled={busy} value={tenant} onChange={(event) => { setTenant(event.target.value) }} /></label>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? t('market.submitting') : t('feilian.bind')}</Button>
          {data.registrationUrl ? <a href={data.registrationUrl} target="_blank" rel="noopener noreferrer">{t('feilian.register')}</a> : null}
          {data.enterpriseUrl ? <a href={data.enterpriseUrl} target="_blank" rel="noopener noreferrer">{t('feilian.enterprise')}</a> : null}
        </form> : null}
        {data.state === 'connected' ? data.knowledgeBases.length === 0
          ? <EmptyState title={t('feilian.empty')} description={t('feilian.emptyHint')} icon={<IconDatabaseOutlineRegular size={24} />} />
          : <div className={css.libraries}>{data.knowledgeBases.map(library => <button type="button" key={library.id} disabled={busy}
            onClick={() => { void perform(() => useKnowledge(library.id, library.name)) }}>
            <IconDatabaseOutlineRegular size={20} /><span><strong>{library.name}</strong><small>{t('feilian.use')}</small></span><span aria-hidden="true">@</span>
          </button>)}</div> : null}
      </> : null}
      {actionError ? <FormError message={actionError} /> : null}
    </PageFrame>}
  </>
}
