/** Durable team knowledge manager rendered inside the Harness main column. */

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  Button,
  IconDatabaseOutlineRegular,
  IconEditOutlineRegular,
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconTrashOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  describeError,
  DialogActions,
  DialogField,
  EmptyState,
  ErrorState,
  FormError,
  IconAction,
  LoadingState,
  PageAction,
  PageFrame,
  PanelNotice,
  ResourceDialog,
  SearchBox,
  useResourceNotice,
  useResourceWriteAccess,
  type ResourcePanelProps,
} from './common.tsx'
import {
  formatResourceTime,
  resourcesApi,
  type KnowledgeArticle,
  type KnowledgeSummary,
} from './api.ts'
import css from './Resources.module.css'

interface KnowledgeForm {
  readonly title: string
  readonly summary: string
  readonly body: string
  readonly tags: string
}

const EMPTY_FORM: KnowledgeForm = { title: '', summary: '', body: '', tags: '' }

function formFromArticle(article: KnowledgeArticle): KnowledgeForm {
  return {
    title: article.title,
    summary: article.summary,
    body: article.body,
    tags: article.tags.join(', '),
  }
}

function tagsOf(value: string): string[] {
  return value.split(/[,，]/u).map(tag => tag.trim()).filter(tag => tag !== '')
}

