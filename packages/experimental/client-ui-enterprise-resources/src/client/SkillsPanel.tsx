/** Team filesystem skill manager rendered inside the Harness main column. */

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  Button,
  IconEditOutlineRegular,
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconSkillOutlineRegular,
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
  type TeamSkillSummary,
} from './api.ts'
import css from './Resources.module.css'

interface SkillForm {
  readonly name: string
  readonly description: string
  readonly instructions: string
}

const EMPTY_FORM: SkillForm = { name: '', description: '', instructions: '' }

/** Render the team skill catalog with create, inspect, edit, and delete flows. */
export function SkillsPanel({ t }: ResourcePanelProps): ReactNode {
  const { notice, showSuccess, showError, dismiss } = useResourceNotice()
  const canWrite = useResourceWriteAccess()
  const [skills, setSkills] = useState<TeamSkillSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorLoading, setEditorLoading] = useState(false)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [managed, setManaged] = useState(false)
  const [form, setForm] = useState<SkillForm>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      setSkills(await resourcesApi.skills())
    } catch (caught) {
      setError(describeError(caught, t, 'error.load'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { void load() }, [load])

  const openCreate = (): void => {
    setEditingName(null)
    setManaged(false)
    setForm(EMPTY_FORM)
    setFormError(null)
    setEditorOpen(true)
  }

  const openSkill = async (skill: TeamSkillSummary): Promise<void> => {
    setEditingName(skill.name)
    setManaged(skill.managedBy === 'knowledge')
    setEditorOpen(true)
    setEditorLoading(true)
    setFormError(null)
    try {
      const detail = await resourcesApi.skill(skill.name)
      setForm({ name: detail.name, description: detail.description, instructions: detail.instructions })
    } catch (caught) {
      setEditorOpen(false)
      showError(describeError(caught, t, 'error.request'))
    } finally {
      setEditorLoading(false)
    }
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting || managed || !canWrite) return
    setSubmitting(true)
    setFormError(null)
    try {
      if (editingName === null) {
        await resourcesApi.createSkill({
          name: form.name.trim(),
          description: form.description.trim(),
          instructions: form.instructions.trim(),
        })
        showSuccess(t('skills.created'))
      } else {
        await resourcesApi.updateSkill(editingName, {
          description: form.description.trim(),
          instructions: form.instructions.trim(),
        })
        showSuccess(t('skills.updated'))
      }
      setEditorOpen(false)
      await load()
    } catch (caught) {
      setFormError(describeError(caught, t, 'error.request'))
    } finally {
      setSubmitting(false)
    }
  }

  const remove = async (skill: TeamSkillSummary): Promise<void> => {
    if (!window.confirm(t('skills.deleteConfirm', { name: skill.name }))) return
    try {
      await resourcesApi.removeSkill(skill.name)
      showSuccess(t('skills.deleted'))
      await load()
    } catch (caught) {
      showError(describeError(caught, t, 'error.request'))
    }
  }

  const term = search.trim().toLocaleLowerCase()
  const filtered = skills.filter(skill => term === ''
    || skill.name.toLocaleLowerCase().includes(term)
    || skill.description.toLocaleLowerCase().includes(term))
  const dialogTitle = !canWrite
    ? t('skills.viewTitle')
    : editingName === null
      ? t('skills.newTitle')
      : managed ? t('skills.managedTitle') : t('skills.editTitle')
  const dialogFooter = managed || !canWrite
    ? <Button onClick={() => { setEditorOpen(false) }}>{t('common.close')}</Button>
    : (
      <DialogActions
        cancelLabel={t('common.cancel')}
        form="skill-form"
        onCancel={() => { setEditorOpen(false) }}
        submitLabel={editingName === null ? t('skills.create') : t('skills.save')}
        submitting={submitting}
      />
    )

  return (
    <PageFrame
      actions={canWrite ? (
        <PageAction icon={<IconPlusOutlineRegular size={16} />} label={t('skills.new')} onClick={openCreate} />
      ) : undefined}
      description={t('skills.subtitle')}
      title={t('skills.title')}
    >
      <div className={css.panel} data-resource-panel="">
        <div className={css.toolbar}>
          <SearchBox label={t('skills.searchLabel')} onChange={setSearch} placeholder={t('skills.searchPlaceholder')} value={search} />
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
            description={term === '' ? t('skills.emptyDescription') : t('skills.noMatchDescription')}
            icon={<IconSkillOutlineRegular size={24} />}
            title={term === '' ? t('skills.emptyTitle') : t('skills.noMatchTitle')}
            action={canWrite && term === '' ? (
              <Button icon={<IconPlusOutlineRegular size={15} />} onClick={openCreate} size="sm" variant="primary">
                {t('skills.new')}
              </Button>
            ) : undefined}
          />
        ) : (
          <div className={css.tableWrap}>
            <table className={css.table}>
              <thead>
                <tr>
                  <th>{t('skills.title')}</th>
                  <th>{t('skills.source')}</th>
                  <th>{t('common.updated')}</th>
                  <th aria-label={t('common.actions')} />
                </tr>
              </thead>
              <tbody>
                {filtered.map(skill => (
                  <tr key={skill.name}>
                    <td>
                      <button className={css.stackedEntry} onClick={() => { void openSkill(skill) }} type="button">
                        <strong>{skill.name}</strong>
                        <span>{skill.description}</span>
                      </button>
                    </td>
                    <td>
                      <span className={css.sourceBadge} data-source={skill.managedBy}>
                        {skill.managedBy === 'knowledge' ? t('skills.knowledgeGenerated') : t('skills.teamAuthored')}
                      </span>
                    </td>
                    <td className={css.mutedCell}>{formatResourceTime(skill.updatedAt)}</td>
                    <td>
                      <div className={css.rowActions}>
                        {canWrite ? (
                          <>
                            <IconAction
                              icon={<IconEditOutlineRegular size={16} />}
                              label={skill.managedBy === 'knowledge' ? t('skills.managedTitle') : t('skills.editSkill', { name: skill.name })}
                              onClick={() => { void openSkill(skill) }}
                            />
                            {skill.managedBy === 'knowledge' ? null : (
                              <IconAction
                                danger
                                icon={<IconTrashOutlineRegular size={16} />}
                                label={t('skills.deleteSkill', { name: skill.name })}
                                onClick={() => { void remove(skill) }}
                              />
                            )}
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
        description={managed ? t('skills.managedDescription') : t('skills.dialogDescription')}
        footer={dialogFooter}
        onClose={() => { setEditorOpen(false) }}
        open={editorOpen}
        title={dialogTitle}
        wide
      >
        {editorLoading ? <LoadingState label={t('common.loading')} /> : (
          <form id="skill-form" className={css.form} onSubmit={(event) => { void submit(event) }}>
            {formError === null ? null : <FormError message={formError} />}
            <DialogField hint={managed ? undefined : t('skills.nameHint')} id="skill-name" label={t('skills.nameField')}>
              <input
                data-modal-autofocus
                disabled={editingName !== null || managed || !canWrite}
                id="skill-name"
                maxLength={80}
                onChange={(event) => {
                  const value = event.currentTarget.value
                  setForm(current => ({ ...current, name: value }))
                }}
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                placeholder={t('skills.namePlaceholder')}
                required
                value={form.name}
              />
            </DialogField>
            <DialogField id="skill-description" label={t('skills.descriptionField')}>
              <input
                disabled={managed || !canWrite}
                id="skill-description"
                maxLength={500}
                onChange={(event) => {
                  const value = event.currentTarget.value
                  setForm(current => ({ ...current, description: value }))
                }}
                placeholder={t('skills.descriptionPlaceholder')}
                required
                value={form.description}
              />
            </DialogField>
            <DialogField hint={managed ? undefined : t('skills.instructionsHint')} id="skill-instructions" label={t('skills.instructionsField')}>
              <textarea
                className={css.textarea}
                disabled={managed || !canWrite}
                id="skill-instructions"
                onChange={(event) => {
                  const value = event.currentTarget.value
                  setForm(current => ({ ...current, instructions: value }))
                }}
                placeholder={t('skills.instructionsPlaceholder')}
                required
                rows={14}
                value={form.instructions}
              />
            </DialogField>
          </form>
        )}
      </ResourceDialog>
    </PageFrame>
  )
}
