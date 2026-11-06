/** Team workspace file manager rendered inside the Harness main column. */

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  Button,
  IconDeliverDocRegular,
  IconDownloadOutlineRegular,
  IconEditOutlineRegular,
  IconFolderCloseRegular,
  IconFolderOpenOutlineRegular,
  IconPaperclipOutlineRegular,
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
  formatBytes,
  formatResourceTime,
  resourceFileDownloadUrl,
  resourcesApi,
  uploadResourceFile,
  type TeamFileEntry,
  type TeamFileListing,
  type TeamTextFile,
} from './api.ts'
import css from './Resources.module.css'

const TEXT_EDIT_BYTES = 2 * 1024 * 1024

function childPath(directory: string, name: string): string {
  return directory === '' ? name : `${directory}/${name}`
}

function pathSegments(directory: string): Array<{ readonly label: string; readonly path: string }> {
  const parts = directory === '' ? [] : directory.split('/')
  return parts.map((part, index) => ({ label: part, path: parts.slice(0, index + 1).join('/') }))
}

function triggerDownload(path: string): void {
  const link = document.createElement('a')
  link.href = resourceFileDownloadUrl(path)
  link.download = ''
  link.hidden = true
  document.body.appendChild(link)
  link.click()
  link.remove()
}

/** Render one team workspace directory with real file operations. */
export function FilesPanel({ t }: ResourcePanelProps): ReactNode {
  const { notice, showSuccess, showError, dismiss } = useResourceNotice()
  const canWrite = useResourceWriteAccess()
  const uploadRef = useRef<HTMLInputElement>(null)
  const [directory, setDirectory] = useState('')
  const [listing, setListing] = useState<TeamFileListing | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [folderOpen, setFolderOpen] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [renameTarget, setRenameTarget] = useState<TeamFileEntry | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [viewerTarget, setViewerTarget] = useState<TeamFileEntry | null>(null)
  const [viewer, setViewer] = useState<TeamTextFile | null>(null)
  const [viewerLoading, setViewerLoading] = useState(false)
  const [viewerError, setViewerError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const load = useCallback(async (target: string): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const next = await resourcesApi.files(target)
      setListing(next)
      setDirectory(next.directory)
    } catch (caught) {
      setError(describeError(caught, t, 'error.load'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { void load(directory) }, [directory, load])

  const openFolder = (path: string): void => {
    setSearch('')
    setDirectory(path)
  }

  const openViewer = async (entry: TeamFileEntry): Promise<void> => {
    setViewerTarget(entry)
    setViewer(null)
    setViewerLoading(true)
    setViewerError(null)
    setEditing(false)
    setDraft('')
    try {
      const file = await resourcesApi.fileContent(entry.path)
      setViewer(file)
      setDraft(file.content)
    } catch (caught) {
      setViewerTarget(null)
      showError(describeError(caught, t, 'error.request'))
    } finally {
      setViewerLoading(false)
    }
  }

  const openEntry = (entry: TeamFileEntry): void => {
    if (entry.kind === 'directory') openFolder(entry.path)
    else if (entry.editable) void openViewer(entry)
    else {
      triggerDownload(entry.path)
      showSuccess(t('files.unsupportedDescription'))
    }
  }

  const upload = async (files: readonly File[]): Promise<void> => {
    if (files.length === 0 || busy) return
    setBusy(true)
    try {
      for (const file of files) {
        await uploadResourceFile(directory, file)
        showSuccess(t('files.uploaded', { name: file.name }))
      }
      await load(directory)
    } catch (caught) {
      showError(describeError(caught, t, 'error.request'))
    } finally {
      setBusy(false)
      if (uploadRef.current !== null) uploadRef.current.value = ''
    }
  }

  const createFolder = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (busy) return
    const name = folderName.trim()
    if (name === '') {
      setFormError(t('error.request'))
      return
    }
    setBusy(true)
    setFormError(null)
    try {
      await resourcesApi.createDirectory(childPath(directory, name))
      setFolderOpen(false)
      setFolderName('')
      showSuccess(t('files.folderCreated'))
      await load(directory)
    } catch (caught) {
      setFormError(describeError(caught, t, 'error.request'))
    } finally {
      setBusy(false)
    }
  }

  const rename = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (busy || renameTarget === null) return
    const name = renameValue.trim()
    if (name === '') {
      setFormError(t('error.request'))
      return
    }
    setBusy(true)
    setFormError(null)
    try {
      await resourcesApi.rename(renameTarget.path, name)
      setRenameTarget(null)
      showSuccess(t('files.renamed'))
      await load(directory)
    } catch (caught) {
      setFormError(describeError(caught, t, 'error.request'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (entry: TeamFileEntry): Promise<void> => {
    if (!window.confirm(t('files.deleteConfirm', { name: entry.name }))) return
    try {
      await resourcesApi.removeFile(entry.path)
      showSuccess(t('files.deleted', { name: entry.name }))
      await load(directory)
    } catch (caught) {
      showError(describeError(caught, t, 'error.request'))
    }
  }

  const saveContent = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (viewer === null || busy) return
    if (new Blob([draft]).size > TEXT_EDIT_BYTES) {
      setViewerError(t('files.contentLimit'))
      return
    }
    setBusy(true)
    setViewerError(null)
    try {
      const updated = await resourcesApi.writeFile(viewer.path, draft)
      setViewer(current => current === null ? current : {
        ...current,
        content: draft,
        size: updated.size,
        modifiedAt: updated.modifiedAt,
      })
      setEditing(false)
      showSuccess(t('files.saveContent'))
      await load(directory)
    } catch (caught) {
      setViewerError(describeError(caught, t, 'error.request'))
    } finally {
      setBusy(false)
    }
  }

  const term = search.trim().toLocaleLowerCase()
  const entries = (listing?.entries ?? []).filter(entry => term === ''
    || entry.name.toLocaleLowerCase().includes(term))
  const segments = pathSegments(directory)
  const viewerFooter = viewerTarget === null ? null : (
    <>
      <Button onClick={() => { setViewerTarget(null); setViewer(null) }}>{t('common.close')}</Button>
      {viewer === null ? null : (
        <>
          <Button icon={<IconDownloadOutlineRegular size={15} />} onClick={() => { triggerDownload(viewer.path) }} variant="outline">
            {t('common.download')}
          </Button>
          {canWrite && editing ? (
            <Button form="file-content-form" type="submit" variant="primary">{t('files.saveContent')}</Button>
          ) : canWrite ? (
            <Button icon={<IconEditOutlineRegular size={15} />} onClick={() => { setEditing(true) }} variant="primary">
              {t('files.editContent')}
            </Button>
          ) : null}
        </>
      )}
    </>
  )

  return (
    <PageFrame
      actions={canWrite ? (
        <>
          <Button icon={<IconFolderOpenOutlineRegular size={16} />} onClick={() => { setFormError(null); setFolderOpen(true) }} variant="outline">
            {t('files.newFolder')}
          </Button>
          <PageAction
            disabled={busy}
            icon={<IconPaperclipOutlineRegular size={16} />}
            label={busy ? t('files.uploading') : t('files.upload')}
            onClick={() => { uploadRef.current?.click() }}
          />
        </>
      ) : undefined}
      description={t('files.subtitle')}
      title={t('files.title')}
    >
      <div className={css.panel} data-resource-panel="">
        <div className={css.toolbar}>
          {directory === '' ? null : (
            <nav className={css.breadcrumbs} aria-label={t('files.root')}>
              <button type="button" onClick={() => { openFolder('') }}>{t('files.root')}</button>
              {segments.map(segment => (
                <span key={segment.path}>
                  <span className={css.breadcrumbSeparator} aria-hidden="true">/</span>
                  <button type="button" aria-current={segment.path === directory ? 'page' : undefined} onClick={() => { openFolder(segment.path) }}>
                    {segment.label}
                  </button>
                </span>
              ))}
            </nav>
          )}
          <SearchBox label={t('files.searchLabel')} onChange={setSearch} placeholder={t('files.searchPlaceholder')} value={search} />
          <button className={css.refreshAction} type="button" aria-label={t('common.retry')} onClick={() => { void load(directory) }}>
            <IconRefreshOutlineRegular size={16} />
          </button>
        </div>
        <PanelNotice dismissLabel={t('common.close')} notice={notice} onDismiss={dismiss} />
        {loading && listing === null ? (
          <LoadingState label={t('common.loading')} />
        ) : error !== null ? (
          <ErrorState message={error} onRetry={() => { void load(directory) }} retryLabel={t('common.retry')} />
        ) : entries.length === 0 ? (
          <EmptyState
            description={term === '' ? t('files.emptyDescription') : t('files.noMatchDescription')}
            icon={<IconFolderCloseRegular size={24} />}
            title={term === '' ? t('files.emptyTitle') : t('files.noMatchTitle')}
            action={canWrite && term === '' ? (
              <Button icon={<IconPlusOutlineRegular size={15} />} onClick={() => { uploadRef.current?.click() }} size="sm" variant="primary">
                {t('files.upload')}
              </Button>
            ) : undefined}
          />
        ) : (
          <div className={css.tableWrap}>
            <table className={css.table}>
              <thead>
                <tr>
                  <th>{t('files.name')}</th>
                  <th>{t('files.size')}</th>
                  <th>{t('common.updated')}</th>
                  <th aria-label={t('common.actions')} />
                </tr>
              </thead>
              <tbody>
                {entries.map(entry => (
                  <tr key={entry.path}>
                    <td>
                      <button
                        aria-label={entry.kind === 'directory' ? t('files.openFolder', { name: entry.name }) : t('files.openFile', { name: entry.name })}
                        className={css.entryName}
                        onClick={() => { openEntry(entry) }}
                        type="button"
                      >
                        <span className={css.entryIcon} aria-hidden="true">
                          {entry.kind === 'directory' ? <IconFolderCloseRegular size={17} /> : <IconDeliverDocRegular size={17} />}
                        </span>
                        <span>{entry.name}</span>
                      </button>
                    </td>
                    <td className={css.mutedCell}>{entry.kind === 'directory' ? '—' : formatBytes(entry.size)}</td>
                    <td className={css.mutedCell}>{formatResourceTime(entry.modifiedAt)}</td>
                    <td>
                      <div className={css.rowActions}>
                        {entry.kind === 'file' ? (
                          <IconAction
                            icon={<IconDownloadOutlineRegular size={16} />}
                            label={t('files.downloadFile', { name: entry.name })}
                            onClick={() => { triggerDownload(entry.path) }}
                          />
                        ) : null}
                        {canWrite ? (
                          <>
                            <IconAction
                              icon={<IconEditOutlineRegular size={16} />}
                              label={t('files.renameFile', { name: entry.name })}
                              onClick={() => { setFormError(null); setRenameTarget(entry); setRenameValue(entry.name) }}
                            />
                            <IconAction
                              danger
                              icon={<IconTrashOutlineRegular size={16} />}
                              label={t('files.deleteFile', { name: entry.name })}
                              onClick={() => { void remove(entry) }}
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

      <input
        ref={uploadRef}
        className={css.visuallyHidden}
        multiple
        onChange={(event) => { void upload(Array.from(event.currentTarget.files ?? [])) }}
        type="file"
      />

      <ResourceDialog
        closeLabel={t('common.close')}
        description={t('files.folderDescription')}
        footer={(
          <DialogActions
            cancelLabel={t('common.cancel')}
            form="new-folder-form"
            onCancel={() => { setFolderOpen(false) }}
            submitLabel={t('files.createFolder')}
            submitting={busy}
          />
        )}
        onClose={() => { setFolderOpen(false) }}
        open={folderOpen}
        title={t('files.newFolder')}
      >
        <form id="new-folder-form" className={css.form} onSubmit={(event) => { void createFolder(event) }}>
          <DialogField error={formError} id="resource-folder-name" label={t('files.folderName')}>
            <input
              aria-describedby={formError === null ? undefined : 'resource-folder-name-error'}
              aria-invalid={formError === null ? undefined : true}
              data-modal-autofocus
              id="resource-folder-name"
              maxLength={255}
              onChange={(event) => { setFolderName(event.currentTarget.value) }}
              placeholder={t('files.folderPlaceholder')}
              required
              value={folderName}
            />
          </DialogField>
        </form>
      </ResourceDialog>

      <ResourceDialog
        closeLabel={t('common.close')}
        description={t('files.renameDescription')}
        footer={(
          <DialogActions
            cancelLabel={t('common.cancel')}
            form="rename-file-form"
            onCancel={() => { setRenameTarget(null) }}
            submitLabel={t('files.saveName')}
            submitting={busy}
          />
        )}
        onClose={() => { setRenameTarget(null) }}
        open={renameTarget !== null}
        title={t('files.renameFile', { name: renameTarget?.name ?? '' })}
      >
        <form id="rename-file-form" className={css.form} onSubmit={(event) => { void rename(event) }}>
          <DialogField error={formError} id="resource-rename-name" label={t('files.newName')}>
            <input
              aria-describedby={formError === null ? undefined : 'resource-rename-name-error'}
              aria-invalid={formError === null ? undefined : true}
              data-modal-autofocus
              id="resource-rename-name"
              maxLength={255}
              onChange={(event) => { setRenameValue(event.currentTarget.value) }}
              required
              value={renameValue}
            />
          </DialogField>
        </form>
      </ResourceDialog>

      <ResourceDialog
        closeLabel={t('common.close')}
        description={t('files.viewerDescription')}
        footer={viewerFooter ?? <Button onClick={() => { setViewerTarget(null) }}>{t('common.close')}</Button>}
        onClose={() => { setViewerTarget(null); setViewer(null) }}
        open={viewerTarget !== null}
        title={viewerTarget?.name ?? ''}
        wide
      >
        {viewerLoading ? <LoadingState label={t('common.loading')} /> : viewer === null ? null : (
          <form id="file-content-form" onSubmit={(event) => { void saveContent(event) }}>
            {viewerError === null ? null : <FormError message={viewerError} />}
            <textarea
              aria-label={t('files.editContent')}
              className={css.viewer}
              onChange={(event) => { setDraft(event.currentTarget.value) }}
              readOnly={!editing}
              spellCheck={false}
              value={draft}
            />
          </form>
        )}
      </ResourceDialog>
    </PageFrame>
  )
}