/** Render the team knowledge catalog with real CRUD and generated-skill feedback. */
export function InternalKnowledgePanel({ t }: ResourcePanelProps): ReactNode {
  const { notice, showSuccess, showError, dismiss } = useResourceNotice()
  const canWrite = useResourceWriteAccess()
  const [articles, setArticles] = useState<KnowledgeSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorLoading, setEditorLoading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<KnowledgeForm>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      setArticles(await resourcesApi.knowledge())
    } catch (caught) {
      setError(describeError(caught, t, 'error.load'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { void load() }, [load])

  const openCreate = (): void => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setEditorOpen(true)
  }

  const openEdit = async (article: KnowledgeSummary): Promise<void> => {
    setEditingId(article.id)
    setEditorOpen(true)
    setEditorLoading(true)
    setFormError(null)
    try {
      setForm(formFromArticle(await resourcesApi.knowledgeArticle(article.id)))
    } catch (caught) {
      setEditorOpen(false)
      showError(describeError(caught, t, 'error.request'))
    } finally {
      setEditorLoading(false)
    }
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting || !canWrite) return
    setSubmitting(true)
    setFormError(null)
    const input = {
      title: form.title.trim(),
      summary: form.summary.trim(),
      body: form.body.trim(),
      tags: tagsOf(form.tags),
    }
    try {
      if (editingId === null) {
        await resourcesApi.createKnowledge(input)
        showSuccess(t('knowledge.created'))
      } else {
        await resourcesApi.updateKnowledge(editingId, input)
        showSuccess(t('knowledge.updated'))
      }
      setEditorOpen(false)
      await load()
    } catch (caught) {
      setFormError(describeError(caught, t, 'error.request'))
    } finally {
      setSubmitting(false)
    }
  }

  const remove = async (article: KnowledgeSummary): Promise<void> => {
    if (!window.confirm(t('knowledge.deleteConfirm', { title: article.title }))) return
    try {
      await resourcesApi.removeKnowledge(article.id)
      showSuccess(t('knowledge.deleted'))
      await load()
    } catch (caught) {
      showError(describeError(caught, t, 'error.request'))
    }
  }

  const term = search.trim().toLocaleLowerCase()
  const filtered = articles.filter(article => term === ''
    || article.title.toLocaleLowerCase().includes(term)
    || article.summary.toLocaleLowerCase().includes(term)
    || article.tags.some(tag => tag.toLocaleLowerCase().includes(term)))

  return (
    <PageFrame
      actions={<>{canWrite ? (
        <PageAction icon={<IconPlusOutlineRegular size={16} />} label={t('knowledge.new')} onClick={openCreate} />
      ) : null}</>}
      description={t('knowledge.subtitle')}
      title={t('knowledge.title')}
    >
      <div className={css.panel} data-resource-panel="">
        <div className={css.toolbar}>
          <SearchBox label={t('knowledge.searchLabel')} onChange={setSearch} placeholder={t('knowledge.searchPlaceholder')} value={search} />
          <button className={css.refreshAction} type="button" aria-label={t('common.retry')} onClick={() => { void load() }}>
            <IconRefreshOutlineRegular size={16} />
          </button>
        </div>
        <PanelNotice dismissLabel={t('common.close')} notice={notice} onDismiss={dismiss} />
        {loading ? (
          <LoadingState label={t('common.loading')} />
        ) : error !== null ? (
          <ErrorState message={error} onRetry={() => { void load() }} retryLabel={t('common.retry')} />
        ) : filtered.length === 0 ? (
          <EmptyState
            description={term === '' ? t('knowledge.emptyDescription') : t('knowledge.noMatchDescription')}
            icon={<IconDatabaseOutlineRegular size={24} />}
            title={term === '' ? t('knowledge.emptyTitle') : t('knowledge.noMatchTitle')}
            action={canWrite && term === '' ? (
              <Button icon={<IconPlusOutlineRegular size={15} />} onClick={openCreate} size="sm" variant="primary">
                {t('knowledge.new')}
              </Button>
            ) : undefined}
          />
        ) : (
          <div className={css.tableWrap}>
            <table className={css.table}>
              <thead>
                <tr>
                  <th>{t('knowledge.article')}</th>
                  <th>{t('knowledge.tags')}</th>
                  <th>{t('common.updated')}</th>
                  <th aria-label={t('common.actions')} />
                </tr>
              </thead>
              <tbody>
                {filtered.map(article => (
                  <tr key={article.id}>
                    <td>
                      <button className={css.stackedEntry} onClick={() => { void openEdit(article) }} type="button">
                        <strong>{article.title}</strong>
                        <span>{article.summary}</span>
                      </button>
                    </td>
                    <td>
                      <div className={css.tags}>
                        {article.tags.length === 0 ? <span className={css.mutedCell}>{t('knowledge.noTags')}</span> : article.tags.slice(0, 4).map(tag => (
                          <span className={css.tag} key={tag}>{tag}</span>
                        ))}
                        {article.tags.length > 4 ? <span className={css.mutedCell}>+{String(article.tags.length - 4)}</span> : null}
                      </div>
                    </td>
                    <td className={css.mutedCell}>{formatResourceTime(article.updatedAt)}</td>
                    <td>
                      <div className={css.rowActions}>
                        {canWrite ? (
                          <>
                            <IconAction
                              icon={<IconEditOutlineRegular size={16} />}
                              label={t('knowledge.editArticle', { title: article.title })}
                              onClick={() => { void openEdit(article) }}
                            />
                            <IconAction
                              danger
                              icon={<IconTrashOutlineRegular size={16} />}
                              label={t('knowledge.deleteArticle', { title: article.title })}
                              onClick={() => { void remove(article) }}
                            />
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ResourceDialog
        closeLabel={t('common.close')}
        description={t('knowledge.dialogDescription')}
        footer={canWrite ? (
          <DialogActions
            cancelLabel={t('common.cancel')}
            form="knowledge-form"
            onCancel={() => { setEditorOpen(false) }}
            submitLabel={editingId === null ? t('knowledge.create') : t('knowledge.save')}
            submitting={submitting}
          />
        ) : <Button onClick={() => { setEditorOpen(false) }}>{t('common.close')}</Button>}
        onClose={() => { setEditorOpen(false) }}
        open={editorOpen}
        title={!canWrite ? t('knowledge.viewTitle') : editingId === null ? t('knowledge.newTitle') : t('knowledge.editTitle')}
        wide
      >
        {editorLoading ? <LoadingState label={t('common.loading')} /> : (
          <form id="knowledge-form" className={css.form} onSubmit={(event) => { void submit(event) }}>
            {formError === null ? null : <FormError message={formError} />}
            <DialogField id="knowledge-title" label={t('knowledge.titleField')}>
              <input
                data-modal-autofocus
                id="knowledge-title"
                maxLength={200}
                onChange={(event) => {
                  const value = event.currentTarget.value
                  setForm(current => ({ ...current, title: value }))
                }}
                readOnly={!canWrite}
                required
                value={form.title}
              />
            </DialogField>
            <DialogField id="knowledge-summary" label={t('knowledge.summaryField')}>
              <input
                id="knowledge-summary"
                maxLength={1_000}
                onChange={(event) => {
                  const value = event.currentTarget.value
                  setForm(current => ({ ...current, summary: value }))
                }}
                placeholder={t('knowledge.summaryPlaceholder')}
                readOnly={!canWrite}
                required
                value={form.summary}
              />
            </DialogField>
            <DialogField hint={t('knowledge.tagsHint')} id="knowledge-tags" label={t('knowledge.tagsField')}>
              <input
                id="knowledge-tags"
                onChange={(event) => {
                  const value = event.currentTarget.value
                  setForm(current => ({ ...current, tags: value }))
                }}
                placeholder={t('knowledge.tagsPlaceholder')}
                readOnly={!canWrite}
                value={form.tags}
              />
            </DialogField>
            <DialogField id="knowledge-body" label={t('knowledge.bodyField')}>
              <textarea
                className={css.textarea}
                id="knowledge-body"
                onChange={(event) => {
                  const value = event.currentTarget.value
                  setForm(current => ({ ...current, body: value }))
                }}
                placeholder={t('knowledge.bodyPlaceholder')}
                readOnly={!canWrite}
                required
                rows={13}
                value={form.body}
              />
            </DialogField>
          </form>
        )}
      </ResourceDialog>
    </PageFrame>
  )
}
